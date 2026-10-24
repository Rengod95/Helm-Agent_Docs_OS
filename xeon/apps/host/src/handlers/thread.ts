import { wireError, type WireHandler } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { wireErrorOfStore } from "../store-error.ts";
import { claimWrite } from "./owner.ts";

// L4.host-service.spec §3.4 M1 표. thread.create: thread를 만들고 쓰기 소유를 함께 얻는다(M1에서는 create가 소유를 얻는다).
// thread.open은 아래에 있다. thread.close/list/fork/revert/delete는 M2 나머지 처리기다(HOST.2).

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
