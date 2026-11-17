import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { McpServerDefSchema } from "@fresnel/contracts/capabilities";
import { convertMcpEntry, mcpJsonAdapter } from "../src/adapters/mcp-json.ts";
import { DEFAULT_SCAN_LIMITS, type ScanLimits, type ScanRoot } from "../src/types.ts";
import { memoryFs, type MemoryEntry } from "./support.ts";

const HOME = "/Users/tester";
const PROJECT = `${HOME}/proj`;
const MCP_FILE = `${PROJECT}/.mcp.json`;
const USER_FILE = `${HOME}/.claude.json`;
const context = { homeDir: HOME };
const projectRoot: ScanRoot = { path: PROJECT, scope: "project", label: "proj" };
const userRoot: ScanRoot = { path: HOME, scope: "user", label: "me" };
const inProject = { projectRoot: PROJECT };
const noProject = { projectRoot: undefined };

function servers(map: unknown): string {
  return JSON.stringify({ mcpServers: map });
}

function scanProject(
  files: Readonly<Record<string, MemoryEntry>>,
  limits: ScanLimits = DEFAULT_SCAN_LIMITS,
) {
  return mcpJsonAdapter.scan(projectRoot, memoryFs(files), limits, context);
}

describe("convertMcpEntry", () => {
  test("stdio entry converts exactly and the definition passes McpServerDefSchema", () => {
    const { item, fields, warnings } = convertMcpEntry(
      "fs",
      { command: "npx", args: ["-y", "@scope/pkg"], env: { LOG_LEVEL: "debug" } },
      noProject,
    );
    expect(item).toMatchObject({
      kind: "mcp",
      serverName: "fs",
      id: "fs",
      transport: "stdio",
      projectBound: false,
      secretRefs: [],
    });
    expect(item.def).toEqual({
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@scope/pkg"],
        env: { LOG_LEVEL: "debug" },
      },
    });
    expect(fields).toEqual([]);
    expect(warnings).toEqual([]);
    expect(parse(McpServerDefSchema, item.def).ok).toBe(true);
    expect(parse(McpServerDefSchema, { transport: { type: "stdio", command: "npx" } }).ok).toBe(
      true,
    );
  });

  test("an http header with an env reference becomes a secret reference", () => {
    const { item } = convertMcpEntry(
      "api-svc",
      {
        type: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer ${API_TOKEN}" },
      },
      inProject,
    );
    expect(item.def).toEqual({
      transport: {
        type: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "secret://api-svc-api-token" },
      },
    });
    expect(item.secretRefs).toEqual([
      {
        place: "headers.Authorization",
        varName: "API_TOKEN",
        secretName: "api-svc-api-token",
        origin: "env_ref",
      },
    ]);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("${API_TOKEN}");
  });

  test("literal secrets become references and their values appear nowhere", () => {
    const http = convertMcpEntry(
      "web",
      {
        type: "http",
        url: "https://e.example.com",
        headers: { Authorization: "Bearer sk-live-abcdefghij" },
      },
      inProject,
    );
    expect(http.item.def).toEqual({
      transport: {
        type: "http",
        url: "https://e.example.com",
        headers: { Authorization: "secret://web-authorization" },
      },
    });
    expect(http.item.secretRefs).toEqual([
      {
        place: "headers.Authorization",
        varName: "Authorization",
        secretName: "web-authorization",
        origin: "literal",
      },
    ]);

    const stdio = convertMcpEntry(
      "gh",
      { command: "gh-mcp", env: { GITHUB_TOKEN: "ghp_xxxxxxxxxxxx" } },
      inProject,
    );
    expect(stdio.item.def).toEqual({
      transport: {
        type: "stdio",
        command: "gh-mcp",
        env: { GITHUB_TOKEN: "secret://gh-github-token" },
      },
    });
    expect(stdio.item.secretRefs).toEqual([
      {
        place: "env.GITHUB_TOKEN",
        varName: "GITHUB_TOKEN",
        secretName: "gh-github-token",
        origin: "literal",
      },
    ]);

    for (const result of [http, stdio]) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("sk-live");
      expect(serialized).not.toContain("ghp_");
    }
  });

  test("env defaults: a safe default is inlined, a secret-looking name or default becomes a reference", () => {
    const { item } = convertMcpEntry(
      "srv",
      {
        command: "run",
        env: {
          API_KEY: "${API_KEY:-}",
          PORT: "${PORT:-3000}",
          DSN: "${DB_PASSWORD:-hunter2hunter2}",
          LOG_DIR: "/var/log/${APP:-app}",
        },
      },
      noProject,
    );
    expect(item.def).toEqual({
      transport: {
        type: "stdio",
        command: "run",
        env: {
          API_KEY: "secret://srv-api-key",
          PORT: "3000",
          DSN: "secret://srv-db-password",
          LOG_DIR: "/var/log/app",
        },
      },
    });
    expect(item.secretRefs).toEqual([
      { place: "env.API_KEY", varName: "API_KEY", secretName: "srv-api-key", origin: "env_ref" },
      {
        place: "env.DSN",
        varName: "DB_PASSWORD",
        secretName: "srv-db-password",
        origin: "env_ref",
      },
    ]);
    expect(JSON.stringify(item)).not.toContain("hunter2");
  });

  test("secret names that collide inside one server get a numeric suffix", () => {
    const { item } = convertMcpEntry(
      "srv",
      {
        command: "run",
        env: { API_TOKEN: "${API_TOKEN}", X_TOKEN_ALIAS: "${API_TOKEN}" },
      },
      noProject,
    );
    expect(item.secretRefs.map((ref) => ref.secretName)).toEqual([
      "srv-api-token",
      "srv-api-token-2",
    ]);
  });

  test("a valid secret:// reference is kept and a malformed one drops the definition", () => {
    const keep = convertMcpEntry(
      "srv",
      { command: "run", env: { TOKEN: "secret://tok" } },
      noProject,
    );
    expect(keep.item.def).toEqual({
      transport: { type: "stdio", command: "run", env: { TOKEN: "secret://tok" } },
    });
    expect(keep.item.secretRefs).toEqual([]);

    const typo = convertMcpEntry(
      "srv",
      { command: "run", env: { REGION: "secret://Bad_Name" } },
      noProject,
    );
    expect(typo.item.def).toBeUndefined();
    expect(typo.warnings).toContain("정의 검사에 걸려 옮기지 않는다");
  });

  test("${CLAUDE_PROJECT_DIR} is bound to the project root and left literal without one", () => {
    const bound = convertMcpEntry(
      "local",
      {
        command: "${CLAUDE_PROJECT_DIR}/bin/tool",
        args: ["--root", "${CLAUDE_PROJECT_DIR:-.}"],
        cwd: "./sub",
      },
      inProject,
    );
    expect(bound.item.def).toEqual({
      transport: {
        type: "stdio",
        command: `${PROJECT}/bin/tool`,
        args: ["--root", PROJECT],
        cwd: `${PROJECT}/sub`,
      },
    });
    expect(bound.item.projectBound).toBe(true);
    expect(bound.warnings).toEqual([]);

    const unbound = convertMcpEntry(
      "local",
      { command: "${CLAUDE_PROJECT_DIR}/bin/tool", cwd: "." },
      noProject,
    );
    expect(unbound.item.def).toEqual({
      transport: { type: "stdio", command: "${CLAUDE_PROJECT_DIR}/bin/tool", cwd: "." },
    });
    expect(unbound.item.projectBound).toBe(false);
    expect(unbound.warnings).toEqual([
      "command의 CLAUDE_PROJECT_DIR: 변수 확장이 없어 글자 그대로 남는다",
      "상대 cwd는 프로젝트 기준을 알 수 없어 글자 그대로 남는다",
    ]);
  });

  test("ws, headersHelper, oauth details and unknown keys become fields, not definitions", () => {
    const ws = convertMcpEntry(
      "socket",
      {
        type: "ws",
        url: "wss://x.example.com",
        headersHelper: "echo secret-helper-output",
        timeout: 30000,
        flavor: "x",
      },
      inProject,
    );
    expect(ws.item.transport).toBe("ws");
    expect(ws.item.def).toBeUndefined();
    expect(ws.fields.map((field) => [field.key, field.summary])).toEqual([
      ["headersHelper", undefined],
      ["timeout", "30000"],
      ["flavor", undefined],
    ]);
    expect(JSON.stringify(ws)).not.toContain("secret-helper-output");

    const remote = convertMcpEntry(
      "mcp-remote",
      {
        type: "http",
        url: "https://m.example.com/mcp",
        oauth: { clientId: "public-client", scopes: ["mcp.read", "mcp.write"], callbackPort: 8080 },
      },
      inProject,
    );
    expect(remote.item.def).toEqual({
      transport: { type: "http", url: "https://m.example.com/mcp", oauth: true },
    });
    expect(remote.fields.map((field) => [field.key, field.summary])).toEqual([
      ["oauth.clientId", "public-client"],
      ["oauth.scopes", "mcp.read mcp.write"],
      ["oauth.callbackPort", "8080"],
    ]);
  });

  test("names are normalized, and a name that cannot become an id has no id and no definition", () => {
    const renamed = convertMcpEntry("My Server!", { command: "x" }, inProject);
    expect(renamed.item.id).toBe("my-server-");
    expect(renamed.item.id).not.toBe(renamed.item.serverName);

    const bad = convertMcpEntry("1bad", { command: "x" }, inProject);
    expect(bad.item.id).toBeUndefined();
    expect(bad.item.def).toBeUndefined();
    expect(bad.warnings).toContain("이름을 서버 id로 바꿀 수 없어 정의를 옮기지 않는다");

    const empty = convertMcpEntry("", { command: "x" }, inProject);
    expect(empty.item.id).toBeUndefined();
  });

  test("an sse entry keeps the oauth flag the design asks for", () => {
    const sse = convertMcpEntry(
      "old",
      { type: "sse", url: "https://old.example.com/sse", oauth: true },
      inProject,
    );
    expect(sse.item.def).toEqual({
      transport: { type: "sse", url: "https://old.example.com/sse", oauth: true },
    });
    expect(parse(McpServerDefSchema, sse.item.def).ok).toBe(true);
  });
});

describe("scan", () => {
  test("project .mcp.json gives one item per server, field items, and a ~ path", async () => {
    const result = await scanProject({
      [MCP_FILE]: servers({
        fs: { command: "npx", args: ["-y", "pkg"], timeout: 5000 },
        web: { type: "http", url: "https://e.example.com/mcp", headers: { "X-Region": "eu" } },
      }),
    });
    expect(result.scanned).toEqual(["~/proj/.mcp.json"]);
    expect(result.diagnostics).toEqual([]);
    expect(result.items.map((item) => [item.kind, item.keyPath])).toEqual([
      ["mcp", "mcpServers.fs"],
      ["field", "mcpServers.fs.timeout"],
      ["mcp", "mcpServers.web"],
    ]);
    const first = result.items[0];
    expect(first).toMatchObject({
      harness: "claude-code",
      scope: "project",
      rootLabel: "proj",
      path: "~/proj/.mcp.json",
      secrets: [],
    });
    expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.ir).toMatchObject({ kind: "mcp", id: "fs", transport: "stdio" });
    expect(result.items[1]?.ir).toMatchObject({ kind: "field", key: "timeout", summary: "5000" });
  });

  test("the same input scanned twice gives the same result", async () => {
    const files = {
      [MCP_FILE]: servers({
        gh: { command: "gh-mcp", env: { GITHUB_TOKEN: "ghp_xxxxxxxxxxxx" } },
        api: {
          type: "http",
          url: "https://api.example.com",
          headers: { Authorization: "Bearer ${T:-}" },
        },
      }),
    };
    const first = await scanProject(files);
    const second = await scanProject(files);
    expect(second).toEqual(first);
  });

  test("a changed secret keeps the item id and changes the hash, and the value stays out", async () => {
    const before = await scanProject({
      [MCP_FILE]: servers({ gh: { command: "gh", env: { GITHUB_TOKEN: "ghp_aaaaaaaaaaaa" } } }),
    });
    const after = await scanProject({
      [MCP_FILE]: servers({ gh: { command: "gh", env: { GITHUB_TOKEN: "ghp_bbbbbbbbbbbb" } } }),
    });
    expect(after.items[0]?.itemId).toBe(before.items[0]?.itemId);
    expect(after.items[0]?.sha256).not.toBe(before.items[0]?.sha256);
    expect(after.items[0]?.secrets).toEqual([
      { keyPath: "mcpServers.gh.env.GITHUB_TOKEN", kind: "literal", name: "GITHUB_TOKEN" },
    ]);
    expect(JSON.stringify(after)).not.toContain("ghp_");
  });

  test("a missing file gives nothing, and no mcpServers or a non-object gives no items", async () => {
    expect(await scanProject({})).toEqual({ items: [], diagnostics: [], scanned: [] });
    expect((await scanProject({ [MCP_FILE]: JSON.stringify({ other: 1 }) })).items).toEqual([]);
    expect((await scanProject({ [MCP_FILE]: JSON.stringify({ mcpServers: [] }) })).items).toEqual(
      [],
    );
  });

  test("user scope reads only the top-level mcpServers and keeps nothing else", async () => {
    const files = {
      [USER_FILE]: JSON.stringify({
        numStartups: 4,
        mcpServers: { global: { type: "http", url: "https://g.example.com/mcp" } },
        projects: {
          [PROJECT]: { mcpServers: { "local-only": { command: "local-secret-command" } } },
        },
      }),
    };
    const result = await mcpJsonAdapter.scan(
      userRoot,
      memoryFs(files),
      DEFAULT_SCAN_LIMITS,
      context,
    );
    expect(result.items.map((item) => item.keyPath)).toEqual(["mcpServers.global"]);
    expect(result.items[0]).toMatchObject({
      scope: "user",
      path: "~/.claude.json",
      rootLabel: "me",
    });
    expect(result.scanned).toEqual(["~/.claude.json"]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("local-only");
    expect(serialized).not.toContain("local-secret-command");
    expect(serialized).not.toContain("projects");
    expect(serialized).not.toContain(HOME);
  });

  test("invalid JSON gives a diagnostic without the file content", async () => {
    const result = await scanProject({
      [MCP_FILE]: '{ "mcpServers": { "x": { "command": "leak-me" } ',
    });
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "invalid_json", path: "~/proj/.mcp.json", message: expect.any(String) },
    ]);
    expect(JSON.stringify(result)).not.toContain("leak-me");
  });

  test("a file over the size limit gives too_large, for both scopes", async () => {
    const limits = { ...DEFAULT_SCAN_LIMITS, maxFileBytes: 10, maxClaudeJsonBytes: 10 };
    const project = await scanProject({ [MCP_FILE]: servers({ a: { command: "x" } }) }, limits);
    expect(project.items).toEqual([]);
    expect(project.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["too_large"]);

    const user = await mcpJsonAdapter.scan(
      userRoot,
      memoryFs({ [USER_FILE]: servers({ a: { command: "x" } }) }),
      limits,
      context,
    );
    expect(user.items).toEqual([]);
    expect(user.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["too_large"]);
  });

  test("a symlink that leaves the project is not read; one inside is read", async () => {
    const outside = await scanProject({
      [MCP_FILE]: { symlinkTo: `${HOME}/elsewhere/mcp.json` },
      [`${HOME}/elsewhere/mcp.json`]: servers({ a: { command: "x" } }),
    });
    expect(outside.items).toEqual([]);
    expect(outside.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unreadable"]);

    const inside = await scanProject({
      [MCP_FILE]: { symlinkTo: `${PROJECT}/config/mcp.json` },
      [`${PROJECT}/config/mcp.json`]: servers({ a: { command: "x" } }),
    });
    expect(inside.items.map((item) => item.keyPath)).toEqual(["mcpServers.a"]);
    expect(inside.diagnostics).toEqual([]);
  });
});
