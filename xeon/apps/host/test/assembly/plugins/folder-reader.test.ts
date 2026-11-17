import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { hashPluginTree } from "../../../src/assembly/plugins/content-hash.ts";
import {
  INSTRUCTION_MAX_BYTES,
  readPluginFolder,
  type FolderRejection,
  type PluginFolder,
} from "../../../src/assembly/plugins/folder-reader.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.5.1~4, §4.5.6: 원본 폴더 읽기. 이름, 신호, 매니페스트 추론, 재료, 선언 우선.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

/** 이름이 고정된 폴더를 새로 만든다. 폴더 이름이 곧 플러그인 이름이다 */
function folderNamed(name: string): string {
  const parent = tempRoot("plugin-folder-");
  roots.push(parent);
  return join(parent, name);
}

function read(dir: string): ReturnType<typeof readPluginFolder> {
  return readPluginFolder(dir, { origin: "user" });
}

function expectFolder(dir: string): PluginFolder {
  const result = read(dir);
  if (!result.ok) throw new Error(`expected a folder, got ${result.error.kind}`);
  return result.value;
}

function expectRejection(dir: string): FolderRejection {
  const result = read(dir);
  if (result.ok) throw new Error("expected a rejection");
  return result.error;
}

const SKILL = `---\nname: greeter\ndescription: "Say hello politely"\n---\n\nBody text here.\n`;

test("매니페스트가 없는 스킬 폴더는 추론한 매니페스트로 읽고 파일을 쓰지 않는다", () => {
  const dir = folderNamed("hello-skill");
  writeFiles(dir, { "SKILL.md": SKILL });
  const folder = expectFolder(dir);

  expect(folder.name).toBe("hello-skill");
  expect(folder.inferred).toBe(true);
  expect(folder.manifest.name).toBe("hello-skill");
  expect(folder.manifest.purpose).toBe("Say hello politely");
  expect(folder.manifest.plugins).toEqual([{ layer: "plugin", hooks: [] }]);
  expect(folder.manifest.entry).toBeUndefined();
  expect(folder.manifest.version).toBe(`0.0.0-${folder.contentHash.slice(7, 15)}`);
  expect(folder.materials.skills).toEqual([
    {
      name: "greeter",
      path: "SKILL.md",
      description: "Say hello politely",
      descriptionChars: 18,
      when: "on_demand",
    },
  ]);
  expect(folder.materials.instructions).toEqual([]);
  expect(existsSync(join(dir, ".fresnel-plugin"))).toBe(false);
  const tree = hashPluginTree(dir);
  expect(tree.ok).toBe(true);
  if (tree.ok) expect(folder.contentHash).toBe(tree.value.contentHash);
});

test("폴더 이름이 규칙을 어기면 name_invalid이고 결과가 없다", () => {
  for (const name of ["Bad_Name", "x"]) {
    const dir = folderNamed(name);
    writeFiles(dir, { "SKILL.md": SKILL });
    const rejection = expectRejection(dir);
    expect(rejection.kind).toBe("name_invalid");
  }
});

test("신호가 없고 매니페스트도 없으면 후보가 아니다. AGENTS.md는 신호가 아니고 읽지도 않는다", () => {
  const dir = folderNamed("docs-only");
  writeFiles(dir, { "AGENTS.md": "# project rules", "README.md": "readme" });
  expect(expectRejection(dir).kind).toBe("no_signal");

  const withInstructions = folderNamed("with-agents");
  writeFiles(withInstructions, { "AGENTS.md": "# project rules", "instructions.md": "Be brief." });
  const folder = expectFolder(withInstructions);
  expect(folder.materials.instructions.map((item) => item.path)).toEqual(["instructions.md"]);
});

test("매니페스트 없는 코드 폴더(plugin.ts)는 manifest_required다", () => {
  const dir = folderNamed("code-only");
  writeFiles(dir, { "plugin.ts": "export {};" });
  expect(expectRejection(dir).kind).toBe("manifest_required");
});

test("매니페스트의 tools 이름이 겹치면 manifest_invalid다", () => {
  const dir = folderNamed("dup-tools");
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "dup-tools",
      version: "1.0.0",
      tools: [
        { name: "same_tool", description: "one" },
        { name: "same_tool", description: "two" },
      ],
    }),
  });
  const rejection = expectRejection(dir);
  expect(rejection.kind).toBe("manifest_invalid");
  expect(rejection.diagnostics.some((item) => item.message.includes("tool_duplicate"))).toBe(true);
});

test("매니페스트 name이 있으면 폴더 이름이 규칙을 어겨도 그 이름을 쓴다", () => {
  const dir = folderNamed("Bad_Folder");
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "good-name",
      version: "1.2.0",
      purpose: "Keeps notes",
      tools: [{ name: "note_save", description: "Save a note" }],
      entry: "./plugin.ts",
    }),
    "plugin.ts": "export {};",
  });
  const folder = expectFolder(dir);
  expect(folder.name).toBe("good-name");
  expect(folder.inferred).toBe(false);
  expect(folder.manifest.purpose).toBe("Keeps notes");
  expect(folder.manifest.entry).toBe("./plugin.ts");
});

test("entry 파일이 없으면 entry_missing 오류다", () => {
  const dir = folderNamed("no-entry-file");
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "no-entry-file",
      version: "1.0.0",
      entry: "./plugin.ts",
    }),
  });
  const rejection = expectRejection(dir);
  expect(rejection.kind).toBe("material_invalid");
  expect(rejection.diagnostics.map((item) => item.code)).toContain("entry_missing");
});

test("지침: instructions.md와 instructions/*.md를 항상 싣고 경로 순서로 정렬한다", () => {
  const dir = folderNamed("rules-plugin");
  writeFiles(dir, {
    "instructions.md": "Main rule.",
    "instructions/zeta.md": "Last.",
    "instructions/alpha.md": "First.",
    "instructions/nested/skip.md": "Not included.",
  });
  const folder = expectFolder(dir);
  expect(folder.materials.instructions).toEqual([
    { path: "instructions.md", text: "Main rule.", bytes: 10, when: "always" },
    { path: "instructions/alpha.md", text: "First.", bytes: 6, when: "always" },
    { path: "instructions/zeta.md", text: "Last.", bytes: 5, when: "always" },
  ]);
});

test("지침 파일이 65536바이트를 넘으면 instructions_too_large다", () => {
  const dir = folderNamed("big-rules");
  writeFiles(dir, { "instructions.md": "a".repeat(INSTRUCTION_MAX_BYTES + 1) });
  const rejection = expectRejection(dir);
  expect(rejection.kind).toBe("material_invalid");
  expect(rejection.diagnostics.map((item) => item.code)).toContain("instructions_too_large");
});

test("UTF-8이 아닌 지침 파일은 not_utf8 오류다", () => {
  const dir = folderNamed("bad-bytes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "instructions.md"), Buffer.from([0xff, 0xfe, 0x41]));
  const rejection = expectRejection(dir);
  expect(rejection.diagnostics.map((item) => item.code)).toContain("not_utf8");
});

test("mcp.json은 서버를 읽고 전송을 고른다. .mcp.json은 인식하지 않는다", () => {
  const dir = folderNamed("mcp-plugin");
  writeFiles(dir, {
    "mcp.json": JSON.stringify({
      mcpServers: {
        local: { command: "node", args: ["server.js"] },
        remote: { type: "http", url: "https://example.test/mcp" },
        legacy: { type: "sse", url: "https://example.test/sse" },
      },
    }),
  });
  const folder = expectFolder(dir);
  expect(folder.materials.mcpServers).toEqual([
    {
      name: "local",
      transport: "stdio",
      config: { command: "node", args: ["server.js"] },
      when: "always",
    },
    {
      name: "remote",
      transport: "http",
      config: { type: "http", url: "https://example.test/mcp" },
      when: "always",
    },
    {
      name: "legacy",
      transport: "http",
      config: { type: "sse", url: "https://example.test/sse" },
      when: "always",
    },
  ]);

  const dotOnly = folderNamed("dot-mcp");
  writeFiles(dotOnly, {
    ".mcp.json": JSON.stringify({ mcpServers: { a: { command: "x" } } }),
  });
  expect(expectRejection(dotOnly).kind).toBe("no_signal");
});

test("MCP 항목이 잘못되면 mcp_invalid 오류다", () => {
  const dir = folderNamed("bad-mcp");
  writeFiles(dir, {
    "mcp.json": JSON.stringify({ mcpServers: { broken: { type: "stdio" } } }),
  });
  const rejection = expectRejection(dir);
  expect(rejection.diagnostics.map((item) => item.code)).toContain("mcp_invalid");
});

test("에이전트와 명령은 최상위 .md만 싣고 필요할 때 쓴다", () => {
  const dir = folderNamed("agent-kit");
  writeFiles(dir, {
    "SKILL.md": SKILL,
    "agents/reviewer.md": "Review carefully.",
    "agents/deep/nested.md": "Skipped.",
    "commands/ship.md": "Ship it.",
  });
  const folder = expectFolder(dir);
  expect(folder.materials.agents).toEqual([
    { name: "reviewer", path: "agents/reviewer.md", text: "Review carefully.", when: "on_demand" },
  ]);
  expect(folder.materials.commands).toEqual([
    { name: "ship", path: "commands/ship.md", text: "Ship it.", when: "on_demand" },
  ]);
});

test("매니페스트 선언이 있으면 그 칸은 선언을 쓰고 신호는 무시한다", () => {
  const dir = folderNamed("declared-kit");
  writeFiles(dir, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "declared-kit",
      version: "1.0.0",
      components: { instructions: ["./rules.md"] },
    }),
    "rules.md": "Declared rules.",
    "instructions.md": "Signal rules, ignored.",
  });
  const folder = expectFolder(dir);
  expect(folder.materials.instructions.map((item) => item.path)).toEqual(["rules.md"]);
});

test("선언한 경로가 없으면 component_missing이고, 폴더 밖을 가리키면 path_outside다", () => {
  const missing = folderNamed("missing-part");
  writeFiles(missing, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "missing-part",
      version: "1.0.0",
      components: { skills: ["absent"] },
    }),
  });
  expect(expectRejection(missing).diagnostics.map((item) => item.code)).toContain(
    "component_missing",
  );

  const outside = folderNamed("escaping");
  writeFiles(outside, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "escaping",
      version: "1.0.0",
      components: { instructions: ["../escape.md"] },
    }),
  });
  expect(expectRejection(outside).diagnostics.map((item) => item.code)).toContain("path_outside");
});

test("스킬 여럿이면 목적은 null이고 이름은 머리말 또는 폴더 이름이다", () => {
  const dir = folderNamed("two-skills");
  writeFiles(dir, {
    "skills/alpha/SKILL.md": `---\ndescription: First skill\n---\nA`,
    "skills/beta/SKILL.md": `---\nname: named-beta\ndescription: Second skill\n---\nB`,
  });
  const folder = expectFolder(dir);
  expect(folder.manifest.purpose).toBeUndefined();
  expect(folder.materials.skills.map((skill) => [skill.name, skill.path])).toEqual([
    ["alpha", "skills/alpha/SKILL.md"],
    ["named-beta", "skills/beta/SKILL.md"],
  ]);
});

test("머리말이 없는 SKILL.md는 폴더 이름과 목적 없음으로 읽는다", () => {
  const dir = folderNamed("plain-skill");
  writeFiles(dir, { "SKILL.md": "Just a body." });
  const folder = expectFolder(dir);
  expect(folder.materials.skills).toEqual([
    {
      name: "plain-skill",
      path: "SKILL.md",
      description: null,
      descriptionChars: 0,
      when: "on_demand",
    },
  ]);
  expect(folder.manifest.purpose).toBeUndefined();
});

test("폴더 안의 심볼릭 링크는 tree_rejected다", () => {
  const dir = folderNamed("linked");
  writeFiles(dir, { "SKILL.md": SKILL });
  const outside = tempRoot("plugin-outside-");
  roots.push(outside);
  symlinkSync(join(outside, "nothing"), join(dir, "link.md"));
  expect(expectRejection(dir).kind).toBe("tree_rejected");
});

test("같은 폴더는 항상 같은 결과를 낸다", () => {
  const dir = folderNamed("stable-skill");
  writeFiles(dir, { "SKILL.md": SKILL, "instructions.md": "Keep." });
  expect(expectFolder(dir)).toEqual(expectFolder(dir));
});
