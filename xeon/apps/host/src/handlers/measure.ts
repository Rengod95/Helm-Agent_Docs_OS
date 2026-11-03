import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import { wireError, type WireHandler } from "@fresnel/contracts/wire";
import type { Engine } from "../types.ts";
import { wireErrorOfStore } from "../store-error.ts";

// F wire §3.3.8 measure.turn, measure.daily (T-MEAS-READ). 측정 저장소(`EnginePorts.measure`)를 읽어 그대로 돌려준다. 읽기만 하므로 쓰기 소유를 얻지 않는다.
// 모양이 틀린 thread id는 없는 thread와 같이 3001이다. 저장소 읽기 실패는 `store.io`로 옮긴다.

export function createMeasureHandlers(engine: Engine): {
  readonly "measure.turn": WireHandler<"measure.turn">;
  readonly "measure.daily": WireHandler<"measure.daily">;
} {
  const { threads, measure } = engine.ports;
  return {
    "measure.turn": (params) => {
      const threadId = parse(ThreadIdSchema, params.threadId);
      if (!threadId.ok) {
        throw wireError("thread.notFound", { details: { threadId: params.threadId } });
      }
      const exists = threads.exists(threadId.value);
      if (!exists.ok) throw wireErrorOfStore(exists.error, "measure.turn thread lookup");
      if (!exists.value)
        throw wireError("thread.notFound", { details: { threadId: params.threadId } });
      const read = measure.turn(threadId.value, params.turnId);
      if (!read.ok) throw wireError("store.io", { message: `measure.turn: ${read.error.kind}` });
      return Promise.resolve(read.value);
    },
    "measure.daily": (params) => {
      const read = measure.daily(params.kind, params.metric);
      if (!read.ok) throw wireError("store.io", { message: `measure.daily: ${read.error.kind}` });
      return Promise.resolve(read.value);
    },
  };
}
