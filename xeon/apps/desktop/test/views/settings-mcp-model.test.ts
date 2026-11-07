import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { McpDefinitionView, McpServerRow, McpToolRow } from "@fresnel/contracts/wire";
import {
  argsOfText,
  blockActionOf,
  defOfDraft,
  draftOfDefinition,
  failureKeyOf,
  firstLineOf,
  hiddenLineOf,
  hiddenReasonKindOf,
  mcpDefOfView,
  nameOf,
  newFailuresOf,
  plaintextSecretOf,
  rowModelOf,
  sourceChipOf,
  tableWithServer,
  userTableOf,
  withPairAdded,
  withPairChanged,
  withPairRemoved,
  withRowReplaced,
  type DraftIssue,
  type McpDraft,
  type PairRow,
  type UserTable,
} from "../../src/views/pages/settings/settings-mcp-model.ts";

// "MCP 서버" 구역의 순수 모델 시험. 행 모델, 출처와 숨은 도구, 실패 알림, 폼 초안과 서버 정의의 왕복, 사용자 표 재조립을 값으로 비교한다.

/** 행 하나. 필수 칸만 채우고 나머지는 덮어쓴다 */
function rowOf(overrides: Partial<McpServerRow>): McpServerRow {
  return {
    server: "files",
    source: "settings:user",
    origin: "settings",
    state: "connected",
    transport: "stdio",
    toolCount: 0,
    tools: [],
    alwaysBlocked: false,
    editable: true,
    ...overrides,
  };
}

function toolOf(overrides: Partial<McpToolRow>): McpToolRow {
  return { name: "read_file", exposed: true, ...overrides };
}

const STDIO_VIEW: McpDefinitionView = {
  transport: "stdio",
  title: "Files",
  command: "npx",
  args: ["-y", "@fresnel/files"],
  env: { FILES_ROOT: "/work", API_TOKEN: "secret://api-token" },
  enabled: false,
  tools: { deny: ["write"], approval: { read: "auto" } },
  timeouts: { callMs: 5000 },
  trustAnnotations: true,
};

const HTTP_VIEW: McpDefinitionView = {
  transport: "http",
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: "secret://mcp-auth" },
  oauth: true,
  sandbox: false,
};

const LOCALE = "en-US";

describe("sourceChipOf and nameOf", () => {
  test("the chip follows the origin, and an extension chip carries the name after ext:", () => {
    expect(sourceChipOf({ origin: "mcpjson", source: "mcpjson:project" })).toEqual({
      kind: "mcpjson",
    });
    expect(sourceChipOf({ origin: "settings", source: "settings:user" })).toEqual({
      kind: "settings",
    });
    expect(sourceChipOf({ origin: "extension", source: "ext:helm" })).toEqual({
      kind: "extension",
      name: "helm",
    });
  });

  test("the name is the title when there is one, the id otherwise", () => {
    expect(nameOf({ server: "files", title: "Files" })).toEqual("Files");
    expect(nameOf({ server: "files" })).toEqual("files");
    expect(nameOf({ server: "files", title: "" })).toEqual("files");
  });
});

describe("hidden tools", () => {
  test("each hidden reason is one of the known kinds, and an unknown one is other", () => {
    expect(hiddenReasonKindOf("name_conflict")).toEqual("name_conflict");
    expect(hiddenReasonKindOf("denied")).toEqual("denied");
    expect(hiddenReasonKindOf("hidden")).toEqual("other");
  });

  test("the line counts every hidden tool and lists each reason once, in the order they came", () => {
    expect(
      hiddenLineOf([
        { name: "a", reason: "name_conflict" },
        { name: "b", reason: "name_conflict" },
        { name: "c", reason: "denied" },
      ]),
    ).toEqual({ count: 3, reasons: ["name_conflict", "denied"] });
  });

  test("no hidden tools means no line", () => {
    expect(hiddenLineOf(undefined)).toBeNull();
    expect(hiddenLineOf([])).toBeNull();
  });
});

describe("rowModelOf", () => {
  test("an approval wait shows the approval note, and the title comes with the id", () => {
    const model = rowModelOf(
      rowOf({
        title: "Files",
        state: "blocked",
        blockedReason: "approval_required",
      }),
      LOCALE,
    );
    expect(model.name).toEqual("Files");
    expect(model.idText).toEqual("files");
    expect(model.blocked).toEqual("approval_required");
    expect(model.approvalNote).toBe(true);
    expect(model.locationNote).toBeNull();
  });

  test("a row from .mcp.json or an extension says where to edit it, and a settings row does not", () => {
    expect(
      rowModelOf(rowOf({ origin: "mcpjson", source: "mcpjson:project", editable: false }), LOCALE)
        .locationNote,
    ).toEqual("mcpjson");
    const extension = rowModelOf(
      rowOf({ origin: "extension", source: "ext:helm", editable: false }),
      LOCALE,
    );
    expect(extension.locationNote).toEqual("extension");
    expect(extension.source).toEqual({ kind: "extension", name: "helm" });
    expect(rowModelOf(rowOf({}), LOCALE).locationNote).toBeNull();
  });

  test("the last error keeps its message and a time text in the locale", () => {
    const model = rowModelOf(
      rowOf({
        state: "failed",
        lastError: { code: "spawn_failed", message: "spawn failed", at: 0 },
      }),
      LOCALE,
    );
    expect(model.error).toEqual({
      message: "spawn failed",
      time: new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(0),
      ),
    });
  });

  test("the hidden line and the stderr tail come from the row", () => {
    const model = rowModelOf(
      rowOf({
        state: "failed",
        hiddenTools: [
          { name: "a", reason: "name_conflict" },
          { name: "b", reason: "name_conflict" },
        ],
        stderrTail: ["boot failed"],
        tools: [toolOf({ name: "read_file" })],
      }),
      LOCALE,
    );
    expect(model.hidden).toEqual({ count: 2, reasons: ["name_conflict"] });
    expect(model.stderr).toEqual(["boot failed"]);
    expect(model.tools.map((tool) => tool.name)).toEqual(["read_file"]);
  });

  test("the block action is unblock for an always-blocked server and block otherwise", () => {
    expect(blockActionOf({ alwaysBlocked: true })).toEqual("unblock");
    expect(blockActionOf({ alwaysBlocked: false })).toEqual("blockAlways");
  });
});

describe("failure notices", () => {
  const failed = rowOf({
    title: "Files",
    state: "failed",
    lastError: { code: "spawn_failed", message: "spawn failed\nmore detail", at: 5 },
  });

  test("a failed server gives one notice with its name and the first line of the error", () => {
    expect(newFailuresOf([failed, rowOf({ server: "web" })], new Set())).toEqual([
      { key: failureKeyOf("files", 5), server: "files", name: "Files", reason: "spawn failed" },
    ]);
  });

  test("the same server with the same error time is not announced again", () => {
    expect(newFailuresOf([failed], new Set([failureKeyOf("files", 5)]))).toEqual([]);
  });

  test("a new error time for the same server is a new failure", () => {
    const later = rowOf({
      title: "Files",
      state: "failed",
      lastError: { code: "spawn_failed", message: "again", at: 6 },
    });
    expect(newFailuresOf([later], new Set([failureKeyOf("files", 5)]))).toEqual([
      { key: failureKeyOf("files", 6), server: "files", name: "Files", reason: "again" },
    ]);
  });

  test("a failed row without an error time gives no notice, and firstLineOf takes the first line", () => {
    expect(newFailuresOf([rowOf({ state: "failed" })], new Set())).toEqual([]);
    expect(firstLineOf("  first \nsecond")).toEqual("first");
  });
});

describe("definition shape", () => {
  test("a flat stdio definition becomes the stored shape with the transport nested", () => {
    expect(mcpDefOfView(STDIO_VIEW)).toEqual({
      title: "Files",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@fresnel/files"],
        env: { FILES_ROOT: "/work", API_TOKEN: "secret://api-token" },
      },
      enabled: false,
      tools: { deny: ["write"], approval: { read: "auto" } },
      timeouts: { callMs: 5000 },
      trustAnnotations: true,
    });
  });

  test("an http definition keeps its headers and oauth on the transport", () => {
    expect(mcpDefOfView(HTTP_VIEW)).toEqual({
      transport: {
        type: "http",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "secret://mcp-auth" },
        oauth: true,
      },
      sandbox: false,
    });
  });

  test("a stdio definition goes through the form and back unchanged", () => {
    const base = mcpDefOfView(STDIO_VIEW);
    const draft = draftOfDefinition("files", STDIO_VIEW);
    expect(defOfDraft(draft, { base, taken: [] })).toEqual(ok({ id: "files", def: base }));
  });

  test("an http definition goes through the form and back unchanged", () => {
    const base = mcpDefOfView(HTTP_VIEW);
    const draft = draftOfDefinition("remote", HTTP_VIEW);
    expect(defOfDraft(draft, { base, taken: [] })).toEqual(ok({ id: "remote", def: base }));
  });

  test("switching the transport drops the fields of the old transport and keeps the rest", () => {
    const base = mcpDefOfView(HTTP_VIEW);
    const draft: McpDraft = { ...draftOfDefinition("remote", HTTP_VIEW), transport: "sse" };
    const checked = defOfDraft(draft, { base, taken: [] });
    expect(checked).toEqual(
      ok({
        id: "remote",
        def: {
          transport: {
            type: "sse",
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "secret://mcp-auth" },
          },
          sandbox: false,
        },
      }),
    );
  });
});

/** 검사를 통과하는 초안 하나. 시험마다 한 칸만 바꾼다 */
const BASE_DRAFT: McpDraft = {
  id: "files",
  title: "",
  transport: "stdio",
  command: "npx",
  args: "",
  env: [],
  url: "",
  headers: [],
};

/** 초안을 검사한 결과 문제 이름, 또는 통과하면 "ok" */
function issueOf(draft: McpDraft, taken: readonly string[] = []): DraftIssue | "ok" {
  const checked = defOfDraft(draft, { base: null, taken });
  return checked.ok ? "ok" : checked.error;
}

/** 환경 변수 한 줄짜리 행 목록 */
function envOf(name: string): PairRow[] {
  return [{ uid: 0, name, value: "v" }];
}

/** 기본 초안에 환경 변수 한 줄을 더한 것 */
function withEnv(name: string, value: string): McpDraft {
  return { ...BASE_DRAFT, env: [{ uid: 0, name, value }] };
}

describe("draft validation", () => {
  const base = BASE_DRAFT;

  test("the id must match the server id pattern and must not be taken by another row", () => {
    expect(issueOf({ ...base, id: "Files" })).toEqual("id");
    expect(issueOf({ ...base, id: "1files" })).toEqual("id");
    expect(issueOf({ ...base, id: "files-" + "a".repeat(40) })).toEqual("id");
    expect(issueOf(base, ["files"])).toEqual("idTaken");
    expect(issueOf(base, ["other"])).toEqual("ok");
  });

  test("a stdio server needs a command, and an http or sse server needs an http or https URL", () => {
    expect(issueOf({ ...base, command: "   " })).toEqual("command");
    expect(issueOf({ ...base, transport: "http", url: "ftp://x" })).toEqual("url");
    expect(issueOf({ ...base, transport: "sse", url: "https://ok.example.com/sse" })).toEqual("ok");
  });

  test("environment names and headers follow their patterns, and a repeated name is refused", () => {
    expect(issueOf({ ...base, env: envOf("1BAD") })).toEqual("envName");
    expect(issueOf({ ...base, env: envOf("GOOD_NAME") })).toEqual("ok");
    expect(
      issueOf({
        ...base,
        env: [
          { uid: 0, name: "A", value: "1" },
          { uid: 1, name: "A", value: "2" },
        ],
      }),
    ).toEqual("envDuplicate");
    expect(
      issueOf({
        ...base,
        transport: "http",
        url: "https://x.example.com",
        headers: [{ uid: 0, name: "bad header", value: "v" }],
      }),
    ).toEqual("headerName");
  });

  test("a title over 80 characters is refused, and a blank environment row is skipped", () => {
    expect(issueOf({ ...base, title: "x".repeat(81) })).toEqual("title");
    expect(issueOf({ ...base, env: [{ uid: 0, name: "", value: "" }] })).toEqual("ok");
  });

  test("a plaintext value under a secret-looking name is flagged, a secret reference is not", () => {
    expect(plaintextSecretOf(withEnv("API_TOKEN", "plain-value"))).toBe(true);
    expect(plaintextSecretOf(withEnv("api_key", "plain-value"))).toBe(true);
    expect(plaintextSecretOf(withEnv("API_TOKEN", "secret://api-token"))).toBe(false);
    expect(plaintextSecretOf(withEnv("FILES_ROOT", "/work"))).toBe(false);
  });

  test("args are one per line and blank lines are dropped", () => {
    expect(argsOfText("a\n\n  b \r\n")).toEqual(["a", "  b "]);
  });
});

describe("the user table", () => {
  const TABLE = {
    fs: { transport: { type: "stdio", command: "npx" } },
    web: { transport: { type: "sse", url: "https://x.example.com" } },
  };

  test("an empty file or one without the key is an empty table, a non-object is unreadable, a non-object table is invalid", () => {
    expect(userTableOf("")).toEqual(ok({}));
    expect(userTableOf('{"other": 1}')).toEqual(ok({}));
    expect(userTableOf("[]")).toEqual(err("unreadable"));
    expect(userTableOf("not json")).toEqual(err("unreadable"));
    expect(userTableOf('{"l2.mcp.servers": 5}')).toEqual(err("invalid"));
  });

  test("the table is read from the key and the other keys are not part of it", () => {
    expect(userTableOf(JSON.stringify({ "l2.mcp.servers": TABLE, other: 1 }))).toEqual(ok(TABLE));
  });

  test("changing one server keeps the others, in their order, and a new one goes last", () => {
    const table: UserTable = { a: 1, b: 2, c: 3 };
    const replaced = tableWithServer(table, {
      previousId: "b",
      id: "b",
      def: { transport: { type: "stdio", command: "node" } },
    });
    expect(Object.keys(replaced)).toEqual(["a", "b", "c"]);
    expect(replaced).toEqual({ a: 1, b: { transport: { type: "stdio", command: "node" } }, c: 3 });

    const removed = tableWithServer(table, { previousId: "b", id: "b", def: null });
    expect(removed).toEqual({ a: 1, c: 3 });

    const added = tableWithServer(table, {
      previousId: null,
      id: "d",
      def: { transport: { type: "stdio", command: "node" } },
    });
    expect(Object.keys(added)).toEqual(["a", "b", "c", "d"]);
  });

  test("a rename puts the new id where the old one was", () => {
    const renamed = tableWithServer(
      { a: 1, b: 2, c: 3 },
      {
        previousId: "b",
        id: "bb",
        def: { transport: { type: "stdio", command: "node" } },
      },
    );
    expect(Object.keys(renamed)).toEqual(["a", "bb", "c"]);
  });
});

describe("pair rows", () => {
  test("add, change and remove keep the other rows", () => {
    const added = withPairAdded([]);
    expect(added).toEqual([{ uid: 0, name: "", value: "" }]);
    const twice = withPairAdded(added);
    expect(twice.map((row) => row.uid)).toEqual([0, 1]);
    const changed = withPairChanged(twice, 1, { name: "X" });
    expect(changed).toEqual([
      { uid: 0, name: "", value: "" },
      { uid: 1, name: "X", value: "" },
    ]);
    expect(withPairRemoved(changed, 0)).toEqual([{ uid: 1, name: "X", value: "" }]);
  });

  test("replacing a row by server id keeps the list order", () => {
    const rows = [rowOf({ server: "a" }), rowOf({ server: "b" })];
    expect(
      withRowReplaced(rows, rowOf({ server: "b", toolCount: 4 })).map((row) => row.toolCount),
    ).toEqual([0, 4]);
  });
});
