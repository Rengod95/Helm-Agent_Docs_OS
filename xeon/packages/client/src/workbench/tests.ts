// P-19 테스트 화면(§6.26)의 순수 모델. 목록 행과 거르기, replay 판정과 절단 띠, Test run 제어, O-12 새 시험 항목과 제출 계획을 만든다.
// 엔진이 준 값만 쓴다. 절단 띠의 칸은 `ReplayReport.cuts`의 커밋마다 같음·다름을 그대로 옮긴다.
import { assertNever } from "@fresnel/contracts";
import type { ReplayFailure, ReplayReport } from "@fresnel/contracts/services";
import type { ExtTestKind, ExtTestRecord, ExtTestRunParams } from "@fresnel/contracts/wire";

/** 개발 모드 판정 설정 키(호스트 `isDevMode`와 같다). 호스트가 이 키를 등록하기 전에는 읽히지 않고 개발 모드가 아니다 */
export const DEV_MODE_SETTING_KEY = "l3.authoring.devMode";

export type TestKind = ExtTestKind;
export type TestState = ExtTestRecord["state"];
export type TestKindFilter = "all" | TestKind;
export type TestStatusFilter = "all" | TestState;

/** 목록 거르기. 종류와 상태 둘 다 "모두"가 기본이다 */
export interface TestFilter {
  readonly kind: TestKindFilter;
  readonly status: TestStatusFilter;
}

export const ALL_TESTS: TestFilter = { kind: "all", status: "all" };

/** 목록 행 하나. 글은 화면이 메시지 키로 그린다 */
export interface TestRowVM {
  readonly testId: string;
  readonly kind: TestKind;
  readonly target: string;
  readonly state: TestState;
  /** 시작 시각(epoch ms). 읽을 수 없는 값이면 null */
  readonly startedMs: number | null;
  readonly durationMs: number | null;
  readonly threadId: string | null;
  readonly replay: ReplayReport | null;
}

function startedMsOf(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function rowOf(record: ExtTestRecord): TestRowVM {
  return {
    testId: record.testId,
    kind: record.kind,
    target: record.target,
    state: record.state,
    startedMs: startedMsOf(record.startedAt),
    durationMs: record.durationMs,
    threadId: record.threadId,
    replay: record.replay,
  };
}

/** 최신이 위. 시각을 읽을 수 없는 행은 맨 아래다 */
function newestFirst(a: TestRowVM, b: TestRowVM): number {
  if (a.startedMs === b.startedMs) return 0;
  if (a.startedMs === null) return 1;
  if (b.startedMs === null) return -1;
  return b.startedMs - a.startedMs;
}

/** 목록 행. 종류와 상태로 거른 뒤 최신이 위로 오게 정렬한다(대화로는 거르지 않는다) */
export function testRowsOf(
  records: readonly ExtTestRecord[],
  filter: TestFilter,
): readonly TestRowVM[] {
  return records
    .map(rowOf)
    .filter((row) => filter.kind === "all" || row.kind === filter.kind)
    .filter((row) => filter.status === "all" || row.state === filter.status)
    .toSorted(newestFirst);
}

// ───────── replay 결과 ─────────

/** replay 판정. 실패 종류가 있으면 그것이, 없고 같지 않으면 "digest 다름"이다 */
export type ReplayVerdict =
  | { readonly kind: "same" }
  | { readonly kind: "digest-differs" }
  | { readonly kind: "failure"; readonly failure: ReplayFailure };

export function replayVerdictOf(report: ReplayReport): ReplayVerdict {
  if (report.failure !== null) return { kind: "failure", failure: report.failure };
  return report.ok ? { kind: "same" } : { kind: "digest-differs" };
}

/** 절단 띠의 한 칸. 커밋 하나의 절단이 기준 실행과 같았는가(`ReplayReport.cuts`의 `equal`) */
export type CutCell = "same" | "differs";

/** 한 칸은 커밋 하나의 절단이다. 칸이 너무 많으면 앞쪽 `CUT_STRIP_LIMIT`칸만 그리고 나머지는 수로 센다 */
export const CUT_STRIP_LIMIT = 200;

export interface CutStripVM {
  readonly commits: number;
  readonly passed: number;
  readonly cells: readonly { readonly commitIndex: number; readonly cell: CutCell }[];
  readonly hidden: number;
}

/** `cuts`의 앞쪽 칸만 그린다. 그리지 않은 수가 `hidden`이다(`cuts`가 커밋 수보다 짧으면 빠진 칸도 여기 든다) */
export function cutStripOf(report: ReplayReport): CutStripVM {
  const drawn = report.cuts.slice(0, CUT_STRIP_LIMIT);
  return {
    commits: report.commits,
    passed: report.passed,
    cells: drawn.map((cut) => ({
      commitIndex: cut.commitIndex,
      cell: cut.equal ? "same" : "differs",
    })),
    hidden: report.commits - drawn.length,
  };
}

/** 효과 수 네 칸. 순서는 wire와 같다(turn, spawn, delegate, post). 판정 없이 참고 값으로만 쓴다 */
export const EFFECT_KEYS = ["turn", "spawn", "delegate", "post"] as const;
export type EffectKey = (typeof EFFECT_KEYS)[number];

export function effectRowsOf(report: ReplayReport): readonly {
  readonly key: EffectKey;
  readonly value: number;
}[] {
  return EFFECT_KEYS.map((key) => ({ key, value: report.effects[key] }));
}

/** "JSON 복사"가 쓰는 글. 보고서를 있는 그대로 적는다(새 형식을 만들지 않는다, §6.26) */
export function reportJsonOf(report: ReplayReport): string {
  return JSON.stringify(report, null, 2);
}

// ───────── Test run 제어 ─────────

export type RunControl = "pause" | "resume" | "step";

/**
 * Test run 행의 제어. 실행 중인 Test run만 있다. 멈춘 채면 "이어서"와 "한 경계씩", 아니면 "멈춤"이다.
 * replay와 benchmark의 "실행 취소"는 취소 wire가 없어 두지 않는다(§6.26).
 */
export function runControlsOf(row: TestRowVM, paused: boolean): readonly RunControl[] {
  if (row.kind !== "testRun" || row.state !== "running" || row.threadId === null) return [];
  return paused ? ["resume", "step"] : ["pause"];
}

// ───────── O-12 새 시험 ─────────

export const NEW_TEST_KINDS = ["testRun", "replay", "benchmark", "coreDiff", "abCompare"] as const;
export type NewTestKind = (typeof NEW_TEST_KINDS)[number];

/** 잠금 이유. `devMode`는 배포 앱에서 개발 모드에만 열리는 종류, `isolation`은 작업 폴더 격리(T-TEST-ISO)가 없어서다 */
export type NewTestLock = "devMode" | "isolation" | null;

export interface NewTestItemVM {
  readonly kind: NewTestKind;
  readonly devOnly: boolean;
  readonly lock: NewTestLock;
  /** 이 배포에서 시작할 수 있나. 벤치마크·코어 변경 검사는 wire가 없고(W-30), 켬/끔 비교는 잠겨 있다 */
  readonly startable: boolean;
  /** 시작 전에 예상 실행 수와 비용 범위를 한 번 확인한다(§6.26) */
  readonly costConfirm: boolean;
}

interface ItemRule {
  readonly devOnly: boolean;
  readonly isolated: boolean;
  readonly wired: boolean;
  readonly costConfirm: boolean;
}

const ITEM_RULES: Readonly<Record<NewTestKind, ItemRule>> = {
  testRun: { devOnly: false, isolated: false, wired: true, costConfirm: false },
  replay: { devOnly: true, isolated: false, wired: true, costConfirm: false },
  benchmark: { devOnly: true, isolated: false, wired: false, costConfirm: false },
  coreDiff: { devOnly: true, isolated: false, wired: false, costConfirm: false },
  abCompare: { devOnly: false, isolated: true, wired: false, costConfirm: true },
};

export function newTestItemOf(kind: NewTestKind, devMode: boolean): NewTestItemVM {
  const rule = ITEM_RULES[kind];
  const lock: NewTestLock = rule.isolated
    ? "isolation"
    : rule.devOnly && !devMode
      ? "devMode"
      : null;
  return {
    kind,
    devOnly: rule.devOnly,
    lock,
    startable: rule.wired && lock === null,
    costConfirm: rule.costConfirm,
  };
}

/** 종류 선택의 항목 전부. 개발 모드가 아니면 replay·벤치마크·코어 변경 검사가 잠긴다. 읽기와 Test run은 늘 열려 있다 */
export function newTestItemsOf(devMode: boolean): readonly NewTestItemVM[] {
  return NEW_TEST_KINDS.map((kind) => newTestItemOf(kind, devMode));
}

export const TEST_TARGET_MAX = 96;
export const REPLAY_MAX_COMMITS = { min: 1, max: 100000 } as const;
export const BENCHMARK_RUNS = { min: 1, max: 50 } as const;
export const DEFAULT_MAX_COMMITS = "200";
export const DEFAULT_RUNS = "3";

/** 새 시험 시트의 입력. 숫자 칸은 글자로 두고 검사할 때 바꾼다 */
export interface NewTestDraft {
  readonly kind: NewTestKind;
  readonly target: string;
  /** Test run의 과제. 시험 대화를 열고 첫 턴으로 보낸다(Test run만 쓴다) */
  readonly prompt: string;
  readonly maxCommits: string;
  readonly runs: string;
}

export const NEW_TEST_DEFAULT: NewTestDraft = {
  kind: "testRun",
  target: "",
  prompt: "",
  maxCommits: DEFAULT_MAX_COMMITS,
  runs: DEFAULT_RUNS,
};

export const TEST_PROMPT_MAX = 8000;

export type NewTestField = "target" | "prompt" | "maxCommits" | "runs";

export interface NewTestError {
  readonly field: NewTestField;
  readonly reason: "required" | "tooLong" | "range";
}

function integerOf(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** 입력 검사. 대상 이름은 모든 종류가 쓰고, 최대 커밋 수는 replay만, 실행 횟수는 벤치마크만 쓴다 */
export function draftErrorsOf(draft: NewTestDraft): readonly NewTestError[] {
  const errors: NewTestError[] = [];
  const target = draft.target.trim();
  if (target === "") errors.push({ field: "target", reason: "required" });
  else if (target.length > TEST_TARGET_MAX) errors.push({ field: "target", reason: "tooLong" });
  if (draft.kind === "testRun") {
    const prompt = draft.prompt.trim();
    if (prompt === "") errors.push({ field: "prompt", reason: "required" });
    else if (prompt.length > TEST_PROMPT_MAX) errors.push({ field: "prompt", reason: "tooLong" });
  }
  if (draft.kind === "replay") {
    const commits = integerOf(draft.maxCommits);
    if (commits === null || commits < REPLAY_MAX_COMMITS.min || commits > REPLAY_MAX_COMMITS.max) {
      errors.push({ field: "maxCommits", reason: "range" });
    }
  }
  if (draft.kind === "benchmark") {
    const runs = integerOf(draft.runs);
    if (runs === null || runs < BENCHMARK_RUNS.min || runs > BENCHMARK_RUNS.max) {
      errors.push({ field: "runs", reason: "range" });
    }
  }
  return errors;
}

/** "시작"을 눌렀을 때 할 일. 잠김과 wire 없음을 입력 검사보다 먼저 본다 */
export type SubmitPlan =
  | { readonly kind: "locked"; readonly lock: Exclude<NewTestLock, null> }
  | { readonly kind: "unwired" }
  | { readonly kind: "invalid"; readonly errors: readonly NewTestError[] }
  /** `confirm`이 참이면 실행 전에 예상 실행 수와 비용 범위를 확인한다 */
  | {
      readonly kind: "run";
      readonly params: ExtTestRunParams;
      /** Test run이면 시험 대화의 첫 턴으로 보낼 과제(앞뒤 공백을 뺀 것), 아니면 null */
      readonly prompt: string | null;
      readonly confirm: boolean;
    };

export function submitPlanOf(draft: NewTestDraft, devMode: boolean): SubmitPlan {
  const item = newTestItemOf(draft.kind, devMode);
  if (item.lock !== null) return { kind: "locked", lock: item.lock };
  if (!item.startable) return { kind: "unwired" };
  const errors = draftErrorsOf(draft);
  if (errors.length > 0) return { kind: "invalid", errors };
  switch (draft.kind) {
    case "testRun":
      return {
        kind: "run",
        params: { kind: "testRun", target: draft.target.trim() },
        prompt: draft.prompt.trim(),
        confirm: item.costConfirm,
      };
    case "replay":
      return {
        kind: "run",
        params: {
          kind: "replay",
          target: draft.target.trim(),
          options: { maxCommits: Number(draft.maxCommits.trim()) },
        },
        prompt: null,
        confirm: item.costConfirm,
      };
    case "benchmark":
    case "coreDiff":
    case "abCompare":
      return { kind: "unwired" };
    default:
      return assertNever(draft.kind, "NewTestKind");
  }
}
