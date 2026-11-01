// B02 화면 상태 하나(목업 전용). ?state=가 첫 값을 정하고, 누름과 시나리오 타이머가 바꾼다.
import type { FlowDef } from "../b01-plugin-frame/flow";

export interface PS {
  /** 열린 대화가 있나. 없으면 well·status 기여를 그리지 않는다(ADR-0021 §3.2) */
  thread: boolean;
  /** 이 대화에서 켜진 확장의 well id(막대 순서) */
  wells: string[];
  /** 처음 열 well 탭(null이면 닫힘) */
  openTab: string | null;
  /** 탐구 결과 카드(helm/finished) */
  finished: "none" | "short" | "tall";
  /** 발견 카드가 스트리밍 중(시나리오) */
  streaming: boolean;
  /** acme-notes 카드 그리기 실패 → 일반 item */
  cardFail: boolean;
  helmStatus: string;
  reviewOn: boolean;
  /** 정적 상태·시나리오 순간에서 미리 펼쳐 둘 것(헤드리스 스크린숏용) */
  autoOpen: "overflow" | "status-review" | "status-helm" | null;
  palette: boolean;
}

export const BASE_WELLS = ["helm/panel", "taskflow/panel", "review/queue"];

export const BASE: PS = {
  thread: true,
  wells: BASE_WELLS,
  openTab: "helm/panel",
  finished: "short",
  streaming: false,
  cardFail: false,
  helmStatus: "탐색 2/3 렌즈",
  reviewOn: true,
  autoOpen: null,
  palette: false,
};

const ALL8 = [
  "helm/panel",
  "taskflow/panel",
  "review/queue",
  "learning/notes",
  "web-exa/recent",
  "acme-notes/side",
  "turn-cost/panel",
  "focus/timer",
];
const FIVE = ALL8.slice(0, 5);

export const STATES = [
  { id: "S1", label: "S1 옆 패널(기본 부품)" },
  { id: "S2", label: "S2 옆 패널(자체 코드)" },
  { id: "S3", label: "S3 옆 패널 넘침 → 더 보기" },
  { id: "S4", label: "S4 열린 대화 없음" },
  { id: "S5", label: "S5 긴 대화 카드 → 더 보기" },
  { id: "S6", label: "S6 카드 그리기 실패 → 일반 항목" },
  { id: "S7", label: "S7 상태 칸 Popover" },
  { id: "S8", label: "S8 팔레트 플러그인 묶음" },
  { id: "S9", label: "S9 꺼진 확장 명령 숨김" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

export const PRESET: Record<StateId, Partial<PS>> = {
  S1: {},
  S2: { openTab: "taskflow/panel" },
  S3: { wells: ALL8, openTab: null, autoOpen: "overflow" },
  S4: { thread: false, openTab: null },
  S5: { finished: "tall", openTab: null },
  S6: { cardFail: true, openTab: null },
  S7: { openTab: null, autoOpen: "status-review" },
  S8: { openTab: null, palette: true },
  S9: { openTab: null, palette: true, reviewOn: false },
};

// 시나리오(?scenario=, &step=n). phase마다 첫 값. 그 뒤는 누름과 타이머(app.tsx)가 옮긴다.
export const FLOWS = {
  "slot-overflow": {
    id: "slot-overflow",
    label: "옆 패널이 6개를 넘음 → 더 보기 → 자동 꺼짐",
    phases: ["five", "seven", "menu", "picked", "auto-off"],
  },
  "card-more": {
    id: "card-more",
    label: "탐구 결과 카드 → 더 보기 → 카드 실패",
    phases: ["streaming", "card", "expanded", "failed"],
  },
  "status-command": {
    id: "status-command",
    label: "상태 칸 → 팔레트 명령 → 꺼진 확장",
    phases: ["exploring", "popover", "palette", "stopped", "disabled"],
  },
} satisfies Record<string, FlowDef<string>>;
export type FlowId = keyof typeof FLOWS;

export const PHASE_PRESET: Record<string, Partial<PS>> = {
  "slot-overflow:five": { wells: FIVE, openTab: null },
  "slot-overflow:seven": { wells: ALL8.slice(0, 7), openTab: null },
  "slot-overflow:menu": { wells: ALL8.slice(0, 7), openTab: null, autoOpen: "overflow" },
  "slot-overflow:picked": { wells: ALL8.slice(0, 7), openTab: "turn-cost/panel" },
  "slot-overflow:auto-off": {
    wells: ALL8.slice(0, 7).filter((w) => w !== "review/queue"),
    openTab: null,
    reviewOn: false,
  },
  "card-more:streaming": { finished: "none", streaming: true, openTab: null },
  "card-more:card": { finished: "tall", openTab: null },
  "card-more:expanded": { finished: "tall", openTab: "helm/panel" },
  "card-more:failed": { finished: "tall", openTab: null, cardFail: true },
  "status-command:exploring": { openTab: null, helmStatus: "탐색 1/3 렌즈" },
  "status-command:popover": { openTab: null, autoOpen: "status-helm" },
  "status-command:palette": { openTab: null, palette: true },
  "status-command:stopped": { openTab: null, helmStatus: "멈춤 · 발견 2" },
  "status-command:disabled": { openTab: null, reviewOn: false, palette: true },
};
