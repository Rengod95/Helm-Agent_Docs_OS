// 구성기 흐름의 시험 실행과 테스트 화면이 함께 쓰는 값(§6.28.4, §6.28.8). 드라이브 락 줄, 가드 칩, 단계 사이 기록,
// "다시 돌려 검사"의 잠김, 그룹의 지난 결과. `testRun.phase`와 `ext.test.list`가 준 값만 옮기고 값을 지어내지 않는다.
import { assertNever } from "@fresnel/contracts";
import type { TestRunBoundary, TestRunPhaseResult } from "@fresnel/contracts/extensions";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { replayVerdictOf, testRowsOf, type ReplayVerdict, type TestState } from "./tests.ts";

// ───────── 드라이브 락 줄 ─────────

/** 주도 상태. `held`: 쥐고 있다(주도 유지), `releasing`: 반납이 정해졌다(반납 중), `none`: 쥔 것이 없다(주도 없음) */
export type LockKind = "held" | "releasing" | "none";

export interface LockBarVM {
  readonly kind: LockKind;
  /** 쥔 그룹 확장 이름. 쥔 것이 없으면 null */
  readonly holder: string | null;
}

/** 드라이브 락 줄. wire의 `lock.status`를 화면 상태로 옮기고, 쥔 것이 없으면 보유자를 비운다 */
export function lockBarOf(phase: TestRunPhaseResult): LockBarVM {
  const { lock } = phase;
  switch (lock.status) {
    case "active":
      return { kind: "held", holder: lock.holder };
    case "releasing":
      return { kind: "releasing", holder: lock.holder };
    case "none":
      return { kind: "none", holder: null };
    default:
      return assertNever(lock.status, "TestRunLock status");
  }
}

// ───────── 가드 칩 ─────────

/** 가드 칩. `hits`: 막은 횟수가 있다, `none`: 측정은 켜졌고 막은 것이 없다(칩을 그리지 않는다), `off`: 측정이 꺼져 있다 */
export type GuardChipVM =
  | { readonly kind: "hits"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "off" };

/** 측정이 꺼져 있으면 막은 수는 셀 수 없으므로 `off`가 먼저다. 켜져 있으면 0과 양수를 가른다 */
export function guardChipOf(
  phase: Pick<TestRunPhaseResult, "guardHits" | "traceEnabled">,
): GuardChipVM {
  if (!phase.traceEnabled) return { kind: "off" };
  return phase.guardHits > 0 ? { kind: "hits", count: phase.guardHits } : { kind: "none" };
}

// ───────── 단계 사이 기록 ─────────

export interface BoundaryRowVM {
  /** 그 경계의 상태 revision */
  readonly seq: number;
  /** 그 경계에서 커밋된 단계 이름. 없으면 null */
  readonly phase: string | null;
  /** 그 경계에서 멈춰 기다렸는가 */
  readonly paused: boolean;
}

/** 단계 사이 기록을 새것이 위로 옮긴다. wire는 오래된 것부터 주므로 마지막이 가장 최근이다 */
export function boundaryLogOf(boundaries: readonly TestRunBoundary[]): readonly BoundaryRowVM[] {
  return boundaries.toReversed().map((boundary) => ({
    seq: boundary.seq,
    phase: boundary.phase,
    paused: boundary.paused,
  }));
}

// ───────── 그룹의 지난 결과 ─────────

/** 지난 결과 한 줄. 판정은 replay 보고가 있을 때만 있다(실행 중이거나 보고가 없으면 null) */
export interface LastResultVM {
  readonly testId: string;
  readonly state: TestState;
  readonly startedMs: number | null;
  readonly durationMs: number | null;
  readonly verdict: ReplayVerdict | null;
}

/** 화면에 그리는 지난 결과의 수. 더 오래된 것은 목록에 두지 않는다 */
export const LAST_RESULTS_LIMIT = 5;

export interface LastResultsVM {
  /** 새것이 위. `LAST_RESULTS_LIMIT`개까지다 */
  readonly rows: readonly LastResultVM[];
  /** 이 그룹의 replay 기록 가운데 가장 새것(수를 자르기 전). 기록이 없으면 null */
  readonly latest: LastResultVM | null;
}

/** 이 그룹(`target`)의 replay 기록만 새것이 위로 고른다. Test run 기록은 이 목록에 들지 않는다 */
export function lastResultsOf(records: readonly ExtTestRecord[], target: string): LastResultsVM {
  const all = testRowsOf(records, { kind: "replay", status: "all" }, null)
    .filter((row) => row.target === target)
    .map((row): LastResultVM => ({
      testId: row.testId,
      state: row.state,
      startedMs: row.startedMs,
      durationMs: row.durationMs,
      verdict: row.replay === null ? null : replayVerdictOf(row.replay),
    }));
  return { rows: all.slice(0, LAST_RESULTS_LIMIT), latest: all[0] ?? null };
}

// ───────── 다시 돌려 검사의 잠김 ─────────

/** 다시 돌려 검사가 잠긴 까닭. 연결이 없으면 `offline`(다른 까닭보다 먼저), 배포 앱이면 `devMode`다 */
export type ReplayLock = "devMode" | "offline";

/** 연결이 있고 개발 모드이면 열린다(null). 개발 모드 판정은 호스트 설정을 읽은 값이다 */
export function replayLockOf(devMode: boolean, online: boolean): ReplayLock | null {
  if (!online) return "offline";
  return devMode ? null : "devMode";
}
