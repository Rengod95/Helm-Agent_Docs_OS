import type { Result } from "@fresnel/contracts";
import { parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { ItemRecordedPayloadSchema, type DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageMeter, UsageRecord } from "@fresnel/contracts/services";
import type { UsageGauge, UsageUnit } from "@fresnel/contracts/wire";
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
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const EMPTY_TALLY: Tally = { tokens: 0, usd: 0, requests: 0, cacheRead: 0, cacheWrite: 0 };

/** 내구 기록 읽기. 어시스턴트 `item.recorded`를 접두로 조회한다(`ExtHost.queryEvents`와 같은 모양). 읽지 못하면 오류 값이다 */
export type UsageEventReader = (
  threadId: ThreadId,
  query: { readonly kindPrefix: string },
) => Promise<Result<readonly DurableEventEnvelope[], unknown>>;

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

/** provider 하나의 세션 게이지 다섯 줄을 tokens, usd, requests, cacheRead, cacheWrite 순서로 낸다 */
function sessionGauges(providerId: string, tally: Tally): readonly UsageGauge[] {
  return [
    sessionGauge(providerId, "tokens", tally.tokens),
    sessionGauge(providerId, "usd", tally.usd),
    sessionGauge(providerId, "requests", tally.requests),
    sessionGauge(providerId, "cacheRead", tally.cacheRead),
    sessionGauge(providerId, "cacheWrite", tally.cacheWrite),
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
export function createUsageSource(meter: UsageMeter, readEvents?: UsageEventReader): UsagePort {
  const byThread = new Map<ThreadId, Map<string, Tally>>();

  meter.subscribe((record: UsageRecord) => {
    const providers = byThread.get(record.threadId) ?? new Map<string, Tally>();
    const tally = providers.get(record.provider) ?? EMPTY_TALLY;
    providers.set(record.provider, {
      tokens: tally.tokens + record.usage.totalTokens,
      usd: tally.usd + record.usage.cost.total,
      requests: tally.requests + 1,
      cacheRead: tally.cacheRead + record.usage.cacheRead,
      cacheWrite: tally.cacheWrite + record.usage.cacheWrite,
    });
    byThread.set(record.threadId, providers);
  });

  /** 내구 기록(어시스턴트 `item.recorded`의 `message.usage`)을 provider별로 접는다. 재시작해도 같은 값이 나온다. 읽지 못하면 undefined */
  async function durableProviders(threadId: ThreadId): Promise<Map<string, Tally> | undefined> {
    if (readEvents === undefined) return undefined;
    const read = await readEvents(threadId, { kindPrefix: "item.recorded" });
    if (!read.ok) return undefined;
    const providers = new Map<string, Tally>();
    for (const event of read.value) {
      if (event.kind !== "item.recorded") continue;
      const checked = parse(ItemRecordedPayloadSchema, event.payload);
      if (!checked.ok || checked.value.item.kind !== "assistant") continue;
      const message = checked.value.item.message;
      const tally = providers.get(message.provider) ?? EMPTY_TALLY;
      providers.set(message.provider, {
        tokens: tally.tokens + message.usage.totalTokens,
        usd: tally.usd + message.usage.cost.total,
        requests: tally.requests + 1,
        cacheRead: tally.cacheRead + message.usage.cacheRead,
        cacheWrite: tally.cacheWrite + message.usage.cacheWrite,
      });
    }
    return providers;
  }

  return {
    gauges: async ({ providerId, threadId }) => {
      if (threadId === undefined) return [];
      // 내구 기록이 있으면 그것이 원천이다. 읽지 못할 때만 이 프로세스의 합산기로 돌아간다
      const providers = (await durableProviders(threadId)) ?? byThread.get(threadId);
      if (providers === undefined) return [];
      const gauges = [...providers.entries()]
        .filter(([name]) => providerId === undefined || name === providerId)
        .toSorted(([a], [b]) => compareNames(a, b))
        .flatMap(([name, tally]) => sessionGauges(name, tally));
      return gauges;
    },
  };
}
