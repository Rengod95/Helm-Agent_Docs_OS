// B01 화면 상태 하나(목업 전용). ?state=가 첫 값을 정하고, 누름과 시나리오 타이머가 바꾼다.
import type { FlowDef } from "./flow";
import { boardTasks, type Task } from "./data";

export type ViewId = "taskflow/board" | "helm/inquiry" | "acme-notes/map" | "web-exa/none";
/** 자체 코드 화면 수명(ADR-0021 §3.7). blocked-*는 frame_blocked의 사유별. */
export type FrameMode =
  | "loading"
  | "ready"
  | "liveness"
  | "bridge"
  | "reshown"
  | "blocked-setting"
  | "blocked-project"
  | "blocked-build"
  | "blocked-web";
/** 기본 부품 화면 남은 상태(N-20). */
export type HelmMode = "active" | "loading" | "offline" | "view_disabled" | "long" | "safe";

export interface PS {
  view: ViewId;
  frame: FrameMode;
  helm: HelmMode;
  tasks: Task[];
  focus: string | null;
  /** 확인 줄을 기다리는 move 대상 */
  confirm: string | null;
  dontAsk: boolean;
  dispatch: "idle" | "waiting" | "done" | "denied";
  approval: "none" | "pending" | "allowed" | "denied";
  link: boolean;
  setting: boolean;
  framesOn: boolean;
  projectFramesOn: boolean;
  web: boolean;
  /** 화면 장부(연속 실패 수, 5면 view_disabled) */
  fails: number;
  /** 생존 확인(5초 ping) 무응답 수. 2면 내린다 */
  pingMissed: number;
  inboxOpen: boolean;
}

export const BASE: PS = {
  view: "taskflow/board",
  frame: "ready",
  helm: "active",
  tasks: boardTasks,
  focus: null,
  confirm: null,
  dontAsk: false,
  dispatch: "idle",
  approval: "none",
  link: false,
  setting: false,
  framesOn: true,
  projectFramesOn: false,
  web: false,
  fails: 0,
  pingMissed: 0,
  inboxOpen: false,
};

export const moveTask = (tasks: Task[], id: string): Task[] =>
  tasks.map((t) => (t.id === id ? { ...t, col: "doing" } : t));

export const STATES = [
  { id: "F1", label: "F1 자체 코드 화면" },
  { id: "F2", label: "F2 준비 기다림" },
  { id: "F3", label: "F3 동작 확인 줄" },
  { id: "F4", label: "F4 승인 카드" },
  { id: "F5", label: "F5 외부 링크" },
  { id: "F6", label: "F6 응답 없음" },
  { id: "F7", label: "F7 다리 버전 불일치" },
  { id: "F8", label: "F8 다시 띄움" },
  { id: "B1", label: "B1 막힘: 설정, 대체 화면" },
  { id: "B2", label: "B2 막힘: 설정, 대체 없음" },
  { id: "B3", label: "B3 막힘: 프로젝트 확장" },
  { id: "B4", label: "B4 막힘: 앱 버전" },
  { id: "B5", label: "B5 웹" },
  { id: "D1", label: "D1 기본 부품: 읽는 중" },
  { id: "D2", label: "D2 기본 부품: 오프라인" },
  { id: "D3", label: "D3 기본 부품: 화면 꺼짐" },
  { id: "D4", label: "D4 기본 부품: 긴 내용" },
  { id: "D5", label: "D5 화면 없음" },
  { id: "D6", label: "D6 안전 모드" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const moved = moveTask(boardTasks, "t13");

export const PRESET: Record<StateId, Partial<PS>> = {
  F1: {},
  F2: { frame: "loading" },
  F3: { confirm: "t13" },
  F4: { tasks: moved, dispatch: "waiting", approval: "pending", inboxOpen: true },
  F5: { link: true },
  F6: { frame: "liveness", fails: 1 },
  F7: { frame: "bridge" },
  F8: { frame: "reshown" },
  B1: { frame: "blocked-setting", framesOn: false },
  B2: { view: "acme-notes/map", frame: "blocked-setting", framesOn: false },
  B3: { view: "acme-notes/map", frame: "blocked-project" },
  B4: { frame: "blocked-build" },
  B5: { frame: "blocked-web", web: true },
  D1: { view: "helm/inquiry", helm: "loading" },
  D2: { view: "helm/inquiry", helm: "offline" },
  D3: { view: "helm/inquiry", helm: "view_disabled", fails: 5 },
  D4: { view: "helm/inquiry", helm: "long" },
  D5: { view: "web-exa/none" },
  D6: { view: "helm/inquiry", helm: "safe" },
};

// 시나리오(?scenario=). phase마다 첫 값. 그 뒤는 누름과 타이머(app.tsx)가 옮긴다.
export type FramePhase =
  | "loading"
  | "ready"
  | "confirm"
  | "moved"
  | "approval"
  | "dispatched"
  | "link";
export type LivePhase = "ready" | "lost" | "reloading" | "back";
export type BlockedPhase = "fallback" | "setting" | "loading" | "ready";
export type HelmPhase = "loading" | "active" | "offline" | "disabled";

export const FLOWS = {
  frame: {
    id: "frame",
    label: "a. 자체 코드 화면에서 동작 확인",
    phases: ["loading", "ready", "confirm", "moved", "approval", "dispatched", "link"],
  } satisfies FlowDef<FramePhase>,
  liveness: {
    id: "liveness",
    label: "a′. 응답 없음 → 다시 불러오기",
    phases: ["ready", "lost", "reloading", "back"],
  } satisfies FlowDef<LivePhase>,
  blocked: {
    id: "blocked",
    label: "b. 막힘 → 대체 화면 → 설정 켜기",
    phases: ["fallback", "setting", "loading", "ready"],
  } satisfies FlowDef<BlockedPhase>,
  helm: {
    id: "helm",
    label: "기본 부품 화면: 오프라인 → 화면 꺼짐",
    phases: ["loading", "active", "offline", "disabled"],
  } satisfies FlowDef<HelmPhase>,
};
export type FlowId = keyof typeof FLOWS;

export const PHASE_PRESET: Record<string, Partial<PS>> = {
  "frame:loading": { frame: "loading" },
  "frame:ready": {},
  "frame:confirm": { confirm: "t13" },
  "frame:moved": { tasks: moved, focus: "t13" },
  "frame:approval": { tasks: moved, dispatch: "waiting", approval: "pending", inboxOpen: true },
  "frame:dispatched": { tasks: moved, dispatch: "done", approval: "allowed" },
  "frame:link": { tasks: moved, dispatch: "done", approval: "allowed", link: true },
  "liveness:ready": {},
  "liveness:lost": { frame: "liveness", fails: 1 },
  "liveness:reloading": { frame: "loading", fails: 1 },
  "liveness:back": { fails: 1 },
  "blocked:fallback": { frame: "blocked-setting", framesOn: false },
  "blocked:setting": { frame: "blocked-setting", framesOn: false, setting: true },
  "blocked:loading": { frame: "loading", setting: false },
  "blocked:ready": {},
  "helm:loading": { view: "helm/inquiry", helm: "loading" },
  "helm:active": { view: "helm/inquiry" },
  "helm:offline": { view: "helm/inquiry", helm: "offline" },
  "helm:disabled": { view: "helm/inquiry", helm: "view_disabled", fails: 5 },
};
