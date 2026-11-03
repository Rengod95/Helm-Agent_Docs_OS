// A5 화면 상태(목업 전용). 한 플러그인의 "이 대화" 상태는 셋이다.
//   on        켜짐(전역도 켜짐)
//   off-here  이 대화에서만 꺼짐(전역은 켜짐). 되돌리면 켜짐
//   off-all   전역에서 꺼져 있음. 이 대화 스위치는 잠기고 크래프트로 안내
// 끄기는 다음 단계 경계에서 적용된다(진행 중인 턴을 끊지 않는다). 그 사이는 pending.
export type Here = "on" | "off-here" | "off-all";

export interface PluginRow {
  id: string;
  display: string;
  /** 한 줄 설명. 길면 말줄임 */
  note: string;
  here: Here;
  /** 끄기·켜기를 눌렀지만 단계 경계를 기다리는 중 */
  pending?: "turning-off" | "turning-on";
}

export interface PS {
  thread: boolean;
  rows: PluginRow[];
  /** 턴이 진행 중이라 변경이 단계 경계를 기다린다 */
  running: boolean;
  /** 저장(settings.set) 실패 */
  failed: string | null;
  /** 처음 연 탭 */
  openTab: string | null;
}

const BASE_ROWS: PluginRow[] = [
  { id: "helm", display: "Helm", note: "탐구와 렌즈", here: "on" },
  { id: "review", display: "검토", note: "변경 검토 대기열", here: "on" },
  { id: "learning", display: "학습", note: "제안과 메모리", here: "on" },
  { id: "web-exa", display: "Exa 웹 검색", note: "웹 검색 provider", here: "on" },
];

export const BASE: PS = {
  thread: true,
  rows: BASE_ROWS,
  running: false,
  failed: null,
  openTab: "plugins",
};

export const STATES = [
  { id: "S1", label: "S1 모두 켜짐" },
  { id: "S2", label: "S2 하나를 이 대화에서 끔" },
  { id: "S3", label: "S3 전역에서 꺼진 플러그인" },
  { id: "S4", label: "S4 턴 진행 중 → 단계 경계에서 적용" },
  { id: "S5", label: "S5 저장 실패" },
  { id: "S6", label: "S6 열린 대화 없음" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const set = (rows: PluginRow[], id: string, patch: Partial<PluginRow>): PluginRow[] =>
  rows.map((r) => (r.id === id ? { ...r, ...patch } : r));

export const PRESET: Record<StateId, Partial<PS>> = {
  S1: {},
  S2: { rows: set(BASE_ROWS, "review", { here: "off-here" }) },
  S3: { rows: set(BASE_ROWS, "learning", { here: "off-all" }) },
  S4: {
    running: true,
    rows: set(BASE_ROWS, "web-exa", { pending: "turning-off" }),
  },
  S5: {
    failed: "web-exa",
    rows: set(BASE_ROWS, "web-exa", { here: "on" }),
  },
  S6: { thread: false, openTab: null },
};

export { set as patchRow };
