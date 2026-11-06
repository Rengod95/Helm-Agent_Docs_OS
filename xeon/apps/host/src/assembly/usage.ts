import { err, ok, parse, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  CompactedPayloadSchema,
  ItemRecordedPayloadSchema,
  type DurableEventEnvelope,
  type ReadFailure,
  type SessionService,
} from "@fresnel/contracts/records";
import type { UsageMeter, UsageRecord } from "@fresnel/contracts/services";
import type { UsageGauge, UsageUnit } from "@fresnel/contracts/wire";
import type { UsagePort } from "../types.ts";

// M3-REQ-15. 사용량 게이지 원천의 조립 기본이다. L1.models 합산기(`ModelService.usage`)의 기록을 구독해 thread와 provider별로 모은다.
// `usage.get`이 `threadId`를 주면 그 thread의 `session` 게이지(tokens, usd, requests, cacheRead, cacheWrite)를, 주지 않으면 모든 thread의 합을 돌려준다. 분에서 월까지의 창, 한도, 계정 행은
// L1이 레이트 리밋과 계정 기록을 보관하지 않아 만들지 않는다(L4.host-service.spec §10 46번 [미결]).
// 원천을 바꿔 끼우는 자리는 `EnginePorts.usage`다. 조립 루트 코드(DR-14 예외 2).

/** provider 하나의 thread 안 합산. 기록 한 건마다 요청 수가 1 늘고 토큰과 비용이 더해진다 */
export interface Tally {
  readonly tokens: number;
  readonly usd: number;
  readonly requests: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export const EMPTY_TALLY: Tally = { tokens: 0, usd: 0, requests: 0, cacheRead: 0, cacheWrite: 0 };

/** 호출마다 어시스턴트 `item.recorded`를 남기지 않는 역할. 내구 기록에서 다시 만든 합계에 합산기의 이 역할 기록을 더한다 */
export const OFF_LOOP_ROLES: readonly string[] = ["summary", "search", "judge", "review"];
const OFF_LOOP_ROLE_SET: ReadonlySet<string> = new Set(OFF_LOOP_ROLES);

/**
 * 측정 저장소에 남은 배경 호출(`OFF_LOOP_ROLES`)을 provider별로 접어 낸다. 재시작 뒤에도 같은 값이 나온다. 측정이 꺼졌거나 저장소를 못 읽으면
 * undefined이고, 그때는 이 프로세스의 합산기가 원천이다
 */
export type BackgroundCallReader = (
  threadId: ThreadId | undefined,
) => ReadonlyMap<string, Tally> | undefined;

function addRecord(tally: Tally, record: UsageRecord): Tally {
  return {
    tokens: tally.tokens + record.usage.totalTokens,
    usd: tally.usd + record.usage.cost.total,
    requests: tally.requests + 1,
    cacheRead: tally.cacheRead + record.usage.cacheRead,
    cacheWrite: tally.cacheWrite + record.usage.cacheWrite,
  };
}

/**
 * 내구 기록 읽기. kind 접두로 조회한다. 활성 분기만이 아니라 되감거나 버린 분기의 기록까지 모두 돌려준다(돈을 쓴 호출은 분기와 상관없이 센다).
 * `threadId`가 없으면 모든 thread의 기록이다. 읽지 못하면 오류 값이다
 */
export type UsageEventReader = (
  threadId: ThreadId | undefined,
  query: { readonly kindPrefix: string },
) => Promise<Result<readonly DurableEventEnvelope[], unknown>>;

/** `provider`와 모델 id로 문맥 창 크기를 찾는다. 모르면 undefined(카탈로그에서 빠진 모델 등) */
export type ContextWindowLookup = (provider: string, modelId: string) => number | undefined;

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

/**
 * `SessionService.readFrom`(커밋 순서, 모든 분기)으로 kind 접두에 맞는 기록을 읽는다. `readBranch`는 활성 분기만 돌려줘 되감거나 버린 분기의 사용량이
 * 빠지므로 쓰지 않는다. `threadId`가 없으면 모든 thread다
 */
export async function readEventsOfAllBranches(
  session: Pick<SessionService, "readFrom">,
  threadId: ThreadId | undefined,
  kindPrefix: string,
): Promise<Result<readonly DurableEventEnvelope[], ReadFailure>> {
  const rows: DurableEventEnvelope[] = [];
  const options = threadId === undefined ? undefined : { threadId };
  for await (const item of session.readFrom(0, options)) {
    if (!item.ok) return err(item.error);
    if (item.value.kind.startsWith(kindPrefix)) rows.push(item.value);
  }
  return ok(rows);
}

function compareNames(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * `meter`의 모든 기록(중단된 호출 포함)을 한 번 구독해 thread와 provider별로 합산하는 원천을 만든다.
 * `gauges`는 `threadId`가 없으면 이 프로세스가 본 모든 thread의 합산이고, 모르는 thread는 빈 목록이다. 창 데이터는 없다.
 */
export function createUsageSource(
  meter: UsageMeter,
  readEvents?: UsageEventReader,
  contextWindowOf?: ContextWindowLookup,
  backgroundCalls?: BackgroundCallReader,
): UsagePort {
  const byThread = new Map<ThreadId, Map<string, Tally>>();
  /** 대화 루프 밖에서 부른 호출(요약, 검색, 판정)의 합산. 어시스턴트 `item.recorded`가 남지 않아 내구 기록에 없다. 이 프로세스가 본 것만 있다 */
  const offLoop = new Map<ThreadId, Map<string, Tally>>();

  meter.subscribe((record: UsageRecord) => {
    if (OFF_LOOP_ROLE_SET.has(record.role)) {
      const own = offLoop.get(record.threadId) ?? new Map<string, Tally>();
      own.set(record.provider, addRecord(own.get(record.provider) ?? EMPTY_TALLY, record));
      offLoop.set(record.threadId, own);
    }
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
  async function durableProviders(
    threadId: ThreadId | undefined,
  ): Promise<Map<string, Tally> | undefined> {
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
    context: async (threadId) => {
      if (readEvents === undefined || contextWindowOf === undefined) return undefined;
      const read = await readEvents(threadId, { kindPrefix: "item.recorded" });
      if (!read.ok) return undefined;
      // 커밋 순서로 가장 나중의 끝난 어시스턴트 호출이 지금 문맥의 크기다(분기를 되감았어도 돈을 쓴 마지막 호출을 본다).
      // 그 호출 뒤에 요약(`thread.compacted`)이 커밋됐으면 다음 호출 전까지 문맥은 요약 뒤 추정 토큰(`tokensAfter`)이다
      let latest:
        | { readonly provider: string; readonly model: string; readonly used: number }
        | undefined;
      let latestSeq = 0;
      for (const event of read.value) {
        if (event.kind !== "item.recorded") continue;
        const checked = parse(ItemRecordedPayloadSchema, event.payload);
        if (!checked.ok || checked.value.item.kind !== "assistant") continue;
        if (checked.value.item.status !== "completed") continue;
        const message = checked.value.item.message;
        latest = {
          provider: message.provider,
          model: message.model,
          used: message.usage.totalTokens,
        };
        latestSeq = event.seq;
      }
      if (latest !== undefined) {
        const compactedRead = await readEvents(threadId, { kindPrefix: "thread.compacted" });
        if (compactedRead.ok) {
          let afterSeq = latestSeq;
          for (const event of compactedRead.value) {
            if (event.kind !== "thread.compacted" || event.seq <= afterSeq) continue;
            const checked = parse(CompactedPayloadSchema, event.payload);
            if (!checked.ok || checked.value.tokensAfter === undefined) continue;
            afterSeq = event.seq;
            latest = { ...latest, used: checked.value.tokensAfter };
          }
        }
      }
      if (latest === undefined) return undefined;
      const limit = contextWindowOf(latest.provider, latest.model);
      if (limit === undefined || limit < 1) return undefined;
      return { model: `${latest.provider}/${latest.model}`, used: latest.used, limit };
    },
    gauges: async ({ providerId, threadId }) => {
      // 내구 기록이 있으면 그것이 원천이다(재시작 뒤와 버린 분기 포함). 읽지 못할 때만 이 프로세스의 합산기로 돌아간다.
      // threadId가 없으면 모든 thread의 내구 기록 합이고, 읽지 못하면 이 프로세스가 본 모든 thread의 합산기 합이다
      const durable = await durableProviders(threadId);
      const stored = backgroundCalls?.(threadId);
      const background =
        stored !== undefined
          ? [stored]
          : threadId === undefined
            ? [...offLoop.values()]
            : [offLoop.get(threadId)];
      const scoped =
        durable !== undefined
          ? [durable, ...background]
          : threadId === undefined
            ? [...byThread.values()]
            : [byThread.get(threadId)];
      const totals = new Map<string, Tally>();
      for (const providers of scoped) {
        if (providers === undefined) continue;
        for (const [name, tally] of providers) {
          const sum = totals.get(name) ?? EMPTY_TALLY;
          totals.set(name, {
            tokens: sum.tokens + tally.tokens,
            usd: sum.usd + tally.usd,
            requests: sum.requests + tally.requests,
            cacheRead: sum.cacheRead + tally.cacheRead,
            cacheWrite: sum.cacheWrite + tally.cacheWrite,
          });
        }
      }
      const gauges = [...totals.entries()]
        .filter(([name]) => providerId === undefined || name === providerId)
        .toSorted(([a], [b]) => compareNames(a, b))
        .flatMap(([name, tally]) => sessionGauges(name, tally));
      return gauges;
    },
  };
}
