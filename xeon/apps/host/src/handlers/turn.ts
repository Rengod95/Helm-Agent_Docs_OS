import { assertNever } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { LoopError } from "@xeon/contracts/services";
import {
  wireError,
  type TurnStartInput,
  type WireError,
  type WireHandler,
} from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { wireErrorOfStore } from "../store-error.ts";
import { titleFromInput } from "../title.ts";
import { claimWrite, threadLocked } from "./owner.ts";
import { requireOwned } from "./thread.ts";

// L4.host-service.spec §3.4 M1 표, HS-22, HS-28. turn.start: 쓰기 소유를 확인하고 없으면 암묵 획득한 뒤 입력을 제출한다.
// 응답은 접수만 뜻한다. 접수 뒤 취소가 와도 turn은 멈추지 않는다. turn.interrupt는 아래에 있다.

/** 루프가 요청을 받지 않은 이유를 와이어 오류로 옮긴다(`turn.start`의 입력 접수, `turn.resume`). 저장소 쪽 실패는 store.* kind다(F.wire-settings §3.5.2) */
function loopRejection(error: LoopError, where: string): WireError {
  switch (error.kind) {
    case "turn_aborting":
      return wireError("turn.busy", { details: { turnId: error.turnId } });
    case "stale_lease":
      return threadLocked(null);
    case "input_invalid":
      return wireError("jsonrpc.invalidParams", {
        details: { issues: [{ path: "input", message: error.message.slice(0, 512) }] },
      });
    case "thread_not_found":
    case "ownership_lost":
    case "busy":
    case "disk_full":
    case "io":
    case "read_only":
    case "row_invalid":
      return wireErrorOfStore(error, `${where} rejected`);
    default:
      return assertNever(error, "LoopError");
  }
}

export function createTurnStartHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"turn.start"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    const exists = ports.threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "turn.start thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    await claimWrite(engine, hub(), context.connectionId, threadId);
    const outcome = await ports.turns.submit(threadId, params.input, params.requestId);
    if (!outcome.ok) {
      if (outcome.reason === "rejected") throw loopRejection(outcome.error, "turn.start");
      throw wireError("turn.busy", { details: { turnId: outcome.turnId } });
    }
    nameThreadFromFirstInput(engine, threadId, params.input);
    return { turnId: outcome.turnId };
  };
}

/**
 * 제목이 아직 없는 thread의 첫 입력에서 제목을 정한다(M2 마감 G2-12, HS-73). 입력이 접수된 뒤에 하고 실패해도 turn.start를 실패시키지
 * 않는다(로그만 남긴다): 제목은 목록 표시용이고 대화의 진행을 막을 이유가 없다. 사람이 정한 제목(`thread.create { title }`,
 * `thread.rename`)이 있으면 덮지 않는다
 */
function nameThreadFromFirstInput(engine: Engine, threadId: ThreadId, input: TurnStartInput): void {
  const { threads, log } = engine.ports;
  const titled = threads.hasTitle(threadId);
  if (!titled.ok) {
    log.error("thread.auto_title_failed", { threadId, step: "read", kind: titled.error.kind });
    return;
  }
  if (titled.value) return;
  const title = titleFromInput(input);
  if (title === undefined) return;
  const renamed = threads.rename(threadId, title);
  if (!renamed.ok) {
    log.error("thread.auto_title_failed", { threadId, step: "rename", kind: renamed.error.kind });
  }
}

/**
 * 끊긴 turn을 이어 실행한다(G1-02, HS-74). 열린 turn은 thread마다 하나라 turn id를 받지 않는다. 호스트는 자동 재개를 하지 않고
 * 사용자가 확인한 뒤 클라이언트가 부른다. `turn.start`처럼 쓰기 소유를 암묵 획득한다: 재시작 뒤 첫 획득이 열 때 복구와 미해결 승인
 * 되살리기를 하므로 재개 전에 반드시 지나야 한다. 결과는 이어 실행을 접수했다는 뜻이고 진행은 이벤트로 온다
 */
export function createTurnResumeHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"turn.resume"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    const exists = ports.threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "turn.resume thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    await claimWrite(engine, hub(), context.connectionId, threadId);
    const resumed = await ports.turns.resume(threadId);
    if (!resumed.ok) throw loopRejection(resumed.error, "turn.resume");
    return resumed.value;
  };
}

/** 쓰기 소유자만(HS-28). 중단할 turn이 있었으면 `interrupted: true`다 */
export function createTurnInterruptHandler(engine: Engine): WireHandler<"turn.interrupt"> {
  const { ports } = engine;
  return async (params) => {
    const { threadId } = params;
    const exists = ports.threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "turn.interrupt thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    requireOwned(engine, threadId);
    return { interrupted: await ports.turns.interrupt(threadId, params.turnId) };
  };
}
