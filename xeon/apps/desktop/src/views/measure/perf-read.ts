// 성능 측정 첫 화면의 읽기: 일별 집계 몇 개와 대화의 최근 Turn(상한 `PERF_TURNS_MAX`개)을 함께 읽는다.
// 일부만 실패하면 읽은 만큼 보이고, 전부 실패하면 오류다.
import {
  failingOf,
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
