// 성능 측정 첫 화면의 읽기: 일별 집계 몇 개와 대화의 최근 Turn(상한 `PERF_TURNS_MAX`개)을 함께 읽는다.
// 일부만 실패하면 읽은 만큼 보이고, 전부 실패하면 오류다.
import {
  failingOf,
  perfViewOf,
  type BurdenRowVM,
  type DailySeries,
  type FailingExtensionVM,
  type PerfTurnInput,
} from "@fresnel/client/workbench";
import { err, ok, type Result } from "@fresnel/contracts";
import type { Commands, CommandError } from "../commands.ts";

/** 한 번에 읽는 Turn 수. 가장 최근 것부터 */
const PERF_TURNS_MAX = 20;

/** 달라진 것으로 보는 지표(저장소의 이름 그대로) */
const PERF_SERIES: readonly { readonly kind: string; readonly metric: string }[] = [
  { kind: "turn", metric: "totalTokens" },
  { kind: "turn", metric: "usd" },
  { kind: "call", metric: "firstTokenMs" },
  { kind: "call", metric: "durationMs" },
];

export interface PerfInput {
  readonly series: readonly DailySeries[];
  readonly turns: readonly PerfTurnInput[];
  /** 읽은 Turn보다 오래된 Turn이 더 있는가(번호는 읽은 목록 안의 차례다) */
  readonly capped: boolean;
  /** 지금 연달아 실패 중인 확장(`ext.health`). 못 읽으면 빈 목록이다 */
  readonly failing: readonly FailingExtensionVM[];
}

export async function loadPerf(
  commands: Pick<Commands, "measure" | "workbench">,
  threadId: string | null,
  turnIds: readonly string[],
): Promise<Result<PerfInput, CommandError>> {
  const recent = turnIds.slice(-PERF_TURNS_MAX);
  const [dailies, turns, health] = await Promise.all([
    Promise.all(PERF_SERIES.map((s) => commands.measure.daily(s.kind, s.metric))),
    Promise.all(threadId === null ? [] : recent.map((id) => commands.measure.turn(threadId, id))),
    commands.workbench.health(),
  ]);
  const series: DailySeries[] = [];
  dailies.forEach((got, index) => {
    const spec = PERF_SERIES[index];
    if (got.ok && spec !== undefined) {
      series.push({
        kind: spec.kind,
        metric: spec.metric,
        days: got.value.enabled ? got.value.days : [],
      });
    }
  });
  const read: PerfTurnInput[] = [];
  turns.forEach((got, index) => {
    const turnId = recent[index];
    if (got.ok && turnId !== undefined) read.push({ turnId, result: got.value });
  });
  const errors: CommandError[] = [];
  for (const got of [...dailies, ...turns]) if (!got.ok) errors.push(got.error);
  const firstError = errors[0];
  if (series.length === 0 && read.length === 0 && firstError !== undefined) return err(firstError);
  return ok({
    series,
    turns: read,
    capped: turnIds.length > PERF_TURNS_MAX,
    failing: health.ok ? failingOf(health.value) : [],
  });
}

/** 확장 하나의 부담 읽기 결과. 성능 측정 화면의 플러그인 부담 표(`perfViewOf`의 `burden`)와 같은 원천과 계산이다 */
export type OwnerBurden =
  /** 계측이 꺼져 있다 */
  | { readonly kind: "off" }
  /** 읽을 대화나 Turn이 없다 */
  | { readonly kind: "empty" }
  /** 읽은 Turn `turns`개 가운데 이 확장의 줄. 읽은 Turn에 이 확장이 없으면 `row`는 null이다 */
  | { readonly kind: "ready"; readonly turns: number; readonly row: BurdenRowVM | null };

/** 대화의 최근 Turn(상한 `PERF_TURNS_MAX`개)을 읽어 `owner` 확장의 부담 줄을 낸다. 일별 집계는 읽지 않는다 */
export async function loadOwnerBurden(
  commands: Pick<Commands, "measure">,
  threadId: string | null,
  turnIds: readonly string[],
  owner: string,
): Promise<Result<OwnerBurden, CommandError>> {
  if (threadId === null || turnIds.length === 0) return ok({ kind: "empty" });
  const recent = turnIds.slice(-PERF_TURNS_MAX);
  const got = await Promise.all(recent.map((id) => commands.measure.turn(threadId, id)));
  const read: PerfTurnInput[] = [];
  got.forEach((result, index) => {
    const turnId = recent[index];
    if (result.ok && turnId !== undefined) read.push({ turnId, result: result.value });
  });
  const failed = got.flatMap((result) => (result.ok ? [] : [result.error]));
  const firstError = failed[0];
  if (read.length === 0 && firstError !== undefined) return err(firstError);
  const state = perfViewOf([], read);
  if (state.kind !== "ready") return ok({ kind: state.kind });
  return ok({
    kind: "ready",
    turns: read.length,
    row: state.view.burden.find((row) => row.owner === owner) ?? null,
  });
}
