import type { ThreadId } from "@xeon/contracts/conversation";
import type { ContextError } from "@xeon/contracts/services";
import { assertNever, Bug } from "@xeon/contracts";
import { wireError, type WireError, type WireHandler } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine, ThreadCompactFailure, ThreadReadFailure } from "../types.ts";
import { wireErrorOfLifecycle, wireErrorOfStore } from "../store-error.ts";
import { claimWrite, threadLocked, withWriteOwner } from "./owner.ts";

// L4.host-service.spec §3.4 M1 표. thread.create: thread를 만들고 쓰기 소유를 함께 얻는다(M1에서는 create가 소유를 얻는다).
// thread.open은 아래에 있다. M2 나머지(HOST.2)는 이 파일 아래쪽: list, read, close, fork, revert, delete.

export function createThreadCreateHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.create"> {
  const { ports } = engine;
  return async (params, context) => {
    const created = await ports.threads.create({
      ...(params.workspace === undefined ? {} : { workspace: params.workspace }),
      ...(params.title === undefined ? {} : { title: params.title }),
    });
    await claimWrite(engine, hub(), context.connectionId, created.threadId);
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    const position = ports.threads.position(created.threadId);
    if (!position.ok) throw wireErrorOfStore(position.error, "thread.create position");
    return { threadId: created.threadId, position: position.value };
  };
}

/**
 * L4.host-service.spec §3.4 M2 표, HS-23~HS-24. thread.open:
 * - `write`: thread가 없으면 3001. 이 프로세스가 이미 쥐었으면 그대로 `owner`(같은 호스트의 여러 연결이 쓰기 소유를 함께 쓴다).
 *   아니면 세션 잠금을 얻고(임대 토큰으로 쓰기를 여는 일은 어댑터가 한다) `owner`, 못 얻으면 3002와 대안이다.
 * - `observe`: 잠금 없이 연다. `observer`. 다른 프로세스가 쥔 thread의 커밋은 관찰 폴링이 전한다(HS-16).
 */
export function createThreadOpenHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.open"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    const exists = ports.threads.exists(threadId);
    if (!exists.ok) throw wireErrorOfStore(exists.error, "thread.open thread lookup");
    if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    if (params.mode === "write") {
      await claimWrite(engine, hub(), context.connectionId, threadId);
    } else {
      const conn = hub().state(context.connectionId);
      if (conn === undefined || conn.phase === "closed") throw wireError("request.cancelled");
      conn.openThreads.add(threadId);
      conn.observedThreads.add(threadId);
      hub().watchObserved();
    }
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    const position = ports.threads.position(threadId);
    if (!position.ok) throw wireErrorOfStore(position.error, "thread.open position");
    return {
      threadId,
      role: params.mode === "write" ? "owner" : "observer",
      position: position.value,
    };
  };
}

/** thread가 있는지 본다. 없으면 3001, 읽기 실패는 store.* 이다 */
function requireThread(engine: Engine, threadId: ThreadId, where: string): void {
  const exists = engine.ports.threads.exists(threadId);
  if (!exists.ok) throw wireErrorOfStore(exists.error, `${where} thread lookup`);
  if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
}

/** HS-28: 이 프로세스가 쓰기 소유를 쥔 thread만. 암묵 획득은 하지 않는다 */
export function requireOwned(engine: Engine, threadId: ThreadId): void {
  if (!engine.ports.locks.holds(threadId)) throw threadLocked(null);
}

function readFailure(error: ThreadReadFailure, where: string): WireError {
  switch (error.kind) {
    case "invalid_target":
      return wireError("thread.invalidTarget", { details: { reason: error.reason } });
    case "busy":
    case "io":
    case "row_invalid":
    case "thread_not_found":
      return wireErrorOfStore(error, where);
    default:
      return assertNever(error, "ThreadReadFailure");
  }
}

export function createThreadListHandler(engine: Engine): WireHandler<"thread.list"> {
  return (params) => engine.ports.threads.list(params);
}

/** F wire §3.4.6. 소유를 얻지 않는 읽기다 */
export function createThreadReadHandler(engine: Engine): WireHandler<"thread.read"> {
  return async (params) => {
    const read = await engine.ports.threads.read(params);
    if (!read.ok) throw readFailure(read.error, "thread.read");
    return read.value;
  };
}

/** 이 연결의 열기 기록을 지운다. 쓰기로 연 연결이 더 없고 live 작업이 없으면(HS-27) 잠금을 푼다(서비스 모드만) */
export function createThreadCloseHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.close"> {
  return (params, context) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.close");
    const conn = hub().state(context.connectionId);
    if (conn === undefined || conn.phase === "closed") {
      return Promise.reject(wireError("request.cancelled"));
    }
    conn.openThreads.delete(threadId);
    conn.writeThreads.delete(threadId);
    conn.observedThreads.delete(threadId);
    hub().releaseUnused([threadId]);
    return Promise.resolve({});
  };
}

/** 원본 thread의 쓰기 소유는 필요 없다. 새 thread를 만들고 그 thread의 쓰기 소유를 얻는다 */
export function createThreadForkHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.fork"> {
  const { ports } = engine;
  return async (params, context) => {
    requireThread(engine, params.threadId, "thread.fork");
    const forked = await ports.threads.fork(params.threadId, params.at);
    if (!forked.ok) throw wireErrorOfLifecycle(forked.error, "thread.fork");
    await claimWrite(engine, hub(), context.connectionId, forked.value.threadId);
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    const position = ports.threads.position(forked.value.threadId);
    if (!position.ok) throw wireErrorOfStore(position.error, "thread.fork position");
    return { threadId: forked.value.threadId, position: position.value };
  };
}

export function createThreadRevertHandler(engine: Engine): WireHandler<"thread.revert"> {
  return async (params) => {
    requireThread(engine, params.threadId, "thread.revert");
    requireOwned(engine, params.threadId);
    const reverted = await engine.ports.threads.revert(params.threadId, params.to);
    if (!reverted.ok) throw wireErrorOfLifecycle(reverted.error, "thread.revert");
    return reverted.value;
  };
}

/**
 * 제목을 바꾼다(G2-12, HS-73). 쓰기 소유자만 바꿀 수 있어 `thread.delete`처럼 열지 않고 바꾸는 클라이언트(`xeon sessions rename`)를 위해
 * 소유를 쥐지 않았으면 한 번 얻어 본다. 얻지 못하면 3002다. 이 호출이 얻은 잠금은 바꾼 뒤 놓되, 그동안 다른 연결이 소유를 이어받았으면
 * 놓지 않는다(`withWriteOwner`). 결과 `position`은 제목 변경 이벤트를 반영한 저장소 위치다
 */
export function createThreadRenameHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.rename"> {
  const { ports } = engine;
  return async (params) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.rename");
    return await withWriteOwner(engine, hub(), threadId, () => {
      const renamed = ports.threads.rename(threadId, params.title);
      if (!renamed.ok) throw wireErrorOfLifecycle(renamed.error, "thread.rename");
      return renamed.value;
    });
  };
}

/**
 * 쓰기 소유자만 지울 수 있다. `xeon sessions rm`처럼 thread를 열지 않고 지우는 클라이언트를 위해 소유를 쥐지 않았으면 한 번 얻어 본다
 * (HS-28 암묵 획득과 같은 규칙. 표(§3.4)가 "잠금을 얻을 수 없으면 거부"라고 적었다). 얻지 못하면 3002다.
 * 지우지 못했으면 이 호출이 얻은 잠금은 놓되, 그동안 다른 연결이 소유를 이어받았으면 놓지 않는다(`withWriteOwner`).
 */
export function createThreadDeleteHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.delete"> {
  const { ports } = engine;
  return async (params) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.delete");
    await withWriteOwner(engine, hub(), threadId, async () => {
      const removed = await ports.threads.remove(threadId);
      if (!removed.ok) throw wireErrorOfLifecycle(removed.error, "thread.delete");
    });
    // 이 thread를 열어 둔 연결의 기록을 지운다
    for (const conn of hub().connections()) {
      conn.openThreads.delete(threadId);
      conn.writeThreads.delete(threadId);
      conn.observedThreads.delete(threadId);
    }
    return {};
  };
}

/** 컴팩션을 끝내지 못한 이유를 와이어 오류로 옮긴다(F wire §3.5.2). 모델 출력과 제공자 응답 본문은 싣지 않는다 */
function compactFailure(error: ThreadCompactFailure, where: string): WireError | Bug {
  switch (error.kind) {
    case "busy":
    case "io":
    case "row_invalid":
    case "thread_not_found":
      return wireErrorOfStore(error, where);
    case "thread_closed":
      return wireError("thread.closed", { details: { threadId: error.threadId } });
    case "turn_running":
      return wireError("turn.busy", { details: { turnId: error.turnId } });
    case "model_unavailable":
      // 요약을 만들 모델이 없다: 요약 호출이 시작되지 못한 것이라 요약 실패 이유로 알린다
      return wireError("thread.compactFailed", { details: { reason: "summary_failed" } });
    case "context_failed":
      return contextFailure(error.error, where);
    default:
      return assertNever(error, "ThreadCompactFailure");
  }
}

function contextFailure(error: ContextError, where: string): WireError | Bug {
  switch (error.kind) {
    case "aborted":
      return wireError("request.cancelled");
    case "branch_not_found":
      // 컨텍스트 서비스가 활성 가지를 스스로 읽는다. 열려 있는 thread에 이벤트가 없다는 것은 저장소의 불변 조건 위반이다
      return new Bug(`${where}: the active branch of an existing thread has no events`, {
        cause: error,
      });
    case "read_failed":
    case "projection_failed":
    case "summary_failed":
    case "summary_has_tool_call":
    case "summary_truncated":
    case "commit_failed":
      return wireError("thread.compactFailed", { details: { reason: error.kind } });
    default:
      return assertNever(error.kind, "ContextErrorKind");
  }
}

/**
 * 대화를 지금 요약한다(G2-01, HS-77). `turn.start`처럼 쓰기 소유를 암묵 획득하고(HS-28), 열린 turn이 있으면 3003이다.
 * 컨텍스트 서비스가 이유 `manual`로 요약하고 `thread.compacted`를 커밋한다. 요약할 것이 없거나 컴팩션이 꺼져 있으면 오류가 아니라
 * `skipped`다. 확장이 막으면 3006(`session_before_compact`), 요약이나 커밋이 실패하면 3008이다
 */
export function createThreadCompactHandler(
  engine: Engine,
  hub: () => ConnectionHub,
): WireHandler<"thread.compact"> {
  const { ports } = engine;
  return async (params, context) => {
    const { threadId } = params;
    requireThread(engine, threadId, "thread.compact");
    await claimWrite(engine, hub(), context.connectionId, threadId);
    const compacted = await ports.threads.compact(threadId, params.instructions, context.signal);
    if (!compacted.ok) {
      ports.log.error("thread.compact_failed", { threadId, kind: compacted.error.kind });
      throw compactFailure(compacted.error, "thread.compact");
    }
    const outcome = compacted.value;
    switch (outcome.status) {
      case "compacted": {
        // 위치는 커밋한 뒤에 읽는다: 컴팩션 이벤트를 반영한 저장소 위치다
        const position = ports.threads.position(threadId);
        if (!position.ok) throw wireErrorOfStore(position.error, "thread.compact position");
        return {
          status: "compacted",
          eventId: outcome.eventId,
          tokensBefore: outcome.tokensBefore,
          fromExtension: outcome.fromExtension,
          position: position.value,
        };
      }
      case "skipped":
        return { status: "skipped", why: outcome.why };
      case "cancelled":
        throw wireError("thread.cancelledByExtension", {
          details: { point: "session_before_compact", reason: outcome.reason.slice(0, 512) },
        });
      default:
        return assertNever(outcome, "CompactOutcome");
    }
  };
}
