import type { WireHandler } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { ownerKindOf, threadLocked } from "./owner.ts";

// L4.host-service.spec §3.4 M1 표. thread.create: thread를 만들고 쓰기 소유를 함께 얻는다(M1에서는 create가 소유를 얻는다).
// thread.open/close/list/fork/revert/delete는 M2다.

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
    const lock = await ports.locks.tryAcquire(created.threadId, ownerKindOf(engine.mode));
    if (!lock.ok) throw threadLocked(lock.ownerKind);
    hub().state(context.connectionId)?.openThreads.add(created.threadId);
    // 위치는 소유를 얻은 뒤에 읽는다: 열기가 이벤트를 커밋했을 수 있다
    return { threadId: created.threadId, position: ports.threads.position(created.threadId) };
  };
}
