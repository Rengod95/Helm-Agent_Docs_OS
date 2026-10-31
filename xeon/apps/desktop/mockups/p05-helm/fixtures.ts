// P-05 탐구 고정 데이터. 공용(대화 목록, 상태 표시줄 등)은 ../_shell/fixtures.ts.
// 런타임 관점(브리프 "Framing correction"): 이 대화에 걸린 L3 그룹, drive 임대 보유자, 단계 경계의 그룹 전환, Helm의 자식 에이전트(렌즈) 나무.
export * from "../_shell/fixtures";

export type Hook = "on" | "post" | "drive" | "scope";
export interface ActiveGroup {
  id: string;
  /** 그룹 이름(패키지 이름 그대로, mono) */
  name: string;
  layer: "L3";
  hooks: Hook[];
  /** drive 임대: held 보유, waiting 대기, none 안 씀 */
  lease: "held" | "waiting" | "none";
  state: string;
}

export const groups: ActiveGroup[] = [
  {
    id: "helm",
    name: "helm",
    layer: "L3",
    hooks: ["on", "drive", "scope"],
    lease: "held",
    state: "탐색 단계",
  },
  {
    id: "learning",
    name: "learning",
    layer: "L3",
    hooks: ["post"],
    lease: "none",
    state: "세션 관찰 중",
  },
  {
    id: "review",
    name: "review",
    layer: "L3",
    hooks: ["on", "drive"],
    lease: "waiting",
    state: "변경 검토 대기",
  },
];

export interface LensCall {
  id: string;
  label: string;
  meta?: string;
  running?: boolean;
  failed?: boolean;
}
export interface Lens {
  id: string;
  title: string;
  /** 자식 에이전트 이름 */
  agent: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  meta: string;
  calls: LensCall[];
}

export const lensesExplore: Lens[] = [
  {
    id: "l1",
    title: "실패 사례",
    agent: "lens-1",
    status: "running",
    meta: "실행 중",
    calls: [
      { id: "c1", label: "web_search · ttl seconds milliseconds bug", meta: "8건" },
      { id: "c2", label: "read · src/cache.ts", meta: "40ms" },
      { id: "c3", label: "grep · Date.now() src/", running: true, meta: "실행 중" },
    ],
  },
  {
    id: "l2",
    title: "기본 원리",
    agent: "lens-2",
    status: "done",
    meta: "발견 2",
    calls: [
      { id: "c4", label: "read · docs/cache.md", meta: "22ms" },
      { id: "c5", label: "session_search · 만료 비교", meta: "3건" },
    ],
  },
  {
    id: "l3",
    title: "다른 분야 유사",
    agent: "lens-3",
    status: "failed",
    meta: "시간 초과",
    calls: [
      { id: "c6", label: "web_fetch · rfc9111#section-4.2", failed: true, meta: "timeout 60s" },
    ],
  },
];

export const lensesDone: Lens[] = lensesExplore.map((l) =>
  l.id === "l1"
    ? {
        ...l,
        status: "done",
        meta: "발견 2",
        calls: l.calls.map((c) => ({
          ...c,
          running: false,
          meta: c.id === "c3" ? "11건" : c.meta,
        })),
      }
    : l,
) as Lens[];

export interface Finding {
  id: string;
  lens: string;
  claim: string;
  confidence: "high" | "med" | "low";
  sources: string[];
  task?: number;
}

export const findings: Finding[] = [
  {
    id: "f1",
    lens: "기본 원리",
    claim: "만료 비교 단위가 섞였어요. set은 초, isExpired는 밀리초예요.",
    confidence: "high",
    sources: ["session", "src/cache.ts"],
  },
  {
    id: "f2",
    lens: "기본 원리",
    claim: "ttl을 저장할 때 밀리초로 한 번만 바꾸면 비교 쪽은 그대로 둬도 돼요.",
    confidence: "med",
    sources: ["docs/cache.md"],
  },
  {
    id: "f3",
    lens: "실패 사례",
    claim: "TTL 경계 시각(정확히 만료 순간)에서 비교가 뒤집히는 버그가 흔해요.",
    confidence: "med",
    sources: ["web", "web", "session"],
    task: 12,
  },
  {
    id: "f4",
    lens: "실패 사례",
    claim: "시험이 실제 시계를 써서 경계 시각 버그가 가끔만 재현돼요.",
    confidence: "low",
    sources: ["test/cache.test.ts"],
    task: 13,
  },
];

export const recent = [
  { topic: "캐시 무효화", result: "applied", at: "어제 14:10", findings: 4 },
  { topic: "빌드 캐시 키 충돌", result: "empty", at: "10월 27일", findings: 0 },
  { topic: "sqlite 잠금 대기", result: "limit", at: "10월 24일", findings: 2 },
];

/** 단계 경계의 그룹 전환 기록(이 대화). 누가 drive를 쥐었는지. */
export const switches = [
  {
    at: "14:02",
    step: "턴 6",
    text: "helm이 drive 임대를 받았어요",
    detail: "신호 stuck · 같은 오류 3번",
  },
  { at: "14:02", step: "확산", text: "렌즈 3개를 정했어요" },
  {
    at: "14:03",
    step: "탐색",
    text: "자식 에이전트 3개를 띄웠어요",
    detail: "쓰기 도구 거부 시작",
  },
];
