import { wireError, type WireHandler } from "@xeon/contracts/wire";
import type { Engine } from "../types.ts";
import { wireErrorOfStore } from "../store-error.ts";

// F wire §3.3.1 usage.get. L4.host-service.spec HS-95, M3-REQ-15. 사용량 게이지를 원천(`EnginePorts.usage`)에서 읽어 돌려준다.
// 읽기만 하므로 쓰기 소유를 얻지 않는다. 조립 기본 원천은 thread의 세션 게이지를 만든다(assembly/usage.ts). `threadId`가 없으면 빈 목록이다.

/** wire 결과 `gauges`의 상한(F wire §3.3.1 `UsageGetResultSchema` maxItems 256) */
const USAGE_GAUGES_MAX = 256;

/**
 * `threadId`를 주면 그 thread가 있어야 한다(3001). `providerId`는 원천이 받은 값을 한 번 더 거른다. 원천이 상한을 넘는 게이지를 내면
 * 결과 스키마를 어기므로 내부 오류로 끝낸다(잘라서 조용히 빼지 않는다)
 */
export function createUsageGetHandler(engine: Engine): WireHandler<"usage.get"> {
  const { threads, usage } = engine.ports;
  return async (params, context) => {
    const { providerId, threadId } = params;
    if (threadId !== undefined) {
      const exists = threads.exists(threadId);
      if (!exists.ok) throw wireErrorOfStore(exists.error, "usage.get thread lookup");
      if (!exists.value) throw wireError("thread.notFound", { details: { threadId } });
    }
    const gauges = await usage.gauges(
      {
        ...(providerId === undefined ? {} : { providerId }),
        ...(threadId === undefined ? {} : { threadId }),
      },
      context.signal,
    );
    const matched =
      providerId === undefined
        ? [...gauges]
        : gauges.filter((gauge) => gauge.providerId === providerId);
    if (matched.length > USAGE_GAUGES_MAX) {
      throw wireError("internal", {
        message: `usage.get: the usage source returned ${String(matched.length)} gauges, the limit is ${String(USAGE_GAUGES_MAX)}`,
      });
    }
    return { gauges: matched, asOf: new Date(engine.ports.clock.now()).toISOString() };
  };
}
