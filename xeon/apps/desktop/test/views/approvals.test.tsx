import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ApprovalRequestedPayload } from "@fresnel/contracts/records";
import { renderToString } from "react-dom/server";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { ApprovalQueue } from "../../src/views/approvals.tsx";
import type { Commands } from "../../src/views/commands.ts";
import { Providers } from "../../src/views/providers.tsx";
import { fakeCommands } from "./fake-commands.ts";
import { evt, openedHarness, thr } from "../state/helpers.ts";

// 서버 렌더는 getInitialState를 읽으므로 상태를 채운 스냅샷을 초기 상태로 하는 스토어를 만든다.
// 클릭은 DOM이 없어 시험하지 못한다. 클릭이 부르는 답 조립은 approval-form.test.ts가 본다.

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

const commands: Commands = fakeCommands();

function mirrorWith(request: ApprovalRequestedPayload): EngineMirror {
  const h = openedHarness();
  h.store.ingest({ type: "threads", threads: [] });
  h.store.ingest({
    type: "approvals",
    approvals: [{ approvalId: evt(7), seq: 4, request }],
  });
  h.store.flush();
  const state = h.store.read.getState();
  expect(state.approvals.ids).toEqual([evt(7)]);
  return state;
}

function html(
  request: ApprovalRequestedPayload,
  options: {
    readonly failure?: "invalid" | "closed" | "unapplied" | "failed" | "gone" | "locked";
    readonly detail?: string;
  } = {},
): string {
  const engine = frozen(mirrorWith(request));
  const uiStore = createUiStore();
  if (options.failure !== undefined)
    uiStore.actions.approvalFailed(evt(7), options.failure, options.detail);
  const ui = frozen<UiState>(uiStore.read.getState());
  return renderToString(
    <Providers engine={engine} ui={ui} commands={commands}>
      <ApprovalQueue />
    </Providers>,
  );
}

const origin = { threadId: thr(1), turnId: null, stepId: null, toolCallId: null, caller: "main" };

function toolRequest(args: Record<string, unknown>): ApprovalRequestedPayload {
  return {
    origin,
    requestKey: "k",
    title: 'Allow "bash" to use TOKEN?',
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
    body: {
      kind: "tool",
      tool: {
        toolName: "bash",
        risk: "execute",
        args: JSON.parse(JSON.stringify(args)),
        argsHash: "h",
        ruleId: null,
      },
    },
  };
}

function questionRequest(
  question: Extract<ApprovalRequestedPayload["body"], { kind: "question" }>["question"],
): ApprovalRequestedPayload {
  return {
    origin,
    requestKey: "k",
    title: "Question",
    remember: ["once"],
    surfaceThreadId: thr(1),
    requestedAt: 0,
    body: { kind: "question", question },
  };
}

describe("tool approval card", () => {
  test("shows the command, the args and the secret handles, never a value", () => {
    const out = html(
      toolRequest({ command: "deploy --prod", secretEnv: { TOKEN: "secret://prod/token" } }),
    );
    expect(out).toContain("deploy --prod");
    expect(out).toContain("TOKEN");
    expect(out).toContain("secret://prod/token");
    expect(out).toContain("시크릿");
    expect(out).toContain("bash");
    expect(out).toContain(t("desktop.approvals.risk.exec"));
  });

  test("a call with no secrets shows no secret block", () => {
    const out = html(toolRequest({ command: "ls" }));
    expect(out).toContain("ls");
    expect(out).not.toContain("시크릿");
  });
});

const fileRequest = (
  toolName: string,
  args: Record<string, unknown>,
): ApprovalRequestedPayload => ({
  ...toolRequest({}),
  body: {
    kind: "tool",
    tool: {
      toolName,
      risk: "write",
      args: JSON.parse(JSON.stringify(args)),
      argsHash: "h",
      ruleId: null,
    },
  },
});

/** 화면 글만 남긴다: 주석과 태그를 지우고 글자 실체를 푼다(서버 렌더의 텍스트 노드를 비교한다) */
function visibleText(markup: string): string {
  return markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** 기동 승인 요청. 저장된 제목은 엔진이 쓴 영어 그대로다 */
function startRequest(args: Record<string, unknown>): ApprovalRequestedPayload {
  return {
    ...toolRequest({}),
    title: 'Start MCP server "gh" with secret://gh-token?',
    body: {
      kind: "tool",
      tool: {
        toolName: "mcp_start",
        risk: "exec",
        args: JSON.parse(JSON.stringify(args)),
        argsHash: "h",
        ruleId: "mcp.start",
      },
    },
  };
}

const START_ARGS = {
  server: "gh",
  source: "settings:user",
  command: "gh-mcp",
  args: ["--stdio", "--log", "a b"],
  cwd: "/srv/gh",
  envNames: ["LOG_LEVEL"],
  secretEnv: { GITHUB_TOKEN: "secret://gh-token" },
  definitionHash: "h",
};

describe("MCP start approval card", () => {
  test("shows the Korean title, the full command line with its args, the source, the folder, the names and the secret handle, not the English title or the rule id", () => {
    const markup = html(startRequest(START_ARGS));
    const text = visibleText(markup);
    expect(text).toContain('MCP 서버 "gh" 시작할까요?');
    expect(text).toContain("gh-mcp --stdio --log 'a b'");
    expect(text).toContain("사용자 설정");
    expect(text).toContain("/srv/gh");
    expect(text).toContain("LOG_LEVEL");
    expect(text).toContain("GITHUB_TOKEN ← secret://gh-token");
    expect(text).toContain("시크릿을 쓰는 서버라서 실행 전에 확인해요");
    expect(text).not.toContain("Start MCP server");
    expect(text).not.toContain("바뀜");
    expect(markup).not.toContain("mcp.start");
    expect(text).not.toContain("mcp.start");
  });

  test("a changed definition shows the badge, what changed, and the before and after command lines", () => {
    const text = visibleText(
      html(
        startRequest({
          ...START_ARGS,
          command: "gh-mcp-next",
          changed: {
            fields: ["command", "secretEnv"],
            before: { command: "gh-mcp", args: ["--stdio"], cwd: null },
          },
        }),
      ),
    );
    expect(text).toContain("바뀜");
    expect(text).toContain("바뀐 곳: 명령, 시크릿");
    expect(text).toContain("이전: gh-mcp --stdio / 지금: gh-mcp-next --stdio --log 'a b'");
  });
});

describe("file change approval card", () => {
  test("an edit shows the path, the changed lines, and the raw args behind 자세히", () => {
    const out = html(
      fileRequest("edit", {
        path: "src/a.ts",
        edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
      }),
    );
    expect(out).toContain("수정");
    expect(out).toContain(">src/a.ts</code>");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const a = 2;");
    expect(out).toContain("자세히");
    expect(out).not.toContain("더 보기");
  });

  test("an edit longer than thirty rows folds the rest behind 더 보기", () => {
    const old = Array.from({ length: 40 }, (_, index) => `o${index + 1}`).join("\n");
    const next = Array.from({ length: 40 }, (_, index) => `n${index + 1}`).join("\n");
    const out = html(
      fileRequest("edit", { path: "big.ts", edits: [{ oldText: old, newText: next }] }),
    );
    expect(out).toContain("더 보기 (50줄)");
  });

  test("a write shows its content with the lines past forty counted", () => {
    const content = Array.from({ length: 45 }, (_, index) => `row ${index + 1}`).join("\n");
    const out = html(fileRequest("write", { path: "notes.md", content }));
    expect(out).toContain("파일 쓰기");
    expect(out).toContain(">notes.md</code>");
    // diff 칸의 줄 번호(data-line)는 앞 40줄까지만 있다. 뒤 줄은 "자세히" 안의 인자 JSON에만 남는다
    expect(out).toContain('data-line="40"');
    expect(out).not.toContain('data-line="41"');
    expect(out).toContain("5줄 더 있어요");
  });

  test("a bash card has no file header", () => {
    const out = html(toolRequest({ command: "ls" }));
    expect(out).not.toContain("파일 쓰기");
    expect(out).not.toContain("더 보기");
  });
});

describe("question approval card", () => {
  const picker = questionRequest({
    questions: [
      {
        id: "q1",
        header: "Scope",
        text: "Which one?",
        options: [
          { id: "a", label: "Alpha", description: "first", recommended: true },
          { id: "b", label: "Beta" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
      {
        id: "q2",
        text: "Pick some",
        options: [{ id: "x", label: "Ex" }],
        multiSelect: true,
        allowFreeText: true,
      },
    ],
  });

  test("renders options as radios or checkboxes and shows header, description and recommended", () => {
    const out = html(picker);
    expect(out).toContain("Scope");
    expect(out).toContain("Alpha");
    expect(out).toContain("(추천)");
    expect(out).toContain("first");
    // 선택지는 caustic ChoiceGroup의 단추다(역할로 라디오와 체크박스를 구분한다)
    expect(out).toContain('role="radio"');
    expect(out).toContain('role="checkbox"');
  });

  test("a free-text input appears only where allowFreeText is set", () => {
    const out = html(picker);
    expect(out.match(/type="text"/g)?.length).toBe(1);
    const freeOnly = html(
      questionRequest({
        questions: [
          { id: "f", text: "Why?", options: [], multiSelect: false, allowFreeText: true },
        ],
      }),
    );
    expect(freeOnly).toContain('type="text"');
    expect(freeOnly).not.toContain('type="radio"');
  });

  test("the answer button starts disabled and a deny button is offered", () => {
    const out = html(picker);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>답하기/);
    expect(out).toContain("거부");
  });
});

describe("failure marks tell the user what to do", () => {
  const request = toolRequest({ command: "ls" });
  test("answer invalid, already resolved, unapplied, failed and gone read differently", () => {
    const texts = (["invalid", "closed", "unapplied", "failed", "gone", "locked"] as const).map(
      (failure) => {
        const out = html(request, { failure });
        expect(out).toContain(`data-failure="${failure}"`);
        return out.match(/data-failure="[a-z]+">([^<]*)</)?.[1];
      },
    );
    expect(new Set(texts).size).toBe(6);
    expect(texts[0]).toContain("올바르지 않아");
    expect(texts[1]).toContain("이미 처리된");
    expect(texts[4]).toBe("이 승인은 더 이상 답할 수 없어요.");
    expect(texts[5]).toContain("다른 곳(터미널 등)에서 이 대화를 쓰고 있어서");
  });

  test("only a gone approval offers the remove button; the other failures do not", () => {
    expect(html(request, { failure: "gone" })).toContain('data-action="dismiss"');
    expect(html(request, { failure: "gone" })).toContain("지우기");
    for (const failure of ["invalid", "closed", "unapplied", "failed"] as const) {
      expect(html(request, { failure })).not.toContain('data-action="dismiss"');
    }
    expect(html(request)).not.toContain('data-action="dismiss"');
  });
});

describe("answer_invalid detail", () => {
  test("shows the one line the host gave next to the failure text", () => {
    const out = html(toolRequest({ command: "ls" }), {
      failure: "invalid",
      detail: "q2: choose at most one",
    });
    expect(out).toContain("q2: choose at most one");
  });
});

const replaceRequest = (args: Record<string, unknown>): ApprovalRequestedPayload => ({
  ...toolRequest({}),
  title: 'Let "safe-write" replace the built-in tool "write"?',
  body: {
    kind: "tool",
    tool: {
      toolName: "tool_replace",
      risk: "write",
      args: JSON.parse(JSON.stringify(args)),
      argsHash: "h",
      ruleId: "tools.replace",
    },
  },
});

describe("tool replacement approval card", () => {
  test("shows the extension, the tool, the trust, the risk change and the path protection notice in Korean", () => {
    const out = html(
      replaceRequest({
        tool: "write",
        extension: "safe-write",
        owner: "ext.safe-write",
        trust: "untrusted",
        originalRisk: "write",
        effectiveRisk: "execute",
        notice: "Built-in file path protection runs inside the built-in tool.",
      }),
    );
    expect(out).toContain("기본 도구를 대체하려는 요청이에요");
    expect(out).toContain("<code>safe-write</code>");
    expect(out).toContain("<code>write</code>");
    expect(out).toContain("신뢰하지 않음");
    expect(out).toContain("쓰기 → 실행");
    expect(out).toContain("파일 경로 보호는 대체 도구에 적용되지 않아요");
    // 같은 카드의 허용·거부 단추와 일반 도구 요약도 그대로 있다
    expect(out).toContain("허용");
    expect(out).toContain("도구 tool_replace");
  });

  test("a trust the card does not know shows no trust line, and the notice is shown even without notice args", () => {
    const out = html(replaceRequest({ tool: "write", extension: "x", trust: "root" }));
    expect(out).not.toContain("신뢰 등급");
    expect(out).toContain("파일 경로 보호는 대체 도구에 적용되지 않아요");
  });

  test("an ordinary tool card shows no replacement block", () => {
    expect(html(toolRequest({ command: "ls" }))).not.toContain("기본 도구를 대체하려는");
  });
});

const withCaller = (caller: string): ApprovalRequestedPayload => ({
  ...toolRequest({ command: "ls" }),
  origin: { ...origin, caller },
});

describe("approval origin line", () => {
  test("a child agent request shows where it came from, and a main request shows nothing", () => {
    expect(html(withCaller("subagent:렌즈"))).toContain("요청한 곳: 보조 에이전트 렌즈");
    expect(html(withCaller("ext:helm"))).toContain("요청한 곳: 그룹 helm");
    expect(html(withCaller("main"))).not.toContain("요청한 곳");
  });
});

const planRequest = (plan: string): ApprovalRequestedPayload => ({
  origin,
  requestKey: "k",
  title: "Split the cache step",
  remember: ["once"],
  surfaceThreadId: thr(1),
  requestedAt: 0,
  body: { kind: "plan", plan: { plan, planRef: null, nextModes: ["default", "plan"] } },
});

describe("plan approval card", () => {
  test("shows the mode choice and the approve, request-changes and deny buttons", () => {
    const out = html(planRequest("1. Split the step\n2. Add two tests"));
    expect(out).toContain("승인 뒤 모드");
    expect(out).toContain("수정 요청");
    expect(out).toContain("피드백");
    expect(out).toMatch(/data-action="primary"[^>]*>승인</);
    expect(out).toMatch(/data-action="deny"[^>]*>거부</);
  });

  test("a plan longer than the fold line offers the rest behind 전체 보기, a short plan does not", () => {
    const long = Array.from({ length: 14 }, (_, i) => `step ${i + 1}`).join("\n");
    expect(html(planRequest(long))).toContain("전체 보기");
    expect(html(planRequest("1. only step"))).not.toContain("전체 보기");
  });
});

const reviewRequest: ApprovalRequestedPayload = {
  origin,
  requestKey: "k",
  title: "Review the cache changes",
  remember: ["once"],
  surfaceThreadId: thr(1),
  requestedAt: 0,
  body: {
    kind: "review",
    review: {
      reviewId: `rvw_${"0".repeat(24)}AB`,
      artifactId: `art_${"0".repeat(24)}CD`,
      title: "Cache expiry",
      round: 1,
      files: [
        { path: "src/cache.ts", change: "modified", binary: false, hunks: 4 },
        { path: "test/expiry.test.ts", change: "added", binary: false, hunks: 2 },
      ],
    },
  },
};

describe("review approval card", () => {
  test("shows the round, the file totals, each file's change and hunks, and the approve-all and deny buttons", () => {
    const out = html(reviewRequest);
    expect(out).toContain("라운드 1");
    expect(out).toContain("파일 2 · hunk 6");
    expect(out).toContain("src/cache.ts");
    expect(out).toContain("hunk 4");
    expect(out).toContain("추가");
    expect(out).toMatch(/data-action="primary"[^>]*>모두 승인</);
    expect(out).toMatch(/data-action="deny"[^>]*>모두 거절</);
  });
});

describe("approval memory", () => {
  test("a tool card never offers a remember choice, even if a stored request lists thread", () => {
    expect(html({ ...toolRequest({ command: "ls" }), remember: ["once", "thread"] })).not.toContain(
      "이 대화에서 항상",
    );
    expect(html(toolRequest({ command: "ls" }))).not.toContain("이 대화에서 항상");
  });
});

describe("approval queue per conversation", () => {
  test("shows only the open conversation's approvals; others stay in the inbox", () => {
    const h = openedHarness();
    h.store.ingest({ type: "threads", threads: [] });
    const here = toolRequest({ command: "echo here" });
    const elsewhere: ApprovalRequestedPayload = {
      ...toolRequest({ command: "echo elsewhere" }),
      surfaceThreadId: thr(2),
    };
    h.store.ingest({
      type: "approvals",
      approvals: [
        { approvalId: evt(7), seq: 4, request: elsewhere },
        { approvalId: evt(8), seq: 5, request: here },
      ],
    });
    h.store.flush();
    const state = h.store.read.getState();
    expect(state.approvals.ids).toEqual([evt(7), evt(8)]);
    const out = renderToString(
      <Providers
        engine={frozen(state)}
        ui={frozen<UiState>(createUiStore().read.getState())}
        commands={commands}
      >
        <ApprovalQueue />
      </Providers>,
    );
    expect(out).toContain("echo here");
    expect(out).not.toContain("echo elsewhere");
  });
});

/** MCP 서버 도구의 승인 요청. 서버 이름과 서버가 알린 성질을 본문에 싣는다 */
function mcpToolRequest(
  mcp: NonNullable<Extract<ApprovalRequestedPayload["body"], { kind: "tool" }>["tool"]["mcp"]>,
  ruleId = "mcp.default",
): ApprovalRequestedPayload {
  return {
    ...toolRequest({ text: "hi" }),
    title: 'Allow tool "echo"?',
    body: {
      kind: "tool",
      tool: { toolName: "echo", risk: "exec", args: { text: "hi" }, argsHash: "h", ruleId, mcp },
    },
  };
}

describe("MCP tool approval card", () => {
  test("shows the server name as a chip, the traits the server declared, and a warning that they cannot be trusted", () => {
    const text = visibleText(
      html(
        mcpToolRequest({ server: "qa", declared: { readOnlyHint: true, destructiveHint: true } }),
      ),
    );
    expect(text).toContain("서버 qa");
    expect(text).toContain("서버가 알린 성질: 읽기 전용, 파괴적");
    expect(text).toContain("서버가 스스로 알린 것이라 믿을 수 없어요");
  });

  test("a server that declares nothing shows only the name chip, with no traits line and no warning", () => {
    const text = visibleText(html(mcpToolRequest({ server: "qa" })));
    expect(text).toContain("서버 qa");
    expect(text).not.toContain("서버가 알린 성질");
    expect(text).not.toContain("믿을 수 없어요");
  });

  test("the warning is on the card and not in the info icon's hidden text", () => {
    const markup = html(mcpToolRequest({ server: "qa", declared: { readOnlyHint: true } }));
    expect(markup).not.toMatch(/class="sr-only"[^>]*>서버가 스스로 알린/);
    expect(visibleText(markup)).toContain("서버가 스스로 알린 것이라 믿을 수 없어요");
  });

  test("the default MCP rule is behind the info icon, explained in Korean with its name in parentheses", () => {
    const markup = html(mcpToolRequest({ server: "qa" }));
    expect(markup).toMatch(
      /class="sr-only"[^>]*>MCP 도구는 기본으로 물어봐요 \(규칙 mcp\.default\)<\/span>/,
    );
    expect(visibleText(markup)).not.toContain("규칙 mcp.default 때문에");
  });

  test("another rule keeps its name, and it is also behind the info icon", () => {
    const markup = html(mcpToolRequest({ server: "qa" }, "mcp.qa.echo"));
    expect(markup).toMatch(/class="sr-only"[^>]*>규칙 mcp\.qa\.echo 때문에 물어요<\/span>/);
  });

  test("an ordinary tool card has no server chip and no MCP warning", () => {
    const text = visibleText(html(toolRequest({ command: "ls" })));
    expect(text).not.toContain("서버 ");
    expect(text).not.toContain("믿을 수 없어요");
  });
});
