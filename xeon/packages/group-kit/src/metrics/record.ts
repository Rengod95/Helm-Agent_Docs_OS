import { parse } from "@xeon/contracts";
import {
  AgentSettledPayloadSchema,
  type GroupId,
  type RecordKind,
  type ScopeApi,
} from "@xeon/contracts/extensions";
import type { MetricsCounter } from "./counter.ts";
import type { AfterRun } from "./handler.ts";
import type { GroupMetricsTotals } from "./types.ts";

/** 계측을 켜고 끄는 설정 키(L3.group-kit.spec §6). 값이 false일 때만 끈 것이다 */
export const INSTRUMENTATION_KEY = "l3.group-kit.instrumentation";

/** 같은 프로세스에서 기록을 마친 turn을 기억하는 개수. 재발화는 대개 최근 turn에 일어난다 */
const REMEMBERED_TURNS = 64;

interface BoundaryRecordOptions {
  readonly api: Pick<ScopeApi<never>, "recordPrivate">;
  readonly groupId: GroupId;
  readonly counter: MetricsCounter;
  /** 경계마다 부른다. 설정을 읽지 못하거나 값이 없으면 참이다 */
  readonly enabled: () => boolean;
}

/** 증가분 가운데 0이 아닌 값이 하나라도 있는가 */
function hasChange(delta: GroupMetricsTotals): boolean {
  const values = [
    delta.denies,
    delta.chainPatches,
    delta.handlerErrors,
    delta.posts,
    delta.spawns,
    delta.delegates,
    delta.commits,
    delta.records,
    delta.leases,
    delta.tokens.input,
    delta.tokens.output,
    delta.tokens.cacheRead,
    delta.tokens.cacheWrite,
    delta.costUsd,
    delta.leaseMs,
  ];
  return values.some((value) => value !== 0);
}

function remember(turns: Set<string>, turnId: string): void {
  turns.add(turnId);
  const [oldest] = turns;
  if (turns.size > REMEMBERED_TURNS && oldest !== undefined) turns.delete(oldest);
}

/**
 * 그룹의 `boundary.settle.after` 핸들러가 끝난 뒤 마지막 기록 뒤의 증가분을 `grp.<그룹>.metrics.recorded`로 쓴다(L3.group-kit.spec §4.9).
 * 이 함수는 핸들러 호출 안에서 돈다. 그래서 `recordPrivate`의 멱등 키가 그룹 자신의 호출 번호 뒤로 이어지고, 그룹이 쓴 같은 키의 기록과 겹치지 않는다.
 * 같은 호출(dispatch)에서는 한 번만 쓰고, 이 프로세스에서 기록을 마친 turn은 다시 쓰지 않는다.
 * 쓰기가 성공했을 때만 기준을 옮긴다. 쓰기가 실패하면 다음 경계의 기록에 증가분이 그대로 든다.
 */
export function createBoundaryRecorder(options: BoundaryRecordOptions): AfterRun {
  const kind: RecordKind = `grp.${options.groupId}.metrics.recorded`;
  const dispatches = new WeakSet<object>();
  const turns = new Set<string>();
  return async (args) => {
    const payload: unknown = args[0];
    if (typeof payload !== "object" || payload === null || dispatches.has(payload)) return;
    dispatches.add(payload);
    const checked = parse(AgentSettledPayloadSchema, payload);
    if (!checked.ok) return;
    const turnId: string = checked.value.turnId;
    if (turns.has(turnId)) return;
    remember(turns, turnId);
    if (!options.enabled()) return;
    const { delta, now } = options.counter.unrecorded();
    if (!hasChange(delta)) return;
    await options.api.recordPrivate(kind, { stepId: turnId, delta });
    options.counter.markRecorded(now);
  };
}
