import type { ThreadId } from "@xeon/contracts/conversation";
import type { UsageMeter, UsageRecord } from "@xeon/contracts/services";
import type { UsageGauge, UsageUnit } from "@xeon/contracts/wire";
import type { UsagePort } from "../types.ts";

// M3-REQ-15. 사용량 게이지 원천의 조립 기본이다. L1.models 합산기(`ModelService.usage`)의 기록을 구독해 thread와 provider별로 모은다.
// `usage.get`이 `threadId`를 주면 그 thread의 `session` 게이지(tokens, usd, requests)를 돌려준다. 분에서 월까지의 창, 한도, 계정 행은
// L1이 레이트 리밋과 계정 기록을 보관하지 않아 만들지 않는다(L4.host-service.spec §10 46번 [미결]).
// 원천을 바꿔 끼우는 자리는 `EnginePorts.usage`다. 조립 루트 코드(DR-14 예외 2).

/** provider 하나의 thread 안 합산. 기록 한 건마다 요청 수가 1 늘고 토큰과 비용이 더해진다 */
interface Tally {
  readonly tokens: number;
  readonly usd: number;
  readonly requests: number;
}

const EMPTY_TALLY: Tally = { tokens: 0, usd: 0, requests: 0 };

/** 세션 게이지의 한 줄. 계정이 없으므로 id의 계정 자리는 빈 문자열이다 */
function sessionGauge(providerId: string, unit: UsageUnit, used: number): UsageGauge {
  return {
    id: `${providerId}::session:${unit}`,
    providerId,
    account: null,
    window: "session",
    unit,
    used,
    limit: null,
    resetsAt: null,
  };
}

/** provider 하나의 세션 게이지 세 줄을 tokens, usd, requests 순서로 낸다 */
function sessionGauges(providerId: string, tally: Tally): readonly UsageGauge[] {
  return [
    sessionGauge(providerId, "tokens", tally.tokens),
    sessionGauge(providerId, "usd", tally.usd),
    sessionGauge(providerId, "requests", tally.requests),
  ];
}

function compareNames(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * `meter`의 모든 기록(중단된 호출 포함)을 한 번 구독해 thread와 provider별로 합산하는 원천을 만든다.
 * `gauges`는 `threadId`가 없으면 빈 목록이다. 창 데이터가 없기 때문이다. 모르는 thread도 빈 목록이다.
 */
export function createUsageSource(meter: UsageMeter): UsagePort {
  const byThread = new Map<ThreadId, Map<string, Tally>>();

  meter.subscribe((record: UsageRecord) => {
    const providers = byThread.get(record.threadId) ?? new Map<string, Tally>();
    const tally = providers.get(record.provider) ?? EMPTY_TALLY;
    providers.set(record.provider, {
      tokens: tally.tokens + record.usage.totalTokens,
      usd: tally.usd + record.usage.cost.total,
      requests: tally.requests + 1,
    });
    byThread.set(record.threadId, providers);
  });

  return {
    gauges: ({ providerId, threadId }) => {
      if (threadId === undefined) return Promise.resolve([]);
      const providers = byThread.get(threadId);
      if (providers === undefined) return Promise.resolve([]);
      const gauges = [...providers.entries()]
        .filter(([name]) => providerId === undefined || name === providerId)
        .toSorted(([a], [b]) => compareNames(a, b))
        .flatMap(([name, tally]) => sessionGauges(name, tally));
      return Promise.resolve(gauges);
    },
  };
}
