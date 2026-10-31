// P-13 고정 데이터. 확장 이름 규칙(^[a-z][a-z0-9-]{1,31}$), 설치 위치(builtin·managed·user·project), 신뢰 등급,
// 네 연산(on·post·drive·scope) 등록 수, drive 상태(none·registered·holding·error), 자동 끄기(연속 5번 또는 50번 중 50%)는 X 문서 어휘를 따른다.
export type Source = "builtin" | "managed" | "user" | "project";
export type Drive = "none" | "registered" | "holding" | "error";
export type ExtState =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "pending"; text: string }
  | { kind: "autoDisabled"; text: string }
  | { kind: "untrusted" }
  | { kind: "waiting"; text: string }
  | { kind: "always" };

export interface Ext {
  name: string;
  label?: string;
  layer: "L0" | "L1" | "L2" | "L3";
  kind: "plugin" | "group" | "platform";
  source: Source;
  path?: string;
  points: { on?: number; post?: number; drive?: boolean; scope?: number };
  drive?: Drive;
  state: ExtState;
  desc?: string;
}

export const groups: Ext[] = [
  {
    name: "group-helm",
    label: "Helm",
    layer: "L3",
    kind: "group",
    source: "builtin",
    points: { on: 6, post: 2, drive: true, scope: 1 },
    drive: "holding",
    state: { kind: "on" },
    desc: "탐구: drive 임대를 받아 렌즈 자식 에이전트를 나란히 돌리고 결과를 반영해요",
  },
  {
    name: "group-learning",
    label: "학습",
    layer: "L3",
    kind: "group",
    source: "builtin",
    points: { on: 4, post: 1, scope: 1 },
    drive: "none",
    state: { kind: "pending", text: "다음 단계 경계에 켜져요" },
    desc: "대화를 검토해 스킬·지식 제안을 만들어요",
  },
  {
    name: "group-account-rotation",
    label: "계정 회전",
    layer: "L3",
    kind: "group",
    source: "builtin",
    points: { on: 2, scope: 1 },
    drive: "none",
    state: { kind: "off" },
    desc: "한도에 닿으면 다음 모델 계정으로 바꿔요",
  },
  {
    name: "review",
    layer: "L3",
    kind: "group",
    source: "user",
    path: "~/.xeon/groups/review",
    points: { on: 3, post: 1, drive: true, scope: 1 },
    drive: "error",
    state: { kind: "autoDisabled", text: "자동으로 꺼졌어요 · 연속 실패 5번" },
    desc: "변경을 리뷰 렌즈로 다시 읽어요",
  },
  {
    name: "pr-triage",
    layer: "L3",
    kind: "group",
    source: "project",
    path: "~/code/xeon/.xeon/groups/pr-triage",
    points: { on: 2, drive: true, scope: 1 },
    drive: "registered",
    state: { kind: "untrusted" },
    desc: "이 저장소의 PR을 분류해요",
  },
];

export const plugins: Ext[] = [
  {
    name: "web-exa",
    layer: "L2",
    kind: "plugin",
    source: "user",
    points: { on: 1, scope: 1 },
    state: { kind: "waiting", text: "능력 대기: secret exa-api-key" },
  },
  {
    name: "web-searxng",
    layer: "L2",
    kind: "plugin",
    source: "builtin",
    points: { scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "mcp-bridge",
    layer: "L2",
    kind: "plugin",
    source: "builtin",
    points: { on: 2, scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "schedule",
    layer: "L2",
    kind: "plugin",
    source: "builtin",
    points: { post: 1, scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "models-anthropic",
    layer: "L1",
    kind: "plugin",
    source: "builtin",
    points: { scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "models-openai",
    layer: "L1",
    kind: "plugin",
    source: "builtin",
    points: { scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "context-compact",
    layer: "L1",
    kind: "plugin",
    source: "builtin",
    points: { on: 2, scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "cost-guard",
    layer: "L1",
    kind: "plugin",
    source: "managed",
    points: { on: 1, scope: 1 },
    state: { kind: "on" },
  },
  {
    name: "tool-timer",
    layer: "L1",
    kind: "plugin",
    source: "user",
    points: { on: 2, scope: 1 },
    state: { kind: "off" },
  },
  {
    name: "platform-sops",
    layer: "L0",
    kind: "platform",
    source: "builtin",
    points: {},
    state: { kind: "always" },
  },
  {
    name: "platform-bwrap",
    layer: "L0",
    kind: "platform",
    source: "builtin",
    points: {},
    state: { kind: "always" },
  },
  {
    name: "platform-sqlite",
    layer: "L0",
    kind: "platform",
    source: "builtin",
    points: {},
    state: { kind: "always" },
  },
];

export const failures = [
  {
    ext: "review",
    point: "tool.call.before",
    code: "handler_timeout",
    detail: "2000ms 넘음",
    count: "연속 5번",
    at: "3분 전",
  },
  {
    ext: "group-helm",
    point: "context.assemble",
    code: "handler_aborted",
    detail: "임대 회수",
    count: "1번",
    at: "20분 전",
  },
];
