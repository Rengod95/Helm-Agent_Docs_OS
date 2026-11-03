// N-40 구성기 흐름 테스트 실행 상태 기계(목업 전용). spec §6.28.4, 결정 C-9(다음 단계 사이에서 실제로 멈춤, 주도 유지, 테스트만), U-4(다시 돌려 검사는 개발 모드만).
// now는 테스트 대화의 단계 투영(trial.phase) 값이다. 흐름 판은 이 값 하나로 그린다. 상태 문서 본문은 쓰지 않는다.
// 상태 = 대본의 앞 n개 동작을 바로 적용한 모습. 시나리오는 같은 대본을 이어서 돈다.
import { T, josa } from "../_shell";
import { trialSteps } from "../wb-compose/fixtures";
import { PHASE_LABEL, type PhaseId } from "../f01-compose-entry/parts/flow-board";

export type Run = "running" | "pausing" | "paused" | "stepping" | "done";
export type Dialog = "closed" | "open" | "checking";

export interface LogLine {
  at: string;
  text: string;
  live?: boolean;
}

export interface Model {
  run: Run;
  now: PhaseId;
  lenses: "running" | "joined";
  log: LogLine[];
  /** 턴, 보조 에이전트, 토큰(천). 멈춘 동안 그대로다. */
  use: [number, number, number];
  dev: boolean;
  tip: boolean;
  dialog: Dialog;
  /** 다시 돌려 검사 진행(절단 수). null이면 돌지 않음. */
  replay: number | null;
  report: boolean;
}

export type Action =
  | { t: "pause" }
  | { t: "arrive" }
  | { t: "step" }
  | { t: "resume" }
  | { t: "finish" }
  | { t: "tip" }
  | { t: "openDev" }
  | { t: "closeDev" }
  | { t: "check" }
  | { t: "devOn" }
  | { t: "runReplay" }
  | { t: "tick" }
  | { t: "replayDone" };

export const CUTS = 41;
export const FIRST_DIFF = 17;
const PAUSED = `${T.stepBoundary}에서 ${T.trialPause}`;

const base: Model = {
  run: "running",
  now: "explore",
  lenses: "running",
  log: trialSteps.map((l) => ({ at: l.at, text: l.label, ...(l.done ? {} : { live: true }) })),
  use: [1, 3, 96],
  dev: false,
  tip: false,
  dialog: "closed",
  replay: null,
  report: false,
};

/** 도는 중이던 줄은 그 일이 끝나면 지운다. */
const settled = (log: LogLine[]): LogLine[] => log.filter((l) => l.live !== true);
const add = (s: Model, text: string, at: string, live = false): LogLine[] => [
  ...settled(s.log),
  { at, text, ...(live ? { live: true } : {}) },
];

export function reduce(s: Model, a: Action): Model {
  switch (a.t) {
    case "pause":
      return {
        ...s,
        run: "pausing",
        log: [
          ...add(s, `${T.trialPause}을 눌렀어요`, "14:03"),
          ...s.log.filter((l) => l.live === true),
        ],
      };
    case "arrive":
      if (s.run === "stepping")
        return {
          ...s,
          run: "paused",
          now: "apply",
          use: [2, 3, 148],
          log: [
            ...add(s, `${PHASE_LABEL.converge} ${T.step}로`, "14:04"),
            { at: "14:04", text: PAUSED },
          ],
        };
      return {
        ...s,
        run: "paused",
        now: "converge",
        lenses: "joined",
        use: [1, 3, 118],
        log: [...add(s, `${PHASE_LABEL.join} ${T.step}로`, "14:03"), { at: "14:03", text: PAUSED }],
      };
    case "step":
      return { ...s, run: "stepping", log: add(s, `${T.stepOnce} 돌려요`, "14:04", true) };
    case "resume":
      return { ...s, run: "running", log: add(s, `${T.trialResume} 돌려요`, "14:05", true) };
    case "finish":
      return {
        ...s,
        run: "done",
        now: "apply",
        lenses: "joined",
        use: [3, 3, 212],
        log: add(s, `${josa(T.lead, "을", "를")} 놓았어요`, "14:06"),
      };
    case "tip":
      return { ...s, tip: !s.tip };
    case "openDev":
      return { ...s, dialog: "open", tip: false };
    case "closeDev":
      return { ...s, dialog: "closed" };
    case "check":
      return { ...s, dialog: "checking" };
    case "devOn":
      return { ...s, dialog: "closed", dev: true };
    case "runReplay":
      return { ...s, replay: 0, report: false };
    case "tick":
      return { ...s, replay: Math.min(CUTS, (s.replay ?? 0) + 3) };
    case "replayDone":
      return { ...s, replay: null, report: true };
  }
}

/** 절단이 어느 단계에서 나왔는지. 다시 돌리는 동안 흐름 판이 이 값을 따라간다. */
export function phaseOfCut(cut: number): PhaseId {
  if (cut <= 2) return "idle";
  if (cut <= 8) return "diverge";
  if (cut <= 14) return "explore";
  if (cut <= 16) return "join";
  if (cut <= 28) return "converge";
  return "apply";
}

const FINISH: Partial<Model> = reduce(base, { t: "finish" });

export const SCRIPTS: Record<string, { init?: Partial<Model>; acts: Action[] }> = {
  "pause-step-resume": {
    acts: [
      { t: "pause" },
      { t: "arrive" },
      { t: "step" },
      { t: "arrive" },
      { t: "resume" },
      { t: "finish" },
    ],
  },
  "replay-unlock": {
    init: FINISH,
    acts: [
      { t: "tip" },
      { t: "openDev" },
      { t: "check" },
      { t: "devOn" },
      { t: "runReplay" },
      { t: "replayDone" },
    ],
  },
};

export const STATES = [
  { id: "trial-paused", label: "멈춤: 노드 표지, 주도 유지" },
  { id: "trial-running", label: "실행 중" },
  { id: "trial-pausing", label: "멈추는 중" },
  { id: "trial-step", label: "한 단계씩" },
  { id: "replay-locked", label: "배포 앱: 다시 돌려 검사 잠김" },
  { id: "replay-dev", label: "개발 모드: 다시 돌려 검사" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const AT: Record<StateId, { script: string; n: number }> = {
  "trial-running": { script: "pause-step-resume", n: 0 },
  "trial-pausing": { script: "pause-step-resume", n: 1 },
  "trial-paused": { script: "pause-step-resume", n: 2 },
  "trial-step": { script: "pause-step-resume", n: 3 },
  "replay-locked": { script: "replay-unlock", n: 1 },
  "replay-dev": { script: "replay-unlock", n: 6 },
};

export const SCENARIOS = [
  { id: "pause-step-resume", label: "멈춤 → 한 단계씩 → 이어서" },
  { id: "replay-unlock", label: "잠긴 검사 → 개발 모드 → 보고" },
];

export function modelAt(script: string, n: number): Model {
  const sc = SCRIPTS[script];
  if (sc === undefined) return base;
  let m: Model = { ...base, ...sc.init };
  for (const a of sc.acts.slice(0, n)) m = reduce(m, a);
  return m;
}

/** 저절로 오는 다음 동작. 버튼 뒤 기다림만 시간으로 넘어간다. 단계 경계 도착, 엔진 응답, 절단 진행. */
export function nextAuto(s: Model): { after: number; action: Action } | null {
  if (s.run === "pausing" || s.run === "stepping") return { after: 1800, action: { t: "arrive" } };
  if (s.run === "running" && s.now !== "explore") return { after: 1600, action: { t: "finish" } };
  if (s.dialog === "checking") return { after: 900, action: { t: "devOn" } };
  if (s.replay !== null)
    return s.replay >= CUTS
      ? { after: 500, action: { t: "replayDone" } }
      : { after: 160, action: { t: "tick" } };
  return null;
}
