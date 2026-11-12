import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { McpServerRow } from "@fresnel/contracts/wire";
import { EMPTY_DRAFT } from "../../src/views/pages/settings/settings-mcp-model.ts";
import {
  draftsOfPaste,
  freeIdOf,
  serverIdOf,
  shellWordsOf,
} from "../../src/views/pages/settings/settings-mcp-paste.ts";
import {
  TEST_DEADLINE_MS,
  dotToneOf,
  settledOf,
  testStepsOf,
} from "../../src/views/pages/settings/settings-mcp-test.ts";

// MCP 서버 붙여 넣기와 연결 시험(DP-111)의 순수 모델. 값은 `toEqual`로 비교한다.

describe("draftsOfPaste: command lines", () => {
  test("an npx line names the server after the package and keeps each argument", () => {
    expect(draftsOfPaste("npx -y @modelcontextprotocol/server-github")).toEqual({
      ok: true,
      value: [
        {
          ...EMPTY_DRAFT,
          id: "github",
          command: "npx",
          args: "-y\n@modelcontextprotocol/server-github",
        },
      ],
    });
  });

  test("env prefixes become env rows, and quotes keep spaces in one argument", () => {
    const result = draftsOfPaste(`GITHUB_TOKEN=abc uvx mcp-server-fetch --root "/my docs"`);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          ...EMPTY_DRAFT,
          id: "fetch",
          command: "uvx",
          args: "mcp-server-fetch\n--root\n/my docs",
          env: [{ uid: 0, name: "GITHUB_TOKEN", value: "abc" }],
        },
      ],
    });
  });

  test("claude mcp add reads name, env, transport, headers and the part after --", () => {
    expect(draftsOfPaste("claude mcp add -s user -e API_KEY=k docs -- npx -y docs-mcp")).toEqual({
      ok: true,
      value: [
        {
          ...EMPTY_DRAFT,
          id: "docs",
          command: "npx",
          args: "-y\ndocs-mcp",
          env: [{ uid: 0, name: "API_KEY", value: "k" }],
        },
      ],
    });
    expect(
      draftsOfPaste(
        'claude mcp add --transport http linear https://mcp.linear.app/mcp -H "Authorization: Bearer x"',
      ),
    ).toEqual({
      ok: true,
      value: [
        {
          ...EMPTY_DRAFT,
          id: "linear",
          transport: "http",
          url: "https://mcp.linear.app/mcp",
          headers: [{ uid: 0, name: "Authorization", value: "Bearer x" }],
        },
      ],
    });
  });

  test("bun with a script names the server after the script", () => {
    expect(draftsOfPaste("bun ./tools/mcp-notes-server.ts")).toEqual({
      ok: true,
      value: [{ ...EMPTY_DRAFT, id: "notes", command: "bun", args: "./tools/mcp-notes-server.ts" }],
    });
  });

  test("a bare URL is an http server named after the site", () => {
    expect(draftsOfPaste("https://mcp.notion.com/mcp")).toEqual({
      ok: true,
      value: [
        { ...EMPTY_DRAFT, id: "notion", transport: "http", url: "https://mcp.notion.com/mcp" },
      ],
    });
  });
});

describe("draftsOfPaste: JSON", () => {
  test("an mcpServers table gives one draft per server, in order", () => {
    const text = JSON.stringify({
      mcpServers: {
        fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
        remote: { type: "sse", url: "https://x.example.com/sse", headers: { "X-Key": "v" } },
      },
    });
    expect(draftsOfPaste(text)).toEqual({
      ok: true,
      value: [
        {
          ...EMPTY_DRAFT,
          id: "fs",
          command: "npx",
          args: "-y\n@modelcontextprotocol/server-filesystem\n/tmp",
        },
        {
          ...EMPTY_DRAFT,
          id: "remote",
          transport: "sse",
          url: "https://x.example.com/sse",
          headers: [{ uid: 0, name: "X-Key", value: "v" }],
        },
      ],
    });
  });

  test('a copied `"name": {…}` fragment is read too', () => {
    expect(draftsOfPaste('"memory": { "command": "npx", "args": ["mcp-memory"] },')).toEqual({
      ok: true,
      value: [{ ...EMPTY_DRAFT, id: "memory", command: "npx", args: "mcp-memory" }],
    });
  });

  test("empty text, broken JSON, JSON without a server, and prose are refused", () => {
    expect(draftsOfPaste("  ")).toEqual({ ok: false, error: "empty" });
    expect(draftsOfPaste('{"mcpServers": {')).toEqual({ ok: false, error: "json" });
    expect(draftsOfPaste('{"theme": "dark"}')).toEqual({ ok: false, error: "noServer" });
    expect(draftsOfPaste("FOO=1")).toEqual({ ok: false, error: "unknown" });
  });
});

describe("ids and words", () => {
  test("a name is fitted to the id rule", () => {
    expect(serverIdOf("My Server_2")).toBe("my-server-2");
    expect(serverIdOf("123")).toBe("");
    expect(serverIdOf("x".repeat(40))).toBe("x".repeat(32));
  });

  test("a taken id is numbered", () => {
    expect(freeIdOf("github", ["github", "github-2"])).toBe("github-3");
    expect(freeIdOf("fs", [])).toBe("fs");
  });

  test("shell words honour quotes and escapes", () => {
    expect(shellWordsOf(`a 'b c' "d \\"e\\"" f\\ g`)).toEqual(["a", "b c", 'd "e"', "f g"]);
    expect(shellWordsOf(`x ""`)).toEqual(["x", ""]);
  });
});

function serverRow(over: Partial<McpServerRow> = {}): McpServerRow {
  return {
    server: "files",
    source: "settings:user",
    origin: "settings",
    state: "connecting",
    transport: "stdio",
    toolCount: 0,
    tools: [],
    alwaysBlocked: false,
    editable: true,
    ...over,
  };
}

describe("connection test steps", () => {
  const base = { saveMs: 12, elapsedMs: 800, timedOut: false };

  test("while connecting the start step runs and the tool step waits", () => {
    const steps = testStepsOf({ ...base, row: serverRow() });
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ["save", "passed"],
      ["start", "running"],
      ["tools", "waiting"],
    ]);
    expect(settledOf(serverRow())).toBe(false);
    expect(settledOf(undefined)).toBe(false);
  });

  test("past the deadline the start step fails with the timeout", () => {
    const steps = testStepsOf({ ...base, timedOut: true, row: undefined });
    expect(steps[1]?.state).toBe("failed");
    expect(steps[1]?.detail).toBe(
      t("desktop.settings.mcp.test.timeout", { seconds: TEST_DEADLINE_MS / 1000 }),
    );
    expect(steps[2]?.state).toBe("skipped");
  });

  test("a connected server with tools passes, with none the tool step fails", () => {
    const ok = testStepsOf({ ...base, row: serverRow({ state: "connected", toolCount: 4 }) });
    expect(ok.map((step) => step.state)).toEqual(["passed", "passed", "passed"]);
    expect(ok[2]?.detail).toBe(t("desktop.settings.mcp.tools", { count: 4 }));
    const none = testStepsOf({ ...base, row: serverRow({ state: "connected" }) });
    expect(none[2]?.state).toBe("failed");
    expect(none[2]?.fix).toBe(t("desktop.settings.mcp.test.fix.noTools"));
  });

  test("a failed stdio server shows its error and the last stderr line in the fix", () => {
    const steps = testStepsOf({
      ...base,
      row: serverRow({
        state: "failed",
        lastError: { code: "connect_failed", message: "spawn ENOENT\nmore", at: 0 },
        stderrTail: ["first", "command not found: foo"],
      }),
    });
    expect(steps[1]?.detail).toBe("spawn ENOENT");
    expect(steps[1]?.fix).toBe(
      t("desktop.settings.mcp.test.fix.stdio", { line: "command not found: foo" }),
    );
    expect(steps[2]?.state).toBe("skipped");
  });

  test("a failed stdio server without output gets the plain fix", () => {
    const steps = testStepsOf({
      ...base,
      row: serverRow({ state: "failed", lastError: { code: "x", message: "gone", at: 0 } }),
    });
    expect(steps[1]?.fix).toBe(t("desktop.settings.mcp.test.fix.stdioQuiet"));
  });

  test("dot tones follow the row state", () => {
    expect(dotToneOf({ alwaysBlocked: false, state: "connected", toolCount: 2 })).toBe("success");
    expect(dotToneOf({ alwaysBlocked: false, state: "connected", toolCount: 0 })).toBe("warning");
    expect(dotToneOf({ alwaysBlocked: false, state: "failed", toolCount: 0 })).toBe("danger");
    expect(dotToneOf({ alwaysBlocked: true, state: "failed", toolCount: 0 })).toBe("neutral");
  });
});
