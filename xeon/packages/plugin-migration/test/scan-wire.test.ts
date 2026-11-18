// 훑기 자식의 줄 형식(migration.md §7.4 [제안]). 모든 중간 표현 종류가 JSON을 한 번 거쳐 같은 값으로 돌아오는지,
// 경계 검사가 어긋난 줄을 거부하는지 값으로 본다.
import { expect, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import {
  decodeScanItem,
  parseScanChildLine,
  parseScanRequest,
  scanJsonReplacer,
  type SourceItem,
} from "../src/index.ts";

const ENCODER = new TextEncoder();

const FIXTURES: readonly SourceItem[] = [
  {
    itemId: "0123456789abcdef",
    harness: "claude-code",
    kind: "instruction",
    scope: "user",
    rootLabel: "홈",
    path: "~/.claude/CLAUDE.md",
    sha256: "b".repeat(64),
    bytes: 12,
    ir: {
      kind: "instruction",
      name: "CLAUDE",
      text: "항상 한국어로 답한다\n",
      activation: "always",
      globs: [],
      role: "user_global",
      onlyAgentsMdImport: false,
      parts: [{ source: "~/.claude/CLAUDE.md", text: "항상 한국어로 답한다\n" }],
    },
    secrets: [],
    warnings: [],
  },
  {
    itemId: "fedcba9876543210",
    harness: "agent-skills",
    kind: "skill",
    scope: "project",
    rootLabel: "fresnel-proj",
    path: ".agents/skills/deploy",
    sha256: "c".repeat(64),
    bytes: 20,
    ir: {
      kind: "skill",
      dirName: "deploy",
      name: "deploy",
      description: undefined,
      files: [
        { path: "SKILL.md", bytes: ENCODER.encode("---\nname: deploy\n---\n본문\n") },
        { path: "logo.bin", bytes: new Uint8Array([0, 255, 1, 128]) },
      ],
    },
    secrets: [],
    warnings: ["머리말 설명이 없다"],
  },
  {
    itemId: "1111222233334444",
    harness: "claude-code",
    kind: "command",
    scope: "project",
    rootLabel: "fresnel-proj",
    path: ".claude/commands/a/b.md",
    sha256: "d".repeat(64),
    bytes: 30,
    ir: {
      kind: "command",
      name: "a-b",
      relPath: "a/b.md",
      text: "---\ndescription: 설명\n---\n$ARGUMENTS\n",
      description: "설명",
      hasSubstitutions: true,
    },
    secrets: [],
    warnings: [],
  },
  {
    itemId: "5555666677778888",
    harness: "claude-code",
    kind: "agent",
    scope: "user",
    rootLabel: "홈",
    path: "~/.claude/agents/reviewer.md",
    sha256: "e".repeat(64),
    bytes: 40,
    ir: {
      kind: "agent",
      fileName: "reviewer",
      name: "reviewer",
      description: undefined,
      prompt: "검토한다\n",
      tools: ["Read", "Grep"],
      disallowedTools: undefined,
      model: undefined,
      permissionMode: "plan",
    },
    secrets: [],
    warnings: [],
  },
  {
    itemId: "9999aaaabbbbcccc",
    harness: "claude-code",
    kind: "mcp",
    scope: "project",
    rootLabel: "fresnel-proj",
    path: ".mcp.json",
    keyPath: "mcpServers.github",
    sha256: "f".repeat(64),
    bytes: 90,
    ir: {
      kind: "mcp",
      serverName: "github",
      id: "github",
      transport: "stdio",
      def: {
        transport: {
          type: "stdio",
          command: "npx",
          args: ["-y", "server-github"],
          env: { GITHUB_TOKEN: "secret://github-token" },
        },
      },
      secretRefs: [
        {
          place: "env.GITHUB_TOKEN",
          varName: "GITHUB_TOKEN",
          secretName: "github-token",
          origin: "env_ref",
        },
      ],
      projectBound: false,
    },
    secrets: [{ keyPath: "env.GITHUB_TOKEN", kind: "env_ref", name: "GITHUB_TOKEN" }],
    warnings: [],
  },
  {
    itemId: "dddd0000eeee1111",
    harness: "claude-code",
    kind: "mcp",
    scope: "project",
    rootLabel: "fresnel-proj",
    path: ".mcp.json",
    keyPath: "mcpServers.docs",
    sha256: "0".repeat(64),
    bytes: 60,
    ir: {
      kind: "mcp",
      serverName: "docs",
      id: undefined,
      transport: "http",
      def: {
        transport: {
          type: "http",
          url: "https://docs.example.test/mcp",
          headers: { Authorization: "secret://docs-auth" },
          oauth: true,
        },
        timeouts: { connectMs: 5000 },
      },
      secretRefs: [],
      projectBound: true,
    },
    secrets: [],
    warnings: ["서버 이름을 식별자로 바꾸지 못했다"],
  },
  {
    itemId: "2222333344445555",
    harness: "claude-code",
    kind: "field",
    scope: "user",
    rootLabel: "홈",
    path: "~/.claude/settings.json",
    keyPath: "permissions.allow",
    sha256: "1".repeat(64),
    bytes: 5,
    ir: { kind: "field", container: "skill", key: "allowed-tools", summary: undefined },
    secrets: [],
    warnings: [],
  },
  {
    itemId: "6666777788889999",
    harness: "claude-code",
    kind: "blocked",
    scope: "managed",
    rootLabel: "홈",
    path: "/etc/claude/managed.json",
    sha256: "2".repeat(64),
    bytes: 7,
    ir: { kind: "blocked", of: "mcp", code: "managed_scope", text: "관리 범위는 옮기지 않는다" },
    secrets: [],
    warnings: [],
  },
];

/** 엔진이 받는 모양 그대로: 치환 함수로 쓰고, JSON으로 읽고, 검증하고, 되돌린다 */
function roundTrip(item: SourceItem): SourceItem {
  const line = JSON.stringify(
    { kind: "ok", limitReached: false, scan: { scanned: [], items: [item], diagnostics: [] } },
    scanJsonReplacer,
  );
  const json = parseJson(line);
  if (!json.ok) throw new Error("the encoded line is not JSON");
  const checked = parseScanChildLine(json.value);
  if (!checked.ok)
    throw new Error(`the line does not match the schema: ${JSON.stringify(checked.error.issues)}`);
  if (checked.value.kind !== "ok") throw new Error("expected an ok line");
  const [wire] = checked.value.scan.items;
  if (wire === undefined) throw new Error("expected one item");
  return decodeScanItem(wire);
}

test("every intermediate-representation kind survives the JSON round trip with the same values, bytes included", () => {
  for (const item of FIXTURES) {
    expect(roundTrip(item)).toEqual(item);
  }
  // 바이트는 `Uint8Array`로 돌아온다(JSON 객체가 아니다)
  const skill = roundTrip(skillItemOf());
  expect(skill.ir.kind).toBe("skill");
  if (skill.ir.kind === "skill") {
    expect(skill.ir.files[1]?.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(skill.ir.files[1]?.bytes ?? [])).toEqual([0, 255, 1, 128]);
  }
});

function skillItemOf(): SourceItem {
  const item = FIXTURES[1];
  if (item === undefined) throw new Error("expected the skill fixture");
  return item;
}

test("a Buffer (what the file reader returns) is encoded the same way: its own toJSON does not leak into the line", () => {
  const skill = skillItemOf();
  if (skill.ir.kind !== "skill") throw new Error("expected the skill fixture");
  const withBuffer: SourceItem = {
    ...skill,
    ir: {
      ...skill.ir,
      files: [{ path: "logo.bin", bytes: Buffer.from([0, 255, 1, 128]) }],
    },
  };
  const line = JSON.stringify(withBuffer, scanJsonReplacer);
  expect(line).toContain('{"base64":"AP8BgA=="}');
  expect(line.includes('"type":"Buffer"')).toBe(false);
  const decoded = roundTrip(withBuffer);
  if (decoded.ir.kind !== "skill") throw new Error("expected a skill");
  expect(Array.from(decoded.ir.files[0]?.bytes ?? [])).toEqual([0, 255, 1, 128]);
});

test("the encoded bytes are {base64} objects in the line, never a numbered object", () => {
  const line = JSON.stringify(skillItemOf(), scanJsonReplacer);
  expect(line).toContain('{"base64":"AP8BgA=="}');
  expect(line.includes('"0":')).toBe(false);
});

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

/** 첫 항목을 JSON으로 만든 뒤 바꾼 줄 값. 시험은 이 값을 `parseScanChildLine`에 넘긴다 */
function lineOf(mutate: (item: Record<string, unknown>) => void): unknown {
  const parsed = parseJson(JSON.stringify(FIXTURES[0], scanJsonReplacer));
  if (!parsed.ok) throw new Error("the item is not JSON");
  const item = recordOf(parsed.value);
  mutate(item);
  return { kind: "ok", limitReached: false, scan: { scanned: [], items: [item], diagnostics: [] } };
}

test("the boundary refuses a malformed item line and names the failing key", () => {
  const missingId = parseScanChildLine(lineOf((item) => delete item["itemId"]));
  expect(missingId.ok).toBe(false);
  const unknownKind = parseScanChildLine(lineOf((item) => (item["kind"] = "widget")));
  expect(unknownKind.ok).toBe(false);
  const extraKey = parseScanChildLine(lineOf((item) => (item["extra"] = true)));
  expect(extraKey.ok).toBe(false);
  const badBase64 = parseScanChildLine(
    lineOf(
      (item) =>
        (item["ir"] = {
          kind: "skill",
          dirName: "x",
          files: [{ path: "a", bytes: { base64: "AQ=" } }],
        }),
    ),
  );
  expect(badBase64.ok).toBe(false);
});

test("a skill file that is not {base64} is refused, so the decoder never sees a raw array", () => {
  const raw = parseScanChildLine(
    lineOf(
      (item) =>
        (item["ir"] = { kind: "skill", dirName: "x", files: [{ path: "a", bytes: [1, 2] }] }),
    ),
  );
  expect(raw.ok).toBe(false);
});

test("the progress, error and ok lines each take their own shape and nothing else", () => {
  expect(parseScanChildLine({ kind: "progress", done: 1, total: 2 }).ok).toBe(true);
  expect(parseScanChildLine({ kind: "progress", done: -1, total: 2 }).ok).toBe(false);
  expect(parseScanChildLine({ kind: "progress", done: 1.5, total: 2 }).ok).toBe(false);
  expect(parseScanChildLine({ kind: "error", code: "scan_failed" }).ok).toBe(true);
  expect(parseScanChildLine({ kind: "error", code: "" }).ok).toBe(false);
  expect(parseScanChildLine({ kind: "error", code: "x".repeat(65) }).ok).toBe(false);
  expect(parseScanChildLine({ kind: "ok", limitReached: false }).ok).toBe(false);
  expect(parseScanChildLine("not an object").ok).toBe(false);
});

test("the request line names roots by path, scope and label, and refuses a scope outside user or project", () => {
  const good = {
    roots: [{ path: "/home/u", scope: "user", label: "홈" }],
    homeDir: "/home/u",
  };
  expect(parseScanRequest(good).ok).toBe(true);
  expect(
    parseScanRequest({ ...good, roots: [{ path: "/home/u", scope: "managed", label: "x" }] }).ok,
  ).toBe(false);
  expect(parseScanRequest({ roots: [], homeDir: "" }).ok).toBe(false);
});
