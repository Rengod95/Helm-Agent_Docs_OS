// 내보내기 시험: 같은 입력이면 같은 바이트, 매니페스트 모양, 이식 기록의 내용과 금지 항목.
import { expect, test } from "bun:test";
import { parse, parseJson } from "@fresnel/contracts";
import { Type } from "typebox";
import { itemIdOf, sha256Hex } from "../src/hash.ts";
import { emit } from "../src/emit.ts";
import { bundledRulesets, type Ruleset } from "../src/rules.ts";
import { propose } from "../src/propose.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type IrMcp,
  type IrSkill,
  type MigrationProposal,
  type MigrationScan,
  type PlannedPlugin,
  type SourceItem,
} from "../src/types.ts";

function bundledOrFail(): readonly Ruleset[] {
  const bundled = bundledRulesets();
  if (!bundled.ok) throw new Error(`bundled rules are invalid: ${bundled.error.source}`);
  return bundled.value;
}

const BUNDLED_RULESETS = bundledOrFail();

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 이식 기록의 시험용 모양. 필드가 빠지면 시험이 실패한다 */
const RecordSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  plugin: Type.String(),
  rulesVersions: Type.Record(Type.String(), Type.String()),
  sources: Type.Array(Type.Object({ path: Type.String(), sha256: Type.String() })),
  report: Type.Array(
    Type.Object({
      status: Type.String(),
      output: Type.Optional(Type.Object({ plugin: Type.String(), path: Type.String() })),
    }),
  ),
});

function decode(bytes: Uint8Array | undefined): string {
  if (bytes === undefined) throw new Error("missing file");
  return new TextDecoder().decode(bytes);
}

const DEPLOY_SKILL_MD =
  "---\nname: deploy\ndescription: Deploy the app to staging. Use when the user asks to ship a build.\n---\n\nRun ./scripts/deploy.sh.\n";

const deployIr: IrSkill = {
  kind: "skill",
  dirName: "deploy",
  name: "deploy",
  description: "Deploy the app to staging. Use when the user asks to ship a build.",
  files: [
    { path: "SKILL.md", bytes: enc(DEPLOY_SKILL_MD) },
    { path: "scripts/deploy.sh", bytes: enc("#!/bin/sh\necho deploy\n") },
  ],
};

const deployItem: SourceItem = {
  itemId: itemIdOf(["agent-skills", "skill", "user", "deploy"]),
  harness: "agent-skills",
  kind: "skill",
  scope: "user",
  rootLabel: "home",
  path: "~/.claude/skills/deploy",
  sha256: sha256Hex(DEPLOY_SKILL_MD),
  bytes: DEPLOY_SKILL_MD.length,
  ir: deployIr,
  secrets: [],
  warnings: [],
};

const githubIr: IrMcp = {
  kind: "mcp",
  serverName: "github",
  id: "github",
  transport: "stdio",
  def: {
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
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
};

const githubItem: SourceItem = {
  itemId: itemIdOf(["claude-code", "mcp", "user", "mcpServers.github"]),
  harness: "claude-code",
  kind: "mcp",
  scope: "user",
  rootLabel: "home",
  path: "~/.claude.json",
  keyPath: "mcpServers.github",
  sha256: sha256Hex("github-server-definition"),
  bytes: 120,
  ir: githubIr,
  secrets: [
    { keyPath: "mcpServers.github.env.GITHUB_TOKEN", kind: "env_ref", name: "GITHUB_TOKEN" },
  ],
  warnings: [],
};

function scanOf(items: readonly SourceItem[]): MigrationScan {
  return { roots: [], scanned: ["~/.claude"], items, diagnostics: [], limits: DEFAULT_SCAN_LIMITS };
}

function plugin(proposal: MigrationProposal, name: string): PlannedPlugin {
  const found = proposal.plugins.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no plugin ${name}`);
  return found;
}

test("the emitted files are sorted by path and include the manifest and the migration record", () => {
  const proposal = propose(scanOf([deployItem]), BUNDLED_RULESETS, { answers: {} });
  const emitted = emit(plugin(proposal, "deploy"));
  expect([...emitted.keys()]).toEqual([
    ".fresnel-plugin/migration.json",
    ".fresnel-plugin/plugin.json",
    "skills/deploy/SKILL.md",
    "skills/deploy/scripts/deploy.sh",
  ]);
  expect(emitted.get("skills/deploy/SKILL.md")).toEqual(enc(DEPLOY_SKILL_MD));
});

test("emitting the same plan twice gives the same bytes for every file", () => {
  const proposal = propose(scanOf([deployItem, githubItem]), BUNDLED_RULESETS, { answers: {} });
  for (const name of proposal.plugins.map((entry) => entry.name)) {
    const first = emit(plugin(proposal, name));
    const second = emit(plugin(proposal, name));
    expect([...first.keys()]).toEqual([...second.keys()]);
    for (const [path, bytes] of first) {
      expect(second.get(path)).toEqual(bytes);
    }
  }
});

test("the input tree is left as it was", () => {
  const proposal = propose(scanOf([deployItem]), BUNDLED_RULESETS, { answers: {} });
  const input = plugin(proposal, "deploy");
  const before = [...input.tree.keys()];
  emit(input);
  expect([...input.tree.keys()]).toEqual(before);
});

test("the plugin manifest has a fixed key order, and user config keys name the settings", () => {
  const proposal = propose(scanOf([githubItem]), BUNDLED_RULESETS, { answers: {} });
  const emitted = emit(plugin(proposal, "mcp-github"));
  const manifest = parseJson(decode(emitted.get(".fresnel-plugin/plugin.json")));
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;
  if (typeof manifest.value !== "object" || manifest.value === null)
    throw new Error("manifest is not an object");
  expect(Object.keys(manifest.value)).toEqual([
    "schemaVersion",
    "name",
    "version",
    "purpose",
    "userConfig",
  ]);
  expect(decode(emitted.get(".fresnel-plugin/plugin.json"))).toBe(
    [
      "{",
      '  "schemaVersion": 2,',
      '  "name": "mcp-github",',
      '  "version": "0.0.0",',
      '  "purpose": "`github` MCP 서버(Claude Code에서 가져옴)",',
      '  "userConfig": {',
      '    "GITHUB_TOKEN": {',
      '      "setting": "ext.mcp-github.GITHUB_TOKEN",',
      '      "title": "GITHUB_TOKEN",',
      '      "sensitive": true,',
      '      "required": true',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
});

test("the migration record names sources and report lines with no time, no user path, and no secret value", () => {
  const proposal = propose(scanOf([deployItem]), BUNDLED_RULESETS, { answers: {} });
  const emitted = emit(plugin(proposal, "deploy"));
  const text = decode(emitted.get(".fresnel-plugin/migration.json"));
  const record = parseJson(text);
  expect(record.ok).toBe(true);
  if (!record.ok) return;
  const checked = parse(RecordSchema, record.value);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  const value = checked.value;
  expect(value.schemaVersion).toBe(1);
  expect(value.plugin).toBe("deploy");
  expect(value.rulesVersions["agent-skills"]).toBe("2026-11-17");
  expect(value.sources).toEqual([{ path: "~/.claude/skills/deploy", sha256: deployItem.sha256 }]);
  expect(value.report.some((line) => line.output?.plugin === "deploy")).toBe(true);
  expect(text).not.toContain("/Users/");
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
});

test("the MCP entry keeps only the secret reference, and the emitted files carry no literal secret", () => {
  const proposal = propose(scanOf([githubItem]), BUNDLED_RULESETS, { answers: {} });
  const emitted = emit(plugin(proposal, "mcp-github"));
  expect(decode(emitted.get("mcp.json"))).toContain('"GITHUB_TOKEN": "secret://github-token"');
  for (const bytes of emitted.values()) {
    expect(new TextDecoder().decode(bytes)).not.toContain("ghp_");
  }
});

test("a plan without migration metadata still gets a record with empty sources and report", () => {
  const plan: PlannedPlugin = {
    name: "hand-made",
    purpose: "직접 만든 계획",
    derivedFrom: [],
    tree: new Map([["instructions/01-note.md", enc("메모\n")]]),
    pendingBuilder: [],
    userConfig: [],
  };
  const emitted = emit(plan);
  expect(decode(emitted.get(".fresnel-plugin/migration.json"))).toContain('"sources": []');
  expect(decode(emitted.get(".fresnel-plugin/migration.json"))).toContain('"report": []');
});

test("migration metadata that does not match its schema is written as rejected, with nothing from it", () => {
  const proposal = propose(scanOf([deployItem]), BUNDLED_RULESETS, { answers: {} });
  const input = plugin(proposal, "deploy");
  const broken = { ...input, migration: { rulesVersions: {}, sources: "nope", report: [] } };
  const emitted = emit(broken);
  const text = decode(emitted.get(".fresnel-plugin/migration.json"));
  expect(text).toContain('"metaRejected": true');
  expect(text).toContain('"sources": []');
  expect(text).not.toContain("~/.claude/skills/deploy");
});
