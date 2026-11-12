// 대화 줄 전시 화면의 고정 대화(시험 전용). 모든 줄 종류가 한 번씩 나오게 짠 가짜 기록이다.
// 확정 item은 엔진 거울에 사실로 넣고, 턴·개입·승인·주도 구간·표지는 대화 상태(`ThreadConvo`)로 바로 만든다.
import type {
  ItemId,
  ItemRecord,
  JsonObject,
  ThreadId,
  TurnId,
} from "@fresnel/contracts/conversation";
import type { DurableFact } from "../../../src/state/engine/input.ts";
import {
  EMPTY_THREAD_CONVO,
  type ApprovalTrail,
  type Intervention,
  type ThreadConvo,
  type TurnRecord,
} from "../../../src/state/engine/convo.ts";
import { evt, itm, recorded, thr, trn } from "../../state/helpers.ts";

export const THREAD: ThreadId = thr(1);
const T0 = Date.parse("2026-11-12T05:00:00.000Z");
/** item n의 기록 시각(ms). 요약 구분선 자리를 이 값으로 고른다 */
const stamp = (n: number): number => T0 + n * 4000;
const iso = (ms: number): string => new Date(ms).toISOString();

const MODEL = "claude-sonnet-5-5";

type Usage = Extract<ItemRecord, { kind: "assistant" }>["message"]["usage"];

function usageOf(input: number, output: number): Usage {
  return {
    input,
    output,
    cacheRead: Math.round(input * 0.6),
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  };
}

type AssistantBlock = Extract<ItemRecord, { kind: "assistant" }>["message"]["content"][number];

const text = (value: string): AssistantBlock => ({ type: "text", text: value });
const thinking = (value: string): AssistantBlock => ({ type: "thinking", thinking: value });
const call = (id: string, name: string, args: JsonObject): AssistantBlock => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

function user(n: number, content: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "user",
    message: { role: "user", content, timestamp: stamp(n) },
    requestId: null,
  };
}

function assistant(n: number, content: readonly AssistantBlock[]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    partIds: [],
    message: {
      role: "assistant",
      content: [...content],
      api: "anthropic-messages",
      provider: "anthropic",
      model: MODEL,
      usage: usageOf(0, 0),
      stopReason: "stop",
      timestamp: stamp(n),
    },
  };
}

function result(
  n: number,
  callId: string,
  toolName: string,
  body: string,
  options: {
    readonly error?: boolean;
    readonly status?: ItemRecord["status"];
    readonly details?: JsonObject;
  } = {},
): ItemRecord {
  const isError = options.error === true;
  return {
    itemId: itm(n),
    status: options.status ?? (isError ? "failed" : "completed"),
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName,
      content: [{ type: "text", text: body }],
      isError,
      ...(options.details === undefined ? {} : { details: options.details }),
      timestamp: stamp(n),
    },
  };
}

function custom(n: number, customType: string, content: string, details: JsonObject): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "custom",
    message: { role: "custom", customType, content, display: true, details, timestamp: stamp(n) },
  };
}

// ── 대화 본문 ─────────────────────────────────────────────────────────

const REPLY_MARKDOWN = `## 정리한 내용

검증 규칙을 \`validateLogin\` 하나로 모았고, 화면은 그 결과만 읽습니다. 자세한 배경은 [폼 검증 안내](https://example.com/guide/forms)를 참고했습니다.

### 바뀐 점

- 이메일 형식 검사를 \`src/auth/rules.ts\`로 옮겼습니다.
- 비밀번호 길이 규칙을 **8자 이상**으로 맞췄습니다.
- 실패 문구는 한곳에서 고릅니다.
  1. 빈 값
  2. 형식 오류

| 규칙 | 이전 | 이후 |
| --- | --- | --- |
| 이메일 | 화면마다 다름 | \`rules.ts\` 하나 |
| 비밀번호 | 6자 | 8자 |
| 오류 문구 | 하드코딩 | 문구 표 |

> 기존 세션 토큰 검사는 건드리지 않았습니다. 따로 확인이 필요합니다.

\`\`\`ts
export function validateLogin(input: LoginInput): Result<LoginInput, LoginError> {
  if (input.email.trim() === "") return err({ field: "email", kind: "empty" });
  if (!EMAIL.test(input.email)) return err({ field: "email", kind: "format" });
  if (input.password.length < 8) return err({ field: "password", kind: "short" });
  return ok(input);
}
\`\`\`

다시 확인하려면 이렇게 돌리면 됩니다.

\`\`\`bash
pnpm test --filter auth
pnpm lint src/auth
\`\`\``;

const SEARCH_OUTPUT = `[s1] 폼 검증 모범 사례 (2026-03-02) https://example.com/guide/forms
[s2] Accessible error messages https://docs.example.org/a11y/errors
[s3] Password length guidance (2025-11-20) https://security.example.net/passwords`;

const AGENT_REPORT = `## 점검 결과

- 로그인 화면 3곳이 새 규칙을 씁니다.
- 회원가입 화면은 아직 옛 검사를 씁니다(\`signup-form.tsx\`).
- 테스트 12개가 모두 통과했습니다.`;

const PLAN_BODY = `1. 회원가입 화면을 새 규칙으로 옮긴다.
2. 옛 검사 함수를 지운다.
3. 오류 문구 표를 번역 파일로 옮긴다.`;

const READS = ["app.ts", "login-form.tsx", "rules.ts", "errors.ts", "session.ts", "routes.ts"];

/** 확정 item(기록 순서). seq는 100 + item 번호다 */
const ITEMS: readonly ItemRecord[] = [
  // ── 턴 1: 사용자 말(첨부) → 생각 + 답 → 읽기 묶음 → 단일 줄들 → 마크다운 답
  user(
    1,
    '로그인 폼 검증 로직을 한곳으로 정리해 줘. 지금 규칙은 첨부한 메모에 있어.\n<attachment name="rules-memo.md" path="notes/rules-memo.md">email, password</attachment>',
  ),
  assistant(2, [
    thinking(
      "검증 규칙이 화면마다 흩어져 있는 것 같다. 먼저 관련 파일을 읽고, 테스트가 어떻게 돌고 있는지 본다.",
    ),
    text("먼저 관련 파일을 읽고 지금 규칙이 어디에 있는지 볼게요."),
    ...READS.map((file, i) =>
      call(`c-read-${i}`, "read", {
        path: `src/auth/${file}`,
        ...(i === 1 ? { offset: 1, limit: 80 } : {}),
      }),
    ),
    call("c-bash-a", "bash", { command: "git status --short" }),
    call("c-bash-b", "bash", { command: "pnpm typecheck --filter auth" }),
  ]),
  ...READS.map((file, i) => result(3 + i, `c-read-${i}`, "read", `// ${file}\nexport {};`)),
  result(9, "c-bash-a", "bash", " M src/auth/login-form.tsx", {
    details: { exitCode: 0, durationMs: 180 },
  }),
  result(
    10,
    "c-bash-b",
    "bash",
    "src/auth/login-form.tsx:42:7 - error TS2322: Type 'string' is not assignable to type 'LoginError'.\nFound 1 error.",
    { error: true, details: { exitCode: 2, durationMs: 4100 } },
  ),
  assistant(11, [
    text("타입 오류가 하나 있네요. 테스트부터 돌려 볼게요."),
    call("c-test", "bash", { command: "pnpm test --filter auth" }),
  ]),
  result(
    12,
    "c-test",
    "bash",
    "✓ rules.test.ts (8)\n✓ login-form.test.tsx (4)\n\nTest Files  2 passed (2)\n     Tests  12 passed (12)",
    { details: { exitCode: 0, durationMs: 3240 } },
  ),
  assistant(13, [
    call("c-edit", "edit", {
      path: "src/auth/login-form.tsx",
      edits: [
        {
          oldText: "const ok = email.includes('@') && password.length >= 6;",
          newText: "const checked = validateLogin({ email, password });\nconst ok = checked.ok;",
        },
      ],
    }),
  ]),
  result(14, "c-edit", "edit", "Edited src/auth/login-form.tsx"),
  assistant(15, [
    call("c-grep", "grep", { pattern: "includes\\('@'\\)", path: "src", glob: "*.tsx" }),
  ]),
  result(16, "c-grep", "grep", "src/auth/signup-form.tsx:18\nsrc/profile/email-field.tsx:9"),
  assistant(17, [
    call("c-write", "write", {
      path: "src/auth/rules.ts",
      content:
        'export const EMAIL = /^[^@\\s]+@[^@\\s]+$/;\nexport const MIN_PASSWORD = 8;\n\nexport type LoginError = { field: "email" | "password"; kind: string };\n',
    }),
  ]),
  result(18, "c-write", "write", "Wrote src/auth/rules.ts"),
  assistant(19, [call("c-find", "find", { pattern: "*.test.ts", path: "src/auth" })]),
  result(20, "c-find", "find", "src/auth/rules.test.ts\nsrc/auth/session.test.ts"),
  assistant(21, [
    text("테스트 파일 위치를 확인했어요. 폴더 구성도 한 번 볼게요."),
    call("c-ls", "ls", { path: "src/auth" }),
  ]),
  result(22, "c-ls", "ls", "app.ts\nerrors.ts\nlogin-form.tsx\nrules.ts\nsession.ts"),
  assistant(23, [
    thinking("정리가 끝났다. 바뀐 점을 표로 보여 주고 검증 명령을 알려 준다."),
    text(REPLY_MARKDOWN),
  ]),

  // ── 턴 2: 웹 검색·읽기, MCP, 기억·스킬, 할 일, 계획, 하위 에이전트 → 단계 한도로 멈춤
  user(24, "웹에서 최신 권장 사항도 찾아보고, 남은 화면은 계획으로 정리해 줘."),
  assistant(25, [
    text("권장 사항부터 찾아볼게요."),
    call("c-web", "web_search", { query: "login form validation best practices 2026" }),
  ]),
  result(26, "c-web", "web_search", SEARCH_OUTPUT),
  assistant(27, [
    text("첫 번째 글을 자세히 읽어 볼게요."),
    call("c-fetch", "web_fetch", { url: "https://www.example.com/guide/forms" }),
  ]),
  result(
    28,
    "c-fetch",
    "web_fetch",
    `# 폼 검증 모범 사례\n\n[s1] 폼 검증 모범 사례 https://example.com/guide/forms`,
  ),
  assistant(29, [
    text("팀 문서에도 관련 규칙이 있는지 볼게요."),
    call("c-mcp", "mcp__docs__search_pages", { query: "password policy", limit: 5 }),
  ]),
  result(30, "c-mcp", "mcp__docs__search_pages", "2 pages: Password policy, Login UX", {
    details: { server: "docs", tool: "search_pages" },
  }),
  assistant(31, [
    text("이번 결정을 기억해 둘게요."),
    call("c-mem", "memory_manage", {
      store: "user",
      action: "add",
      text: "로그인 검증 규칙은 src/auth/rules.ts 한곳에 둔다.",
    }),
  ]),
  result(32, "c-mem", "memory_manage", "Added entry m1"),
  assistant(33, [
    text("검증 작업용 스킬을 열어 볼게요."),
    call("c-skill", "skill_view", { name: "form-validation" }),
  ]),
  result(34, "c-skill", "skill_view", "# form-validation\n..."),
  assistant(35, [
    call("c-tasks", "task_write", {
      ops: [
        { op: "create", content: "회원가입 화면을 새 규칙으로 옮기기", status: "pending" },
        { op: "update", id: "t2", content: "로그인 화면 규칙 정리", status: "completed" },
        { op: "create", content: "오류 문구 표 번역 파일로 옮기기", status: "in_progress" },
      ],
    }),
  ]),
  result(36, "c-tasks", "task_write", "Tasks updated"),
  assistant(37, [
    call("c-plan", "submit_plan", { title: "남은 화면 검증 규칙 옮기기", body: PLAN_BODY }),
  ]),
  result(38, "c-plan", "submit_plan", "Plan p1 v2: Approved"),
  assistant(39, [
    call("c-agent", "agent", {
      agent: "reviewer",
      task: "로그인과 회원가입 화면이 새 검증 규칙을 쓰는지 점검하고 보고해 줘.",
    }),
  ]),
  result(40, "c-agent", "agent", AGENT_REPORT, { details: { status: "completed" } }),

  // ── 턴 3: 거부·중단·훅·가드·샌드박스·시크릿·승인 기록, 확장 도구, 짝 없는 결과
  user(41, "이제 배포 스크립트를 손봐 줘."),
  assistant(42, [
    call("c-deny", "bash", { command: "rm -rf dist && pnpm build" }),
    call("c-intr", "bash", { command: "pnpm e2e --headed" }),
    call("c-hook", "bash", { command: "curl -X POST https://deploy.example.com/hooks/run" }),
    call("c-guard", "write", {
      path: ".env.production",
      content: "API_URL=https://api.example.com\n",
    }),
    call("c-sandbox", "bash", { command: "pnpm deploy --target staging" }),
    call("c-secret", "bash", { command: "pnpm release --token $DEPLOY_TOKEN" }),
    call("c-approve", "bash", { command: "pnpm build" }),
  ]),
  result(43, "c-deny", "bash", "Denied by user", {
    error: true,
    details: { code: "denied_by_user" },
  }),
  result(44, "c-intr", "bash", "aborted", { error: true, status: "interrupted" }),
  result(45, "c-hook", "bash", "[denied_by_extension] blocked", {
    error: true,
    details: {
      code: "denied_by_extension",
      extension: "deploy-guard",
      outcome: "blocked",
      reason: "운영 배포는 업무 시간에만 허용됩니다",
    },
  }),
  result(46, "c-guard", "write", "[denied_by_guard] protected path", {
    error: true,
    details: { code: "denied_by_guard", reason: ".env 파일은 쓸 수 없습니다" },
  }),
  result(47, "c-sandbox", "bash", "Deployed to staging (3 files)", {
    details: { exitCode: 0, durationMs: 12400 },
  }),
  result(48, "c-secret", "bash", "Released v1.4.0", { details: { exitCode: 0, durationMs: 2300 } }),
  result(49, "c-approve", "bash", "Build finished in 8.1s", {
    details: { exitCode: 0, durationMs: 8100 },
  }),
  assistant(50, [
    text("차트로 결과를 그려 둘게요."),
    call("c-chart", "render_chart", { kind: "bar", series: [3, 5, 2] }),
  ]),
  result(51, "c-chart", "render_chart", "chart rendered (3 bars)"),
  result(52, "c-orphan", "lint_report", "2 warnings in scripts/deploy.ts"),
  assistant(53, [text("배포 스크립트를 정리했습니다. 운영 배포는 확장 정책 때문에 막혀 있어요.")]),

  // ── 턴 4·5: 주도 구간(확장 pilot이 이끈 두 턴)
  user(54, "회원가입 화면 이전을 이어서 진행한다. 단계 1: 규칙 연결."),
  assistant(55, [text("회원가입 화면에서 `validateLogin`을 쓰도록 바꿨습니다.")]),
  user(56, "단계 2: 옛 검사 함수를 지운다."),
  assistant(57, [text("옛 검사 함수 `checkEmail`을 지웠고 참조가 남지 않았습니다.")]),

  // ── 턴 6: 확장 기록(카드와 글)
  user(58, "진행 상황을 카드로 남겨 줘."),
  custom(59, "x.helm.progress.saved", "진행 상황을 저장했습니다.", { lens: "검증 이전 2/3" }),
  custom(60, "x.notes.context", "참고: 회원가입 화면은 다음 주에 배포합니다.", {}),
  assistant(61, [text("카드로 남겼습니다.")]),
];

/** 기록 사실. seq는 100 + item 번호 */
export function itemFacts(): readonly DurableFact[] {
  return ITEMS.map((item) => {
    const n = Number(item.itemId.slice(-4));
    return recorded(100 + n, item, THREAD);
  });
}

/** 요약 구분선: 턴 2의 하위 에이전트 카드 뒤. 숨은 도구 결과 item에 자리를 잡으면 구분선이 그려지지 않아 호출 item 뒤로 둔다 */
export function compactionFact(): DurableFact {
  return {
    type: "thread.compacted",
    seq: 141,
    eventId: evt(141),
    threadId: THREAD,
    turnId: null,
    at: iso(stamp(39) + 1000),
    compaction: {
      summary: "앞의 대화를 요약했습니다.",
      tokensBefore: 182000,
      tokensAfter: 24000,
      reason: "threshold",
    },
  };
}

// ── 대화 상태 ─────────────────────────────────────────────────────────

function turn(
  id: TurnId,
  input: ItemId,
  startedSeq: number,
  options: {
    readonly steps: number;
    readonly seconds: number;
    readonly input: number;
    readonly output: number;
    readonly scopeId?: string;
    readonly limit?: boolean;
  },
): TurnRecord {
  const startedAt = iso(T0 + startedSeq * 1000);
  return {
    turnId: id,
    startedSeq,
    startedAt,
    origin: options.scopeId === undefined ? "user" : "drive",
    scopeId: options.scopeId ?? null,
    requestId: null,
    inputItemIds: [input],
    model: MODEL,
    steps: options.steps,
    lastStepIndex: options.steps - 1,
    lastStopReason: options.limit === true ? "toolUse" : "stop",
    warnings: [],
    lastContextTokens: null,
    notices: [],
    abort: null,
    completion: {
      at: iso(T0 + startedSeq * 1000 + options.seconds * 1000),
      status: options.limit === true ? "interrupted" : "completed",
      stepCount: options.steps,
      usage: usageOf(options.input, options.output),
      error: options.limit === true ? "step_limit" : null,
      durationMs: options.seconds * 1000,
      end: options.limit === true ? { kind: "limit", limit: "step_limit" } : { kind: "completed" },
    },
  };
}

const at = (seq: number): string => iso(T0 + seq * 1000);

function intervention(
  kind: Intervention["kind"],
  seq: number,
  fields: Partial<Pick<Intervention, "extension" | "reason" | "detail">>,
): Intervention {
  return {
    kind,
    extension: fields.extension ?? null,
    reason: fields.reason ?? null,
    detail: fields.detail ?? null,
    seq,
    at: at(seq),
  };
}

const APPROVAL: ApprovalTrail = {
  approvalId: evt(149),
  decision: "allow",
  remember: "once",
  requestedRemember: "once",
  resolvedBy: "user",
  title: "pnpm build 실행",
  caller: "main",
  bodyKind: "tool",
  toolName: "bash",
  seq: 149,
  at: at(149),
};

function tool(
  toolCallId: string,
  fields: {
    readonly approvals?: readonly ApprovalTrail[];
    readonly interventions?: readonly Intervention[];
  },
): ThreadConvo["tools"][string] {
  return {
    toolCallId,
    progress: null,
    approvals: fields.approvals ?? [],
    interventions: fields.interventions ?? [],
  };
}

const LEASE = "lease-pilot-1";

export const CONVO: ThreadConvo = {
  ...EMPTY_THREAD_CONVO,
  turns: [
    turn(trn(1), itm(1), 101, { steps: 9, seconds: 64, input: 28000, output: 6200 }),
    turn(trn(2), itm(24), 124, { steps: 8, seconds: 41, input: 21000, output: 3900, limit: true }),
    turn(trn(3), itm(41), 141.5, { steps: 3, seconds: 27, input: 9000, output: 1200 }),
    turn(trn(4), itm(54), 154, {
      steps: 2,
      seconds: 12,
      input: 6000,
      output: 800,
      scopeId: "ext:pilot",
    }),
    turn(trn(5), itm(56), 156, {
      steps: 2,
      seconds: 9,
      input: 5200,
      output: 600,
      scopeId: "ext:pilot",
    }),
    turn(trn(6), itm(58), 158, { steps: 1, seconds: 4, input: 3000, output: 200 }),
  ],
  tools: {
    "c-sandbox": tool("c-sandbox", {
      interventions: [
        intervention("sandbox_bypassed", 147, {
          reason: "배포 명령은 네트워크가 필요해 샌드박스 밖에서 실행했습니다",
        }),
      ],
    }),
    "c-secret": tool("c-secret", {
      interventions: [intervention("secret_used", 148, { detail: "DEPLOY_TOKEN" })],
    }),
    "c-approve": tool("c-approve", { approvals: [APPROVAL] }),
  },
  toolOrder: ["c-sandbox", "c-secret", "c-approve"],
  leases: [
    {
      leaseId: LEASE,
      scopeId: "ext:pilot",
      lineageId: LEASE,
      epoch: 1,
      limits: { maxTurns: 8, maxTokens: 50000 },
      acquiredSeq: 153,
      acquiredAt: at(153),
      releasedSeq: 157.5,
      releasedAt: at(170),
      releaseReason: null,
    },
  ],
  markers: [
    { seq: 123, at: at(123), change: { kind: "model", model: "claude-opus-5-5" } },
    {
      seq: 141.2,
      at: at(141.2),
      change: { kind: "leaf_moved", reason: "rewind", leafEventId: evt(140) },
    },
  ],
};
