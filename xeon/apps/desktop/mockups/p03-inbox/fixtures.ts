// P-03 받은 요청 고정 데이터. 공용 데이터(a1 도구, a2 질문)는 ../_shell/fixtures.ts 그대로 쓰고,
// 이 화면에서 더 보이는 승인(Helm 렌즈의 도구 승인, 계획, 변경 검토), 제안, 알림만 여기 둔다.
// 모든 항목에 "어느 그룹·확장·계층이 냈는지"(source)를 붙인다: Fresnel은 계층별 플러그인과 L3 플러그인 그룹으로 조립되는 런타임이다.
import { approvals as shared, type ToolApproval } from "../_shell";

export type ApprovalId = "a1" | "a5" | "a2" | "a3" | "a4";

/** 항목을 낸 쪽. layer는 F/X/L0–L3, name은 사람이 읽는 이름, id는 grp:/ext: 식별자. */
export interface Source {
  name: string;
  id: string;
}

export const SRC = {
  core: { name: "기본 에이전트", id: "L1" },
  plan: { name: "plan 모드", id: "L1 tools" },
  review: { name: "review 도구", id: "L2 artifacts" },
  helm: { name: "Helm 그룹", id: "grp:helm" },
  learning: { name: "learning 그룹", id: "grp:learning" },
  knowledge: { name: "knowledge 기능", id: "L2 knowledge" },
  schedule: { name: "예약", id: "L2 schedule" },
  lint: { name: "lint-bot 확장", id: "ext:lint-bot" },
} satisfies Record<string, Source>;

/** Helm 탐구의 렌즈 하나(자식 에이전트)가 쓰기 없는 테스트 실행을 물어본다. */
export const helmTool: ToolApproval = {
  kind: "tool",
  thread: "캐시 무효화 조사",
  tool: "bash",
  risk: "exec",
  at: "1분 전",
  command: "bun test test/expiry.test.ts",
  secrets: [],
  args: { command: "bun test test/expiry.test.ts", cwd: "~/code/fresnel", timeoutSeconds: 60 },
  remember: ["once", "thread"],
};

export const plan = {
  thread: "빌드 실패 분석",
  at: "2분 전",
  version: 2,
  title: "캐시 만료 수정",
  steps: [
    "만료 단위를 ms로 통일",
    "isExpired 경계 테스트 3개 추가",
    "docs/cache.md 단위 표기 고치기",
  ],
  more: 9,
  modes: ["default", "acceptEdits"],
};

export const review = {
  thread: "캐시 무효화 조사",
  at: "5분 전",
  title: "캐시 만료 수정",
  round: 1,
  added: 42,
  removed: 18,
  files: [
    { path: "src/cache.ts", change: "수정", hunks: 4 },
    { path: "test/expiry.test.ts", change: "추가", hunks: 2 },
    { path: "docs/cache.md", change: "수정", hunks: 1 },
  ],
};

export interface ApprovalRow {
  id: ApprovalId;
  kind: "도구" | "질문" | "계획" | "변경 검토";
  summary: string;
  mono: boolean;
  thread: string;
  source: Source;
  /** origin.caller: background, subagent:<이름>, lens:<이름> 등 */
  caller?: string;
  at: string;
}

export const approvalRows: ApprovalRow[] = [
  {
    id: "a1",
    kind: "도구",
    summary: shared.a1.command,
    mono: true,
    thread: shared.a1.thread,
    source: SRC.core,
    at: shared.a1.at,
  },
  {
    id: "a5",
    kind: "도구",
    summary: helmTool.command,
    mono: true,
    thread: helmTool.thread,
    source: SRC.helm,
    caller: "lens:ttl-경계",
    at: helmTool.at,
  },
  {
    id: "a3",
    kind: "계획",
    summary: `${plan.title} v${plan.version}`,
    mono: false,
    thread: plan.thread,
    source: SRC.plan,
    at: plan.at,
  },
  {
    id: "a2",
    kind: "질문",
    summary: shared.a2.questions[0]?.text ?? "",
    mono: false,
    thread: shared.a2.thread,
    source: SRC.core,
    at: shared.a2.at,
  },
  {
    id: "a4",
    kind: "변경 검토",
    summary: `${review.title} · 파일 3 · hunk 7`,
    mono: false,
    thread: review.thread,
    source: SRC.review,
    at: review.at,
  },
];

export interface ProposalRow {
  kind: string;
  target: string;
  source: Source;
  meta: string;
  conflict?: boolean;
  at: string;
}

export const proposals: ProposalRow[] = [
  { kind: "스킬 생성", target: "cache-debug", source: SRC.learning, meta: "근거 4", at: "어제" },
  { kind: "메모리 추가", target: "user", source: SRC.learning, meta: "근거 2", at: "어제" },
  {
    kind: "스킬 수정",
    target: "bun-test",
    source: SRC.knowledge,
    meta: "충돌 1",
    conflict: true,
    at: "2일 전",
  },
];

export interface NoticeRow {
  kind: "error" | "completed" | "background";
  title: string;
  body?: string;
  source: Source;
  thread?: string;
  unread: boolean;
  at: string;
}

export const notices: NoticeRow[] = [
  {
    kind: "error",
    title: "예약 실패: 매일 정리",
    body: "rate_limited",
    source: SRC.schedule,
    unread: true,
    at: "1시간 전",
  },
  {
    kind: "error",
    title: "lint-bot 확장을 자동으로 껐어요",
    body: "post 훅이 3번 연속 실패",
    source: SRC.lint,
    unread: true,
    at: "2시간 전",
  },
  {
    kind: "completed",
    title: "탐구 끝: 발견 2",
    source: SRC.helm,
    thread: "캐시 무효화 조사",
    unread: false,
    at: "3시간 전",
  },
  {
    kind: "completed",
    title: "완료: 빌드 실패 분석",
    source: SRC.core,
    thread: "빌드 실패 분석",
    unread: false,
    at: "어제",
  },
  {
    kind: "background",
    title: "학습 검토 끝: 후보 3",
    source: SRC.learning,
    unread: false,
    at: "어제",
  },
];
