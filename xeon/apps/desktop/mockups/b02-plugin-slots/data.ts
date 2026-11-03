// B02 고정 데이터(목업 전용). 열린 대화 "캐시 무효화 조사"에서 켜진 확장들의 화면 기여(ADR-0021 §3.2).
// well: 확장당 1, 막대 칸은 6까지(넘치면 "더 보기"). status: 확장당 1, 24자. command: 확장당 16, 팔레트 "플러그인" 묶음.
// 표시 이름 + 회색 mono id(결정 13). 아이콘은 매니페스트 icon(caustic 아이콘 어댑터 이름)이라는 가정.

export interface WellDecl {
  /** 전체 id "<확장>/<화면>" */
  id: string;
  ext: string;
  display: string;
  /** well 탭 짧은 이름(DP-21) */
  label: string;
  icon: string;
  mode: "declarative" | "frame";
  /** frame이면 frame.reason */
  reason?: string;
}

/** 이 대화에서 켜진 확장의 well 기여. 순서 = 막대 순서(확장 로드 순서). */
export const WELLS: WellDecl[] = [
  {
    id: "helm/panel",
    ext: "helm",
    display: "Helm",
    label: "탐구",
    icon: "Compass",
    mode: "declarative",
  },
  {
    id: "taskflow/panel",
    ext: "taskflow",
    display: "작업 흐름",
    label: "흐름판",
    icon: "GitBranch",
    mode: "frame",
    reason: "작은 흐름 그래프를 그려요",
  },
  {
    id: "review/queue",
    ext: "review",
    display: "검토",
    label: "검토 대기",
    icon: "Eye",
    mode: "declarative",
  },
  {
    id: "learning/notes",
    ext: "learning",
    display: "학습",
    label: "배운 것",
    icon: "Lightbulb",
    mode: "declarative",
  },
  {
    id: "web-exa/recent",
    ext: "web-exa",
    display: "Exa 웹 검색",
    label: "최근 검색",
    icon: "Globe",
    mode: "declarative",
  },
  {
    id: "acme-notes/side",
    ext: "acme-notes",
    display: "Acme 노트",
    label: "노트",
    icon: "FileText",
    mode: "declarative",
  },
  {
    id: "turn-cost/panel",
    ext: "turn-cost",
    display: "턴 비용",
    label: "턴 비용",
    icon: "Target",
    mode: "declarative",
  },
  {
    id: "focus/timer",
    ext: "focus",
    display: "집중 시간",
    label: "집중",
    icon: "Clock",
    mode: "declarative",
  },
];

export interface StatusDecl {
  id: string;
  ext: string;
  display: string;
  /** 플러그인이 낸 글(셸이 24자에서 자른다) */
  text: string;
  tone: "neutral" | "success" | "warning" | "danger";
  title: string;
  /** Popover 첫 줄에 쓰는 자세한 글(없으면 text) */
  detail?: string;
}

export const STATUS: StatusDecl[] = [
  {
    id: "helm/phase",
    ext: "helm",
    display: "Helm",
    text: "탐색 2/3 렌즈",
    tone: "neutral",
    title: "탐구 단계",
  },
  {
    id: "review/pending",
    ext: "review",
    display: "검토",
    // 칸 글은 24자 안(ADR-0021 §3.2). 자세한 글은 Popover에만.
    text: "검토 대기 12건",
    detail: "검토 대기 12건 · 가장 오래된 요청 3일 전",
    tone: "warning",
    title: "대기열",
  },
];

/** 셸 규칙: status 글은 24자(ADR-0021 §3.2). 넘으면 자르고 말줄임. 전체 글은 Popover 첫 줄에. */
export const clip24 = (s: string): string => (s.length > 24 ? `${s.slice(0, 23)}…` : s);

export interface CommandDecl {
  ext: string;
  label: string;
}

export const COMMANDS: CommandDecl[] = [
  { ext: "helm", label: "탐구 시작…" },
  { ext: "helm", label: "탐구 멈춤" },
  { ext: "taskflow", label: "작업 흐름판 열기" },
  { ext: "taskflow", label: "대기 작업 맡기기" },
  { ext: "review", label: "검토 대기열 열기" },
  { ext: "review", label: "지금 대화 검토 요청" },
];

/** 탐구 결과 카드(helm/finished)의 발견. 긴 카드(높이 320 넘침)는 9개. */
export const FINISHED = [
  { conf: "high", claim: "만료 비교 단위가 섞임(ms와 s)", applied: true },
  { conf: "med", claim: "TTL 경계 시각 버그", applied: true },
  { conf: "med", claim: "무효화 이벤트가 쓰기보다 먼저 옴" },
  { conf: "low", claim: "캐시 키 해시가 실행마다 다름" },
  { conf: "low", claim: "테스트 시계가 실제 시계를 씀" },
  { conf: "med", claim: "재시도 뒤 만료 시각을 다시 계산하지 않음" },
  { conf: "low", claim: "로그 시각대가 UTC와 섞임" },
  { conf: "low", claim: "만료 이벤트 이름이 둘" },
  { conf: "low", claim: "캐시 크기 상한이 테스트마다 다름" },
] as const;
