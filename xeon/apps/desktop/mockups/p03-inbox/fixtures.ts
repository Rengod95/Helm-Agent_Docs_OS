// P-03 받은 요청 고정 데이터. 공용 데이터(a1 도구, a2 질문)는 ../_shell/fixtures.ts 그대로 쓰고,
// 이 화면에서 더 보이는 승인(Helm 렌즈의 도구 승인, 계획, 변경 검토), 제안, 알림만 여기 둔다.
import { approvals as shared, type ToolApproval } from "../_shell";

export type ApprovalId = "a1" | "a5" | "a2" | "a3" | "a4";

/** Helm 탐구의 렌즈 하나(자식 에이전트)가 쓰기 없는 테스트 실행을 물어본다. */
export const helmTool: ToolApproval = {
  kind: "tool",
  thread: "캐시 무효화 조사",
  tool: "bash",
  risk: "exec",
  at: "1분 전",
  command: "bun test test/expiry.test.ts",
  secrets: [],
  args: { command: "bun test test/expiry.test.ts" },
  remember: ["once", "thread"],
};

export const plan = {
  thread: "빌드 실패 분석",
  at: "2분 전",
  title: "캐시 만료 수정",
  steps: [
    "만료 단위를 ms로 통일",
    "isExpired 경계 테스트 3개 추가",
    "docs/cache.md 단위 표기 고치기",
  ],
  modes: ["default", "acceptEdits"],
};

export const review = {
  thread: "캐시 무효화 조사",
  at: "5분 전",
  title: "캐시 만료 수정",
  files: [
    { path: "src/cache.ts", change: "수정" },
    { path: "test/expiry.test.ts", change: "추가" },
    { path: "docs/cache.md", change: "수정" },
  ],
};

export interface ApprovalRow {
  id: ApprovalId;
  kind: "도구" | "질문" | "계획" | "변경 검토";
  summary: string;
  mono: boolean;
  thread: string;
  at: string;
}

export const approvalRows: ApprovalRow[] = [
  {
    id: "a1",
    kind: "도구",
    summary: shared.a1.command,
    mono: true,
    thread: shared.a1.thread,
    at: shared.a1.at,
  },
  {
    id: "a5",
    kind: "도구",
    summary: helmTool.command,
    mono: true,
    thread: helmTool.thread,
    at: helmTool.at,
  },
  {
    id: "a3",
    kind: "계획",
    summary: plan.title,
    mono: false,
    thread: plan.thread,
    at: plan.at,
  },
  {
    id: "a2",
    kind: "질문",
    summary: shared.a2.questions[0]?.text ?? "",
    mono: false,
    thread: shared.a2.thread,
    at: shared.a2.at,
  },
  {
    id: "a4",
    kind: "변경 검토",
    summary: review.title,
    mono: false,
    thread: review.thread,
    at: review.at,
  },
];

export interface ProposalRow {
  kind: string;
  target: string;
  /** 낸 쪽. 화면에는 내지 않고, 일부 실패 때 어느 쪽 제안이 남는지만 가린다. */
  source: "learning" | "knowledge";
  conflict?: boolean;
  at: string;
}

export const proposals: ProposalRow[] = [
  { kind: "스킬 생성", target: "cache-debug", source: "learning", at: "어제" },
  { kind: "메모리 추가", target: "user", source: "learning", at: "어제" },
  {
    kind: "스킬 수정",
    target: "bun-test",
    source: "knowledge",
    conflict: true,
    at: "2일 전",
  },
];

export interface NoticeRow {
  title: string;
  thread?: string;
  unread: boolean;
  at: string;
}

export const notices: NoticeRow[] = [
  {
    title: "예약 실패: 매일 정리",
    unread: true,
    at: "1시간 전",
  },
  {
    title: "lint-bot 확장을 자동으로 껐어요",
    unread: true,
    at: "2시간 전",
  },
  {
    title: "탐구 끝: 발견 2",
    thread: "캐시 무효화 조사",
    unread: false,
    at: "3시간 전",
  },
  {
    title: "완료: 빌드 실패 분석",
    unread: false,
    at: "어제",
  },
  {
    title: "학습 검토 끝",
    unread: false,
    at: "어제",
  },
];
