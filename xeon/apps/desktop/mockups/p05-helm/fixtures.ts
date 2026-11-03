// P-05 탐구 고정 데이터. 공용(대화 목록, 상태 표시줄 등)은 ../_shell/fixtures.ts.
// 화면에 내는 것은 탐구 자기 내용(렌즈, 발견, 지난 탐구, 단계 기록)뿐이다. 그룹·주도 보유자는 런타임 탭 몫이라 여기서 뺐다.
import { EXT, josa, T } from "../_shell";
export * from "../_shell/fixtures";

export interface ActiveGroup {
  id: string;
  /** 그룹 이름(패키지 이름 그대로) */
  name: string;
  /** 주도: held 보유, waiting 대기, none 안 씀 */
  lease: "held" | "waiting" | "none";
  state: string;
}

export const groups: ActiveGroup[] = [
  { id: "helm", name: "helm", lease: "held", state: "탐색 단계" },
  { id: "learning", name: "learning", lease: "none", state: "대화 관찰 중" },
  { id: "review", name: "review", lease: "waiting", state: "변경 검토 대기" },
];

export interface LensCall {
  id: string;
  label: string;
  running?: boolean;
  failed?: boolean;
}
export interface Lens {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  /** 렌즈 옆 상태 글(실행 중, 시간 초과 등). 없으면 적지 않는다. */
  meta?: string | undefined;
  calls: LensCall[];
}

export const lensesExplore: Lens[] = [
  {
    id: "l1",
    title: "실패 사례",
    status: "running",
    meta: "실행 중",
    calls: [
      { id: "c1", label: "web_search · ttl seconds milliseconds bug" },
      { id: "c2", label: "read · src/cache.ts" },
      { id: "c3", label: "grep · Date.now() src/", running: true },
    ],
  },
  {
    id: "l2",
    title: "기본 원리",
    status: "done",
    calls: [
      { id: "c4", label: "read · docs/cache.md" },
      { id: "c5", label: "session_search · 만료 비교" },
    ],
  },
  {
    id: "l3",
    title: "다른 분야 유사",
    status: "failed",
    meta: "시간 초과",
    calls: [{ id: "c6", label: "web_fetch · rfc9111#section-4.2", failed: true }],
  },
];

export const lensesDone: Lens[] = lensesExplore.map((l): Lens =>
  l.id === "l1"
    ? {
        ...l,
        status: "done",
        meta: undefined,
        calls: l.calls.map((c) => ({ ...c, running: false })),
      }
    : l,
);

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
    claim: "테스트가 실제 시계를 써서 경계 시각 버그가 가끔만 재현돼요.",
    confidence: "low",
    sources: ["test/cache.test.ts"],
    task: 13,
  },
];

export const recent = [
  { topic: "캐시 무효화", result: "적용함", at: "어제" },
  { topic: "빌드 캐시 키 충돌", result: "발견 없음", at: "10월 27일" },
  { topic: "sqlite 잠금 대기", result: "상한에서 멈춤", at: "10월 24일" },
];

/** 단계 경계의 지난 기록(이 대화). */
export const switches = [
  { at: "14:02", step: "턴 6", text: `${EXT.helm}이 ${josa(T.lead, "을", "를")} 받았어요` },
  { at: "14:02", step: "확산", text: "렌즈 3개를 정했어요" },
  { at: "14:03", step: "탐색", text: "자식 에이전트 3개를 띄웠어요" },
];
