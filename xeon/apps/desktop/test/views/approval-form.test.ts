import { describe, expect, test } from "bun:test";
import {
  answerOf,
  fileChangeViewOf,
  fileChangeViewOfArgs,
  mcpSourceViewOf,
  mcpStartViewOf,
  mcpToolViewOf,
  setPickText,
  shellLineOf,
  shellWordOf,
  toolApprovalView,
  toolReplaceView,
  togglePick,
  type FileChangeRow,
  type FileChangeView,
  type QuestionDraft,
  type QuestionItem,
  type ToolApprovalBody,
} from "../../src/views/approval-form.ts";

function tool(args: ToolApprovalBody["args"]): ToolApprovalBody {
  return { toolName: "bash", risk: "execute", args, argsHash: "h", ruleId: null };
}

function fileTool(toolName: string, args: ToolApprovalBody["args"]): ToolApprovalBody {
  return { toolName, risk: "write", args, argsHash: "h", ruleId: null };
}

const lines = (count: number, prefix: string): string =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join("\n");

describe("toolApprovalView", () => {
  test("shows the command, the full args and the secret handles of a bash call", () => {
    const view = toolApprovalView(
      tool({
        command: 'curl -H "Authorization: $TOKEN" https://api.example.com',
        secretEnv: { TOKEN: "secret://prod/api-token", ODD: "plain-value" },
      }),
    );
    expect(view.command).toBe('curl -H "Authorization: $TOKEN" https://api.example.com');
    expect(view.secrets).toEqual([
      { name: "TOKEN", handle: "secret://prod/api-token" },
      { name: "ODD", handle: null },
    ]);
    expect(view.argsText).toContain("secretEnv");
    expect(view.argsStored).toBe(false);
  });

  test("never echoes a non-handle value of secretEnv as a handle", () => {
    const view = toolApprovalView(tool({ command: "x", secretEnv: { A: "hunter2" } }));
    expect(view.secrets).toEqual([{ name: "A", handle: null }]);
  });

  test("a call without secretEnv or command has neither", () => {
    const view = toolApprovalView(tool({ path: "/a/b" }));
    expect(view.command).toBeNull();
    expect(view.secrets).toEqual([]);
    expect(view.argsText).toContain("/a/b");
  });

  test("big args stay in the blob store and are not shown", () => {
    const view = toolApprovalView(
      tool({ type: "blob", sha256: "a".repeat(64), size: 9_000_000, mediaType: null }),
    );
    expect(view.argsStored).toBe(true);
    expect(view.argsText).toBeNull();
  });

  test("long args are clipped and marked", () => {
    const view = toolApprovalView(tool({ command: "x", note: "n".repeat(10_000) }));
    expect(view.argsTruncated).toBe(true);
    expect(view.argsText?.length).toBe(4000);
  });
});

const single: QuestionItem = {
  id: "q1",
  text: "Which?",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  multiSelect: false,
  allowFreeText: false,
};
const multi: QuestionItem = { ...single, id: "q2", multiSelect: true };
const free: QuestionItem = {
  id: "q3",
  text: "Why?",
  options: [],
  multiSelect: false,
  allowFreeText: true,
};
const both: QuestionItem = { ...single, id: "q4", allowFreeText: true };

describe("question answers", () => {
  test("is incomplete until every question has a selection or text", () => {
    expect(answerOf([single, free], {})).toBeNull();
    const half = togglePick({}, single, "a");
    expect(answerOf([single, free], half)).toBeNull();
    const full = setPickText(half, "q3", "because");
    expect(answerOf([single, free], full)).toEqual({
      q1: { selected: ["a"] },
      q3: { selected: [], text: "because" },
    });
  });

  test("single select replaces the choice and clicking it again clears it", () => {
    let draft: QuestionDraft = togglePick({}, single, "a");
    draft = togglePick(draft, single, "b");
    expect(answerOf([single], draft)).toEqual({ q1: { selected: ["b"] } });
    draft = togglePick(draft, single, "b");
    expect(answerOf([single], draft)).toBeNull();
  });

  test("multi select toggles and keeps the pick order", () => {
    let draft: QuestionDraft = togglePick({}, multi, "b");
    draft = togglePick(draft, multi, "a");
    expect(answerOf([multi], draft)).toEqual({ q2: { selected: ["b", "a"] } });
    draft = togglePick(draft, multi, "b");
    expect(answerOf([multi], draft)).toEqual({ q2: { selected: ["a"] } });
  });

  test("free text is dropped for questions that do not allow it", () => {
    const draft = setPickText(togglePick({}, single, "a"), "q1", "extra");
    expect(answerOf([single], draft)).toEqual({ q1: { selected: ["a"] } });
    // 자유 입력만 있고 허용되지 않으면 빈 답이다
    expect(answerOf([single], setPickText({}, "q1", "only text"))).toBeNull();
  });

  test("an option plus free text sends both; blank text counts as none", () => {
    const withText = setPickText(togglePick({}, both, "a"), "q4", "  note  ");
    expect(answerOf([both], withText)).toEqual({ q4: { selected: ["a"], text: "note" } });
    expect(answerOf([both], setPickText({}, "q4", "   "))).toBeNull();
  });

  test("text over the service limit is not sent", () => {
    expect(answerOf([free], setPickText({}, "q3", "x".repeat(8193)))).toBeNull();
  });
});

const replaceBody = (args: ToolApprovalBody["args"], risk = "write"): ToolApprovalBody => ({
  toolName: "tool_replace",
  risk,
  args,
  argsHash: "h",
  ruleId: "tools.replace",
});

describe("toolReplaceView", () => {
  test("reads the extension, the tool, the trust and both risks from the approval args", () => {
    const view = toolReplaceView(
      replaceBody({
        tool: "write",
        extension: "safe-write",
        owner: "ext.safe-write",
        trust: "project",
        originalRisk: "write",
        effectiveRisk: "execute",
        notice: "Built-in file path protection runs inside the built-in tool.",
      }),
    );
    expect(view).toEqual({
      tool: "write",
      extension: "safe-write",
      trust: "project",
      originalRisk: "write",
      effectiveRisk: "execute",
      hasNotice: true,
    });
  });

  test("an unknown trust drops the trust line, and a missing risk falls back to the request risk", () => {
    const view = toolReplaceView(
      replaceBody({ tool: "edit", extension: "x", trust: "root" }, "execute"),
    );
    expect(view).toEqual({
      tool: "edit",
      extension: "x",
      trust: null,
      originalRisk: "execute",
      effectiveRisk: "execute",
      hasNotice: false,
    });
  });

  test("another tool, a missing tool or extension, and a stored blob are not replacement cards", () => {
    expect(toolReplaceView(tool({ tool: "write", extension: "x" }))).toBeNull();
    expect(toolReplaceView(replaceBody({ extension: "x" }))).toBeNull();
    expect(toolReplaceView(replaceBody({ tool: "write", extension: "" }))).toBeNull();
    expect(toolReplaceView(replaceBody({ type: "blob", sha256: "ab" }))).toBeNull();
  });
});

const startBody = (args: ToolApprovalBody["args"], toolName = "mcp_start"): ToolApprovalBody => ({
  toolName,
  risk: "exec",
  args,
  argsHash: "h",
  ruleId: "mcp.start",
});

const START_ARGS = {
  server: "gh",
  source: "settings:user",
  command: "gh-mcp",
  args: ["--stdio"],
  cwd: null,
  envNames: ["LOG_LEVEL"],
  secretEnv: { GITHUB_TOKEN: "secret://gh-token" },
  definitionHash: "h",
};

describe("mcpStartViewOf", () => {
  test("shows the full command line with its args, the source, the folder, the env names and the secret handles", () => {
    expect(
      mcpStartViewOf(
        startBody({
          ...START_ARGS,
          args: ["--stdio", "--note=it's here"],
          cwd: "/srv/gh",
        }),
      ),
    ).toEqual({
      server: "gh",
      reason: "secret",
      source: { kind: "user" },
      commandLine: "gh-mcp --stdio '--note=it'\\''s here'",
      cwd: "/srv/gh",
      envNames: ["LOG_LEVEL"],
      secrets: [{ name: "GITHUB_TOKEN", handle: "secret://gh-token" }],
      changed: null,
    });
  });

  test("a project command without secrets is asked because the project defines it", () => {
    expect(
      mcpStartViewOf(
        startBody({
          ...START_ARGS,
          source: "mcpjson:project",
          command: "node-srv",
          args: [],
          envNames: [],
          secretEnv: {},
        }),
      ),
    ).toEqual({
      server: "gh",
      reason: "project",
      source: { kind: "project" },
      commandLine: "node-srv",
      cwd: null,
      envNames: [],
      secrets: [],
      changed: null,
    });
    expect(mcpStartViewOf(startBody({ ...START_ARGS, secretEnv: {}, envNames: [] }))?.reason).toBe(
      "other",
    );
  });

  test("a changed record keeps the known fields in the fixed order and the previous command line", () => {
    const view = mcpStartViewOf(
      startBody({
        ...START_ARGS,
        command: "gh-mcp-next",
        changed: {
          fields: ["secretEnv", "command", "env"],
          before: { command: "gh-mcp-old", args: ["--stdio", "a b"], cwd: "/old" },
        },
      }),
    );
    expect(view?.changed).toEqual({
      fields: ["command", "env", "secretEnv"],
      beforeCommandLine: "gh-mcp-old --stdio 'a b'",
    });
  });

  test("an unknown changed field is dropped and a malformed changed record gives no changed view", () => {
    expect(
      mcpStartViewOf(
        startBody({
          ...START_ARGS,
          changed: { fields: ["command", "bogus"], before: { command: "x", args: [], cwd: null } },
        }),
      )?.changed,
    ).toEqual({ fields: ["command"], beforeCommandLine: "x" });
    expect(mcpStartViewOf(startBody({ ...START_ARGS, changed: "yes" }))?.changed).toBeNull();
  });

  test("another tool, a stored blob, a missing server and a non-list args have no start view", () => {
    expect(mcpStartViewOf(startBody(START_ARGS, "bash"))).toBeNull();
    expect(
      mcpStartViewOf(startBody({ type: "blob", sha256: "a".repeat(64), size: 1, mediaType: null })),
    ).toBeNull();
    expect(mcpStartViewOf(startBody({ ...START_ARGS, server: "" }))).toBeNull();
    expect(mcpStartViewOf(startBody({ ...START_ARGS, args: "--stdio" }))).toBeNull();
  });
});

describe("mcp start source and shell words", () => {
  test("the known sources read as words, an extension shows its name, and anything else stays as written", () => {
    expect(mcpSourceViewOf("mcpjson:project")).toEqual({ kind: "project" });
    expect(mcpSourceViewOf("settings:user")).toEqual({ kind: "user" });
    expect(mcpSourceViewOf("ext:github")).toEqual({ kind: "extension", name: "github" });
    expect(mcpSourceViewOf("ext:")).toEqual({ kind: "raw", value: "ext:" });
    expect(mcpSourceViewOf("plugin:x")).toEqual({ kind: "raw", value: "plugin:x" });
  });

  test("a plain word stays bare, and an empty or spaced word is single-quoted", () => {
    expect(shellWordOf("/usr/bin/node")).toBe("/usr/bin/node");
    expect(shellWordOf("--port=3000")).toBe("--port=3000");
    expect(shellWordOf("")).toBe("''");
    expect(shellWordOf("a b")).toBe("'a b'");
    expect(shellLineOf("gh-mcp", ["--stdio", "", "x y"])).toBe("gh-mcp --stdio '' 'x y'");
  });
});

const removed = (from: number, to: number, prefix = "o"): FileChangeRow[] =>
  Array.from({ length: to - from + 1 }, (_, index): FileChangeRow => ({
    kind: "remove",
    text: `${prefix}${from + index}`,
  }));
const added = (from: number, to: number, prefix = "n"): FileChangeRow[] =>
  Array.from({ length: to - from + 1 }, (_, index): FileChangeRow => ({
    kind: "add",
    text: `${prefix}${from + index}`,
  }));
const numbered = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => `${prefix}${from + index}`);

function edit(args: ToolApprovalBody["args"]): FileChangeView | null {
  return fileChangeViewOf(fileTool("edit", args));
}

describe("fileChangeViewOfArgs", () => {
  test("an edit call's args give the view the approval card draws for the same call", () => {
    const args = { path: "a.ts", edits: [{ oldText: "x = 1", newText: "x = 2" }] };
    expect(fileChangeViewOfArgs("edit", args)).toEqual({
      kind: "edit",
      path: "a.ts",
      head: [
        { kind: "remove", text: "x = 1" },
        { kind: "add", text: "x = 2" },
      ],
      rest: [],
    });
    expect(fileChangeViewOfArgs("edit", args)).toEqual(fileChangeViewOf(fileTool("edit", args)));
  });

  test("a write call's args give the first forty lines of the content and count the rest", () => {
    expect(fileChangeViewOfArgs("write", { path: "n.md", content: lines(42, "r") })).toEqual({
      kind: "write",
      path: "n.md",
      head: numbered("r", 1, 40),
      hiddenLines: 2,
    });
  });

  test("another tool name has no file view even with edit-shaped args", () => {
    expect(
      fileChangeViewOfArgs("bash", { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] }),
    ).toBeNull();
  });

  test("args without a path, or with a broken edits or content value, have no file view", () => {
    expect(fileChangeViewOfArgs("edit", { edits: [{ oldText: "a", newText: "b" }] })).toBeNull();
    expect(fileChangeViewOfArgs("edit", { path: "a.ts", edits: "not json" })).toBeNull();
    expect(fileChangeViewOfArgs("write", { path: "a.md", content: 1 })).toBeNull();
  });
});

describe("fileChangeViewOf", () => {
  test("a single replacement shows only the changed lines, with up to two context lines around them", () => {
    expect(
      edit({
        path: "a.ts",
        edits: [{ oldText: "l1\nl2\nl3\nl4\nl5\nl6", newText: "l1\nl2\nX\nl4\nl5\nl6" }],
      }),
    ).toEqual({
      kind: "edit",
      path: "a.ts",
      head: [
        { kind: "context", text: "l1" },
        { kind: "context", text: "l2" },
        { kind: "remove", text: "l3" },
        { kind: "add", text: "X" },
        { kind: "context", text: "l4" },
        { kind: "context", text: "l5" },
      ],
      rest: [],
    });
  });

  test("a multi-line change drops the common leading and trailing lines", () => {
    expect(
      edit({
        path: "b.ts",
        edits: [{ oldText: "a\nb\nc\nd\ne\nf\ng\nh", newText: "a\nb\nc\nX\nY\nf\ng\nh" }],
      }),
    ).toEqual({
      kind: "edit",
      path: "b.ts",
      head: [
        { kind: "context", text: "b" },
        { kind: "context", text: "c" },
        { kind: "remove", text: "d" },
        { kind: "remove", text: "e" },
        { kind: "add", text: "X" },
        { kind: "add", text: "Y" },
        { kind: "context", text: "f" },
        { kind: "context", text: "g" },
      ],
      rest: [],
    });
  });

  test("edits given as a JSON string are read like an edits list", () => {
    const view = edit({ path: "c.ts", edits: '[{"oldText":"x = 1","newText":"x = 2"}]' });
    expect(view).toEqual({
      kind: "edit",
      path: "c.ts",
      head: [
        { kind: "remove", text: "x = 1" },
        { kind: "add", text: "x = 2" },
      ],
      rest: [],
    });
  });

  test("a top-level oldText and newText pair is one replacement, and an edits list wins over it", () => {
    expect(edit({ path: "d.ts", oldText: "x = 1", newText: "x = 2" })).toEqual({
      kind: "edit",
      path: "d.ts",
      head: [
        { kind: "remove", text: "x = 1" },
        { kind: "add", text: "x = 2" },
      ],
      rest: [],
    });
    expect(
      edit({
        path: "d.ts",
        edits: [{ oldText: "a", newText: "b" }],
        oldText: "x",
        newText: "y",
      }),
    ).toEqual({
      kind: "edit",
      path: "d.ts",
      head: [
        { kind: "remove", text: "a" },
        { kind: "add", text: "b" },
      ],
      rest: [],
    });
  });

  test("each replacement adds its own changed lines, a trailing newline is not a line, and a no-op replacement adds none", () => {
    expect(
      edit({
        path: "e.ts",
        edits: [
          { oldText: "a\n", newText: "b\n" },
          { oldText: "c", newText: "" },
          { oldText: "same", newText: "same" },
        ],
      }),
    ).toEqual({
      kind: "edit",
      path: "e.ts",
      head: [
        { kind: "remove", text: "a" },
        { kind: "add", text: "b" },
        { kind: "remove", text: "c" },
      ],
      rest: [],
    });
  });

  test("a diff longer than thirty rows keeps thirty rows in the head and folds the rest", () => {
    const view = edit({
      path: "big.ts",
      edits: [{ oldText: lines(40, "o"), newText: lines(40, "n") }],
    });
    expect(view).toEqual({
      kind: "edit",
      path: "big.ts",
      head: removed(1, 30),
      rest: [...removed(31, 40), ...added(1, 40)],
    });
  });

  test("a write shows the first forty lines of its content and counts the rest", () => {
    expect(
      fileChangeViewOf(fileTool("write", { path: "notes.md", content: lines(45, "r") })),
    ).toEqual({ kind: "write", path: "notes.md", head: numbered("r", 1, 40), hiddenLines: 5 });
    expect(fileChangeViewOf(fileTool("write", { path: "short.txt", content: "a\nb\n" }))).toEqual({
      kind: "write",
      path: "short.txt",
      head: ["a", "b"],
      hiddenLines: 0,
    });
  });

  test("a call whose args do not have the expected shape has no file view", () => {
    expect(edit({ path: "a.ts", edits: "not json" })).toBeNull();
    expect(edit({ path: "a.ts", edits: "42" })).toBeNull();
    expect(edit({ path: "a.ts", edits: 3 })).toBeNull();
    expect(
      edit({ path: "a.ts", edits: [{ oldText: "a", newText: "b" }, { oldText: "c" }] }),
    ).toBeNull();
    expect(edit({ path: "a.ts" })).toBeNull();
    expect(edit({ path: "a.ts", edits: [] })).toBeNull();
    expect(edit({ edits: [{ oldText: "a", newText: "b" }] })).toBeNull();
    expect(edit({ path: "   ", edits: [{ oldText: "a", newText: "b" }] })).toBeNull();
    expect(fileChangeViewOf(fileTool("write", { path: "a.md" }))).toBeNull();
    expect(fileChangeViewOf(fileTool("write", { path: "a.md", content: 1 }))).toBeNull();
    expect(fileChangeViewOf(fileTool("write", { content: "x" }))).toBeNull();
  });

  test("another tool, and a stored blob, have no file view", () => {
    expect(
      fileChangeViewOf(tool({ path: "a.ts", edits: [{ oldText: "a", newText: "b" }] })),
    ).toBeNull();
    expect(
      edit({ type: "blob", sha256: "a".repeat(64), size: 9_000_000, mediaType: null }),
    ).toBeNull();
    expect(
      fileChangeViewOf(
        fileTool("write", {
          type: "blob",
          sha256: "a".repeat(64),
          size: 9_000_000,
          mediaType: null,
        }),
      ),
    ).toBeNull();
  });
});

/** MCP 서버 도구의 승인 본문. 서버 정보는 `mcp`로 넘긴다 */
function mcpTool(mcp?: ToolApprovalBody["mcp"]): ToolApprovalBody {
  return {
    toolName: "echo",
    risk: "exec",
    args: { text: "hi" },
    argsHash: "h",
    ruleId: "mcp.default",
    ...(mcp === undefined ? {} : { mcp }),
  };
}

describe("mcpToolViewOf", () => {
  test("an ordinary tool or a body from before the server name existed has no MCP view", () => {
    expect(mcpToolViewOf(tool({ command: "ls" }))).toBeNull();
  });

  test("the server name is kept, and only the traits the server declared true are listed, in screen order", () => {
    expect(
      mcpToolViewOf(
        mcpTool({
          server: "qa",
          declared: {
            openWorldHint: true,
            destructiveHint: true,
            readOnlyHint: true,
            idempotentHint: false,
          },
        }),
      ),
    ).toEqual({ server: "qa", declared: ["readOnly", "destructive", "openWorld"] });
  });

  test("a server that declares nothing, or only false traits, has the name and an empty list", () => {
    expect(mcpToolViewOf(mcpTool({ server: "qa" }))).toEqual({ server: "qa", declared: [] });
    expect(mcpToolViewOf(mcpTool({ server: "qa", declared: { readOnlyHint: false } }))).toEqual({
      server: "qa",
      declared: [],
    });
  });
});
