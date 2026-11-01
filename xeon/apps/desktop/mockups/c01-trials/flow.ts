// P-19 시험 실행 상태 기계(목업 전용). spec §6.26, §6.31 O-12, 결정 4(replay·bench·diff는 개발 모드에서만),
// 결정 9(ReplayDriveReport 그대로 + JSON 복사), 결정 캔버스 5(계측 끄면 턴 다시 보기 잠김), 캔버스 9(단계 사이 멈춤).
// ?state=<id>는 대본의 앞 n개 동작을 바로 적용한 모습이고, ?scenario=<id>&step=<n>도 같다(_chat-rt useMachine).
import { runs as baseRuns, type Run } from "../_wb-c/data";
import type { After } from "../_chat-rt";

export type DevDialog = "closed" | "open" | "checking" | "norepo";
export type SheetStep = "closed" | "open" | "confirm" | "starting" | "applying";
export type NewKind = "trial" | "replay" | "bench" | "diff";

export interface S {
  script: string;
  dev: boolean;
  /** 웹: 원격 호스트의 개발 모드를 따름 */
  web: boolean;
  devDialog: DevDialog;
  repo: string;
  tip: boolean;
  sel: string;
  runs: Run[];
  sheet: SheetStep;
  kind: NewKind;
  profile: string;
  previewFail: boolean;
  /** replay 다시 실행 진행(절단 수). null이면 돌지 않음 */
  rerun: number | null;
  traceOff: boolean;
  /** 토스트 한 번(id가 바뀌면 띄움) */
  note: {
    id: number;
    title: string;
    body?: string;
    tone?: "neutral" | "warning" | "danger" | "success";
  } | null;
}

export type A =
  | { t: "select"; id: string }
  | { t: "tip"; on: boolean }
  | { t: "openDev" }
  | { t: "repo"; path: string }
  | { t: "checkDev" }
  | { t: "devOk" }
  | { t: "devFail" }
  | { t: "closeDev" }
  | { t: "rerun" }
  | { t: "rerunTick" }
  | { t: "copyJson" }
  | { t: "openNew" }
  | { t: "kind"; kind: NewKind }
  | { t: "profile"; id: string }
  | { t: "start" }
  | { t: "confirm" }
  | { t: "applied" }
  | { t: "created" }
  | { t: "closeSheet" }
  | { t: "pause" }
  | { t: "boundary" }
  | { t: "stepOnce" }
  | { t: "resume" };

export const NEW_ID = "r0";
export const REPO_OK = "~/code/xeon";
export const REPO_BAD = "~/Downloads/xeon-app";

export const init = (script: string): S => ({
  script,
  dev: false,
  web: script === "web",
  devDialog: "closed",
  repo: script === "trial-dev-locked-norepo" ? REPO_BAD : REPO_OK,
  tip: false,
  sel: "r1",
  runs: baseRuns,
  sheet: "closed",
  kind: "trial",
  profile: "explore",
  previewFail: false,
  rerun: null,
  traceOff: script === "trace-off",
  note: null,
});

const note = (
  s: S,
  title: string,
  body?: string,
  tone?: NonNullable<S["note"]>["tone"],
): S["note"] => ({
  id: (s.note?.id ?? 0) + 1,
  title,
  ...(body !== undefined ? { body } : {}),
  ...(tone !== undefined ? { tone } : {}),
});

const setRun = (s: S, id: string, patch: Partial<Run>): Run[] =>
  s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r));

export function reduce(s: S, a: A): S {
  switch (a.t) {
    case "select":
      return { ...s, sel: a.id, tip: false };
    case "tip":
      return { ...s, tip: a.on };
    case "openDev":
      return { ...s, tip: false, devDialog: "open" };
    case "repo":
      return { ...s, repo: a.path, devDialog: "open" };
    case "checkDev":
      return s.devDialog === "open" ? { ...s, devDialog: "checking" } : s;
    case "devOk":
      return {
        ...s,
        dev: true,
        devDialog: "closed",
        note: note(s, "개발 모드를 켰어요", `저장소 ${s.repo} · 이 컴퓨터 사용자 설정`, "success"),
      };
    case "devFail":
      return { ...s, devDialog: "norepo" };
    case "closeDev":
      return { ...s, devDialog: "closed" };
    case "rerun":
      return s.dev
        ? { ...s, rerun: 0, runs: setRun(s, "r5", { result: "running", at: "지금", took: "0s" }) }
        : s;
    case "rerunTick": {
      if (s.rerun === null) return s;
      const n = Math.min(41, s.rerun + 8);
      if (n < 41)
        return { ...s, rerun: n, runs: setRun(s, "r5", { took: `${Math.round(n / 4.5)}s` }) };
      return {
        ...s,
        rerun: null,
        runs: setRun(s, "r5", { result: "failed", at: "방금", took: "9s" }),
        note: note(
          s,
          "다시 돌려 검사가 끝났어요",
          "절단 41개 중 2개가 달라요 · 첫 차이 seq 212",
          "neutral",
        ),
      };
    }
    case "copyJson":
      return {
        ...s,
        note: note(s, "검사 보고 JSON을 복사했어요", "ReplayDriveReport · 41개 절단", "neutral"),
      };
    case "openNew":
      return { ...s, sheet: "open", kind: "trial", previewFail: false };
    case "kind":
      return { ...s, kind: a.kind };
    case "profile":
      return { ...s, profile: a.id, previewFail: a.id === "review-trial" };
    case "start":
      return s.sheet === "open" && !s.previewFail ? { ...s, sheet: "confirm" } : s;
    case "confirm":
      return s.sheet === "confirm" ? { ...s, sheet: "starting" } : s;
    case "applied":
      return s.sheet === "starting" ? { ...s, sheet: "applying" } : s;
    case "created": {
      if (s.sheet !== "applying") return s;
      const row: Run = {
        id: NEW_ID,
        kind: "trial",
        target: "helm",
        result: "running",
        at: "지금",
        took: "0:04",
        thread: "t11",
        title: "캐시 무효화 원인 넓게 보기",
        profile: s.profile,
        steps: [0, 6],
      };
      return {
        ...s,
        sheet: "closed",
        sel: NEW_ID,
        runs: [row, ...s.runs],
        note: note(
          s,
          "시험 대화를 만들었어요",
          "프로필 탐구 중심 · 이 대화에만 적용했어요",
          "success",
        ),
      };
    }
    case "closeSheet":
      return { ...s, sheet: "closed" };
    case "pause":
      return { ...s, runs: setRun(s, s.sel, { result: "pausing" }) };
    case "boundary":
      return {
        ...s,
        runs: s.runs.map((r) => (r.result === "pausing" ? { ...r, result: "paused" } : r)),
      };
    case "stepOnce":
      return { ...s, runs: setRun(s, s.sel, { result: "running" }) };
    case "resume":
      return { ...s, runs: setRun(s, s.sel, { result: "running" }) };
  }
}

export function effect(a: A, n: S, after: After<A>) {
  switch (a.t) {
    case "checkDev":
      after(1400, n.repo === REPO_OK ? { t: "devOk" } : { t: "devFail" });
      return;
    case "rerun":
    case "rerunTick":
      if (n.rerun !== null) after(700, { t: "rerunTick" });
      return;
    case "confirm":
      after(1000, { t: "applied" });
      return;
    case "applied":
      after(1100, { t: "created" });
      return;
    case "pause":
      after(2400, { t: "boundary" });
      return;
    case "stepOnce":
      after(2000, { t: "boundary" });
      return;
    default:
      return;
  }
}

const sel = (id: string): A => ({ t: "select", id });
export const SCRIPTS: Record<string, readonly A[]> = {
  // 새 시험: O-12 → 비용 확인 → 프로필 적용 → 시험 대화 시작
  "trial-new": [
    { t: "openNew" },
    { t: "start" },
    { t: "confirm" },
    { t: "applied" },
    { t: "created" },
  ],
  // 실패: 프로필 미리 보기 실패(review-trial은 대상 review가 자동 꺼짐)
  "trial-new-fail": [{ t: "openNew" }, { t: "profile", id: "review-trial" }],
  // 배포 앱에서 replay 다시 실행 → 잠금 이유 → 개발 모드 켜기 → 다시 실행 → 보고
  "trial-dev-locked": [
    sel("r5"),
    { t: "tip", on: true },
    { t: "openDev" },
    { t: "checkDev" },
    { t: "devOk" },
    { t: "rerun" },
    { t: "rerunTick" },
    { t: "rerunTick" },
    { t: "rerunTick" },
    { t: "rerunTick" },
    { t: "rerunTick" },
    { t: "rerunTick" },
    { t: "copyJson" },
  ],
  // 실패: 저장소 경로에 시험 하니스가 없음 → 잠김 유지
  "trial-dev-locked-norepo": [
    sel("r5"),
    { t: "tip", on: true },
    { t: "openDev" },
    { t: "checkDev" },
    { t: "devFail" },
  ],
  // 시험 대화 상세: 멈춤 상태에서 한 단계씩 → 다시 멈춤 → 이어서
  "trial-step": [sel("r1"), { t: "stepOnce" }, { t: "boundary" }, { t: "resume" }],
  // 정적 상태 전용 대본
  base: [sel("r1")],
  stopped: [sel("r3")],
  past: [sel("r5")],
  dev: [sel("r5"), { t: "openDev" }, { t: "checkDev" }, { t: "devOk" }],
  "trace-off": [sel("r1")],
  web: [sel("r5")],
};
