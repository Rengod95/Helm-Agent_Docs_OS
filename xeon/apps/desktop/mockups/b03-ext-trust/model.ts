// B03 화면 상태 하나(목업 전용). ?state=가 첫 값을 정하고, 누름과 시나리오 타이머가 바꾼다.
import type { FlowDef } from "../b01-plugin-frame/flow";
import { EXTS, type Ext } from "./data";

export interface PS {
  exts: Ext[];
  /** 가져오기 대화 상자 단계(null이면 닫힘) */
  install: null | "pick" | "checking" | "done";
  /** 고른 후보: good = graph-lens, bad = 검사에 걸리는 폴더 */
  picked: null | "good" | "bad";
  /** 검사 진행(끝난 검사 수) */
  checked: number;
  web: boolean;
  /** 신뢰 확인(O-10) 대상 */
  trust: null | "graph-lens" | "acme-notes";
  projectTrust: "allow" | "undecided";
  /** 업데이트 뒤 다시 묻기(O-10 차이 모드) */
  recheck: boolean;
  /** 지우기 확인 대상 */
  remove: null | string;
  dropTables: boolean;
  /** 지우기 실패(저장 데이터) */
  removeError: boolean;
  /** 고른 행 */
  focus: string | null;
}

export const BASE: PS = {
  exts: EXTS,
  install: null,
  picked: null,
  checked: 0,
  web: false,
  trust: null,
  projectTrust: "allow",
  recheck: false,
  remove: null,
  dropTables: false,
  removeError: false,
  focus: null,
};

const withGraph = (state: Ext["state"]): Ext[] => [
  ...EXTS,
  {
    name: "graph-lens",
    display: "그래프 렌즈",
    layer: "L3",
    trust: "user",
    version: "0.1.0",
    state,
  },
];
const setExt = (name: string, p: Partial<Ext>): Ext[] =>
  EXTS.map((e) => (e.name === name ? { ...e, ...p } : e));
export const updateExt = (exts: Ext[], name: string, p: Partial<Ext>): Ext[] =>
  exts.map((e) => (e.name === name ? { ...e, ...p } : e));
export const graphRow = withGraph;

export const STATES = [
  { id: "E1", label: "E1 확장 목록" },
  { id: "I1", label: "I1 가져오기: 고르기" },
  { id: "I2", label: "I2 가져오기: 검사 중" },
  { id: "I3", label: "I3 가져오기: 검사 통과" },
  { id: "I4", label: "I4 가져오기: 검사 실패" },
  { id: "I5", label: "I5 가져오기: 웹 파일 올리기" },
  { id: "T1", label: "T1 신뢰 확인: 사용자 설치" },
  { id: "T2", label: "T2 신뢰 확인: 프로젝트 확장" },
  { id: "T3", label: "T3 신뢰 확인 취소 뒤" },
  { id: "U1", label: "U1 업데이트 뒤 다시 확인" },
  { id: "U2", label: "U2 다시 확인 거절 → 이전 버전" },
  { id: "R1", label: "R1 지우기 확인" },
  { id: "R2", label: "R2 지우기 실패" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const PRESET: Record<StateId, Partial<PS>> = {
  E1: {},
  I1: { install: "pick" },
  I2: { install: "checking", picked: "good", checked: 3 },
  I3: { install: "done", picked: "good", checked: 6 },
  I4: { install: "done", picked: "bad", checked: 6 },
  I5: { install: "pick", web: true },
  T1: { trust: "graph-lens" },
  T2: { trust: "acme-notes", projectTrust: "undecided" },
  T3: { exts: withGraph("trust_undecided"), focus: "graph-lens" },
  U1: { recheck: true },
  U2: { exts: setExt("taskflow", { update: undefined }), focus: "taskflow" },
  R1: { remove: "taskflow" },
  R2: { exts: EXTS.filter((e) => e.name !== "taskflow"), removeError: true },
};

export const FLOWS = {
  "install-folder": {
    id: "install-folder",
    label: "폴더에서 가져오기 → 검사 → 신뢰 확인 → 켜짐",
    phases: ["pick", "checking", "passed", "trust", "enabled", "check-failed"],
  },
  "update-reprompt": {
    id: "update-reprompt",
    label: "업데이트가 권한을 늘림 → 다시 확인",
    phases: ["list", "diff", "accepted", "declined"],
  },
  uninstall: {
    id: "uninstall",
    label: "지우기 확인 → 단계 경계 뒤 지움 → 저장 데이터 실패",
    phases: ["list", "confirm", "removing", "failed"],
  },
} satisfies Record<string, FlowDef<string>>;
export type FlowId = keyof typeof FLOWS;

export const PHASE_PRESET: Record<string, Partial<PS>> = {
  "install-folder:pick": { install: "pick" },
  "install-folder:checking": { install: "checking", picked: "good", checked: 2 },
  "install-folder:passed": { install: "done", picked: "good", checked: 6 },
  "install-folder:trust": { trust: "graph-lens" },
  "install-folder:enabled": { exts: withGraph("on"), focus: "graph-lens" },
  "install-folder:check-failed": { install: "done", picked: "bad", checked: 6 },
  "update-reprompt:list": { focus: "taskflow" },
  "update-reprompt:diff": { recheck: true },
  "update-reprompt:accepted": {
    exts: setExt("taskflow", { version: "0.4.0", update: undefined }),
    focus: "taskflow",
  },
  "update-reprompt:declined": {
    exts: setExt("taskflow", { update: undefined }),
    focus: "taskflow",
  },
  "uninstall:list": {},
  "uninstall:confirm": { remove: "taskflow", dropTables: true },
  "uninstall:removing": { exts: setExt("taskflow", { state: "removing" }), focus: "taskflow" },
  "uninstall:failed": { exts: EXTS.filter((e) => e.name !== "taskflow"), removeError: true },
};
