// 공용 셸 고정 데이터: 대화 목록, 주 내비, 받은 요청(승인·제안·알림), 상태 표시줄, 팔레트.
// 스펙 §8.2 "고정 데이터"를 그대로 옮겼다(값을 바꾸지 않는다). 타입만 덧붙였다. 페이지 고유 데이터는 각 목업 폴더에 둔다.

export type ThreadStatus = "running" | "idle" | "failed" | "locked" | "resumable";
export interface Thread {
  id: string;
  folder: string;
  title: string;
  status: ThreadStatus;
  approvals: number;
  current?: boolean;
}

export interface ToolApproval {
  kind: "tool";
  thread: string;
  tool: string;
  risk: string;
  at: string;
  command: string;
  secrets: { env: string; ref: string }[];
  args: Record<string, string | number>;
  remember: string[];
}
export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}
export interface Question {
  id: string;
  header: string;
  text: string;
  multiSelect: boolean;
  allowFreeText: boolean;
  options: QuestionOption[];
}
export interface QuestionApproval {
  kind: "question";
  thread: string;
  at: string;
  questions: Question[];
}

export interface NavEntry {
  id: string;
  label: string;
  badge?: number;
  tone?: "danger";
}
export interface Notice {
  kind: "error" | "completed" | "background_completed";
  title: string;
  body?: string;
  at: string;
}
export type PaletteItem = string | { label: string; kbd?: string; hint?: string };

export const threads: Thread[] = [
  {
    id: "t1",
    folder: "~/code/xeon",
    title: "캐시 무효화 조사",
    status: "running",
    approvals: 1,
    current: true,
  },
  { id: "t2", folder: "~/code/xeon", title: "테스트 정리", status: "idle", approvals: 1 },
  { id: "t3", folder: "~/code/xeon", title: "빌드 실패 분석", status: "idle", approvals: 0 },
  { id: "t4", folder: "~/code/xeon", title: "예약: 매일 정리", status: "failed", approvals: 0 },
  { id: "t5", folder: "~/notes", title: "주간 회고", status: "idle", approvals: 0 },
  { id: "t6", folder: "~/notes", title: "CLI 세션", status: "locked", approvals: 0 },
  { id: "t7", folder: "~/notes", title: "", status: "resumable", approvals: 0 },
];
export const nav: NavEntry[] = [
  { id: "chat", label: "대화", badge: 2 },
  { id: "inbox", label: "받은 요청", badge: 5 },
  { id: "proposals", label: "제안", badge: 3 },
  { id: "schedules", label: "예약", badge: 1, tone: "danger" },
];
// "연결"(P-08)은 작업대 "엔진"으로 옮겼다(§4.9.3). 대화 영역 주 내비는 넷이다.

/** 작업대 내비 일곱(§4.9.3, §14.3). badge는 글자 그대로: 확장 "!1"(자동 꺼짐·실패 확장 수), 시험 실행 "1*"(실행 중 수). */
export interface WorkbenchNavEntry {
  id: string;
  label: string;
  badge?: string;
  tone?: "danger";
  /** 스크린 리더용 배지 문장 */
  badgeLabel?: string;
}
export const workbenchNav: WorkbenchNavEntry[] = [
  { id: "overview", label: "개요" },
  { id: "extensions", label: "확장", badge: "!1", tone: "danger", badgeLabel: "주의 확장 1개" },
  { id: "tests", label: "시험 실행", badge: "1*", badgeLabel: "실행 중 1개" },
  { id: "metrics", label: "측정" },
  { id: "compose", label: "구성" },
  { id: "create", label: "만들기" },
  { id: "engine", label: "엔진" },
];

/** "플러그인 화면" 목록: 켜진 확장의 page 기여(ADR-0021 §3.2), 확장별 묶음. id는 "<확장>/<화면>". */
export interface PluginPageEntry {
  id: string;
  ext: string;
  label: string;
  /** 확장이 꺼져 있으면 연하게, 누르면 자리표시(ADR-0021 §3.6 extension_disabled). */
  disabled?: boolean;
}
export const pluginPages: PluginPageEntry[] = [
  { id: "helm/inquiry", ext: "helm", label: "Helm 탐구" },
  { id: "review/queue", ext: "review", label: "review 대기열", disabled: true },
];
export const approvals: { a1: ToolApproval; a2: QuestionApproval } = {
  a1: {
    kind: "tool",
    thread: "캐시 무효화 조사",
    tool: "bash",
    risk: "exec",
    at: "지금",
    command: "rm -rf .cache && bun test",
    secrets: [{ env: "GH_TOKEN", ref: "secret://github-token" }],
    args: { command: "rm -rf .cache && bun test", cwd: "~/code/xeon", timeoutSeconds: 120 },
    remember: ["once", "thread"],
  },
  a2: {
    kind: "question",
    thread: "테스트 정리",
    at: "3분 전",
    questions: [
      {
        id: "q1",
        header: "범위",
        text: "어느 시험 묶음부터 볼까요?",
        multiSelect: false,
        allowFreeText: true,
        options: [
          { id: "unit", label: "unit", description: "빠르고 격리됨", recommended: true },
          { id: "integration", label: "integration" },
          { id: "e2e", label: "e2e" },
        ],
      },
    ],
  },
};
export const inbox = {
  approvals: ["a1", "a2"] as const,
  proposals: [{ kind: "스킬 생성", target: "cache-debug", source: "학습", extra: "외 2" }],
  notices: [
    { kind: "error", title: "예약 실패: 매일 정리", body: "rate_limited", at: "1시간 전" },
    { kind: "completed", title: "완료: 빌드 실패 분석", at: "어제" },
    { kind: "background_completed", title: "학습 검토 끝: 후보 3", at: "어제" },
  ] satisfies Notice[] as Notice[],
};
export const status = {
  target: "사이드카",
  engine: "실행 중",
  link: "연결됨",
  model: "sonnet-5-5",
  tokens: { used: 41000, ratio: 0.4 },
  goal: "2/3",
  helm: "탐색",
  approvals: 2,
  notices: 3,
};
export const palette: { group: string; items: PaletteItem[] }[] = [
  { group: "대화", items: ["캐시 무효화 조사", "테스트 정리"] },
  {
    group: "명령",
    items: [
      { label: "새 대화", kbd: "⌘N" },
      { label: "대화 컴팩션" },
      { label: "중단", kbd: "⌘." },
    ],
  },
  {
    group: "슬래시 명령",
    items: [
      { label: "/compact", hint: "대화를 요약해 문맥을 줄여요" },
      { label: "/helm start", hint: "탐구 시작" },
    ],
  },
  {
    group: "작업대",
    items: [
      { label: "작업대 개요" },
      { label: "확장", hint: "켜기·끄기, 자동 꺼짐" },
      { label: "Helm 탐구", hint: "helm/inquiry" },
    ],
  },
  { group: "설정", items: [{ label: "기본 모델", hint: "l1.models.default" }] },
];
