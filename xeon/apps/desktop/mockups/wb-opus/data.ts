// 이 시안만의 고정 데이터(§14.5 공용 값은 _shell/workbench-fixtures.ts). §14.5에 없어 시안이 덧붙인 값이다.
import { extensions, layerMap, LAYERS, type Extension, type Layer } from "../_shell";

/** 한국어 표시 이름(DP-39: 라벨을 기계 이름으로 대신하지 않는다). */
export const displayName: Record<string, string> = {
  helm: "Helm",
  learning: "학습",
  review: "리뷰",
  work: "작업",
  "web-exa": "Exa 웹 검색",
  "acme-notes": "Acme 노트",
  "core-loop": "기본 에이전트",
  "provider-oauth": "OAuth 제공자",
  "pre-commit-lint": "커밋 전 검사",
};

export const kindLabel: Record<Extension["kind"], string> = {
  group: "그룹",
  plugin: "플러그인",
  core: "코어",
  hook: "훅",
};

/** 지도 칸(층 × 확장)의 상태. layerMap의 이름 중 extensions에 없는 것(L0·L1 내장)은 켜짐 builtin으로 본다. */
export function extInfo(name: string, list: Extension[] = extensions): Extension {
  const found = list.find((e) => e.name === name);
  if (found !== undefined) return found;
  const layer = (LAYERS.find((l) => layerMap[l].includes(name)) ?? "L1") as Layer;
  return {
    name,
    layer,
    kind: layer === "L0" || layer === "L1" ? "core" : "plugin",
    trust: "builtin",
    tier: layer === "L0" ? "core" : "builtin",
    version: "0.4.0",
    status: "enabled",
    drive: "none",
    failures: 0,
    ...(layer === "L0" ? { exempt: true } : {}),
  };
}

/** 확장별 훅 수(W2 "훅" 열). */
export const pointCount: Record<string, number> = {
  helm: 6,
  learning: 3,
  review: 4,
  work: 2,
  "web-exa": 1,
  "acme-notes": 2,
  "core-loop": 9,
  "provider-oauth": 1,
  "pre-commit-lint": 1,
};

/** 이 대화(캐시 무효화 조사)에서 켜진 확장과 쓰는 훅(W5 런타임 탭). */
export const threadExts: {
  name: string;
  layer: Layer;
  state: string;
  tone?: "danger" | "warning";
  points: string[];
}[] = [
  {
    name: "helm",
    layer: "L3",
    state: "drive · 탐색",
    points: [
      "input.agent.before",
      "tool.call.before",
      "tool.execution.after",
      "boundary.settle.after",
      "session.start",
      "lifecycle.lease.rejected",
    ],
  },
  {
    name: "learning",
    layer: "L3",
    state: "켜짐",
    points: ["boundary.settle.after", "session.end", "tool.execution.after"],
  },
  { name: "web-exa", layer: "L2", state: "켜짐", points: ["web.search.provider"] },
  { name: "work", layer: "L2", state: "켜짐", points: ["tool.register", "boundary.settle.after"] },
  {
    name: "acme-notes",
    layer: "plugin",
    state: "실패 2",
    tone: "warning",
    points: ["tool.call.before", "session.start"],
  },
  {
    name: "review",
    layer: "L3",
    state: "자동 꺼짐",
    tone: "danger",
    points: [
      "tool.call.before",
      "boundary.settle.after",
      "input.agent.before",
      "lifecycle.lease.rejected",
    ],
  },
];

/** W3 기록 탭: review의 scope.handler_failed 다섯 줄(S6). */
export const reviewFailures = [
  {
    at: "13:40:22",
    turn: 5,
    point: "boundary.settle.after",
    error: "TypeError: diff is undefined",
    where: "review/src/settle.ts:42",
  },
  {
    at: "13:39:58",
    turn: 5,
    point: "boundary.settle.after",
    error: "TypeError: diff is undefined",
    where: "review/src/settle.ts:42",
  },
  {
    at: "13:31:10",
    turn: 4,
    point: "boundary.settle.after",
    error: "TypeError: diff is undefined",
    where: "review/src/settle.ts:42",
  },
  {
    at: "13:30:47",
    turn: 4,
    point: "tool.call.before",
    error: "timeout 30s",
    where: "review/src/gate.ts:18",
  },
  {
    at: "13:22:05",
    turn: 3,
    point: "boundary.settle.after",
    error: "TypeError: diff is undefined",
    where: "review/src/settle.ts:42",
  },
];

/** W3 helm 기록 탭. */
export const helmLog = [
  { at: "14:02:41", kind: "lease.acquired", text: "턴 7 · 사유 request" },
  { at: "13:58:09", kind: "lease.released", text: "턴 6 · 탐구 적용 끝" },
  {
    at: "13:31:02",
    kind: "scope.handler_failed",
    text: "boundary.settle.after · timeout 5s",
    tone: "warning" as const,
  },
  { at: "13:20:15", kind: "lease.acquired", text: "턴 3 · 사유 request" },
  { at: "09:00:01", kind: "loader", text: "helm 0.1.0 로드 · 진단 없음" },
];

/** W3 주도와 상한 탭: 최근 주도. */
export const helmLeases = [
  {
    id: "l1",
    start: "14:02 · 턴 7",
    end: "보유 중",
    reason: "request",
    used: "턴 1 · spawn 3 · 120k",
  },
  {
    id: "l2",
    start: "13:20 · 턴 3",
    end: "13:58 · 턴 6",
    reason: "적용 끝",
    used: "턴 4 · spawn 8 · 310k",
  },
  {
    id: "l3",
    start: "어제 14:01",
    end: "어제 14:10",
    reason: "상한 턴 4/4",
    used: "턴 4 · spawn 6 · 280k",
  },
];

/** W3 화면 탭: helm이 기여한 화면(ADR-0021 §3.9). */
export const helmViews = [
  { slot: "page", id: "helm/inquiry", title: "Helm 탐구", state: "active" },
  { slot: "well", id: "helm/panel", title: "탐구", state: "active" },
  { slot: "card", id: "helm/finished", title: "탐구 결과", state: "active" },
  { slot: "card", id: "helm/suggested", title: "탐구 제안", state: "active" },
  { slot: "status", id: "helm/phase", title: "단계 칩", state: "active" },
  { slot: "command", id: "helm/start", title: "탐구 시작…", state: "active" },
  { slot: "command", id: "helm/stop", title: "탐구 멈춤", state: "active" },
];

/** W3 버전 탭. */
export const helmVersions = [
  { id: "v1", version: "0.1.0", where: "설치본", at: "10월 28일", current: true },
  { id: "v2", version: "0.0.9", where: "이전 버전", at: "10월 21일", current: false },
  { id: "v3", version: "0.1.0", where: "앱 번들", at: "10월 28일", current: false },
];
