// 제안 엔진 시험. 어댑터가 아직 없으므로 SourceItem을 여기서 직접 만든다. 형식은 실제 원본 파일의 모양이다.
import { expect, test } from "bun:test";
import { parse, parseJson } from "@fresnel/contracts";
import { AgentDefinitionSchema } from "@fresnel/contracts/services";
import { McpServerDefSchema } from "@fresnel/contracts/capabilities";
import { Type } from "typebox";
import { itemIdOf, sha256Hex } from "../src/hash.ts";
import { parseDocument } from "../src/frontmatter.ts";
import { bundledRulesets, type Ruleset } from "../src/rules.ts";
import { propose } from "../src/propose.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type Choices,
  type HarnessId,
  type IrAgent,
  type IrCommand,
  type IrField,
  type IrInstruction,
  type IrMcp,
  type IrNode,
  type IrSkill,
  type ItemScope,
  type MigrationProposal,
  type MigrationScan,
  type PlannedPlugin,
  type ReportLine,
  type SourceItem,
} from "../src/types.ts";

// ── 도우미 ───────────────────────────────────────────────────────────────

function bundledOrFail(): readonly Ruleset[] {
  const bundled = bundledRulesets();
  if (!bundled.ok) throw new Error(`bundled rules are invalid: ${bundled.error.source}`);
  return bundled.value;
}

const BUNDLED_RULESETS = bundledOrFail();

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

interface ItemInput {
  readonly ir: IrNode;
  readonly path: string;
  readonly keyPath?: string;
  readonly harness?: HarnessId;
  readonly scope?: ItemScope;
  readonly rootLabel?: string;
}

function itemOf(input: ItemInput): SourceItem {
  const harness = input.harness ?? "claude-code";
  const scope = input.scope ?? "user";
  const key = input.keyPath ?? input.path;
  return {
    itemId: itemIdOf([harness, input.ir.kind, scope, key]),
    harness,
    kind: input.ir.kind,
    scope,
    rootLabel: input.rootLabel ?? "home",
    path: input.path,
    ...(input.keyPath === undefined ? {} : { keyPath: input.keyPath }),
    sha256: sha256Hex(`${input.path}\u0000${key}\u0000${input.ir.kind}`),
    bytes: 0,
    ir: input.ir,
    secrets: [],
    warnings: [],
  };
}

function scanOf(items: readonly SourceItem[]): MigrationScan {
  return { roots: [], scanned: ["~/.claude"], items, diagnostics: [], limits: DEFAULT_SCAN_LIMITS };
}

const NO_ANSWERS: Choices = { answers: {} };

function pluginNamed(proposal: MigrationProposal, name: string): PlannedPlugin {
  const found = proposal.plugins.find((plugin) => plugin.name === name);
  if (found === undefined) {
    throw new Error(
      `no plugin ${name}; have ${proposal.plugins.map((plugin) => plugin.name).join(", ")}`,
    );
  }
  return found;
}

function fileOf(plugin: PlannedPlugin, path: string): Uint8Array {
  const bytes = plugin.tree.get(path);
  if (bytes === undefined) {
    throw new Error(
      `no file ${path} in ${plugin.name}; have ${[...plugin.tree.keys()].join(", ")}`,
    );
  }
  return bytes;
}

function lineOf(proposal: MigrationProposal, item: SourceItem): ReportLine {
  const found = proposal.report.find((line) => line.itemId === item.itemId);
  if (found === undefined) throw new Error(`no report line for ${item.path}`);
  return found;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// ── 표본 값 ──────────────────────────────────────────────────────────────

const DEPLOY_SKILL_MD =
  "---\nname: deploy\ndescription: Deploy the app to staging. Use when the user asks to ship a build.\nallowed-tools: Bash(git *)\n---\n\nRun ./scripts/deploy.sh and report the URL.\n";

const deployIr: IrSkill = {
  kind: "skill",
  dirName: "deploy",
  name: "deploy",
  description: "Deploy the app to staging. Use when the user asks to ship a build.",
  files: [
    { path: "SKILL.md", bytes: enc(DEPLOY_SKILL_MD) },
    { path: "scripts/deploy.sh", bytes: enc("#!/bin/sh\necho deploy\n") },
    { path: "assets/logo.bin", bytes: new Uint8Array([0, 255, 16, 0, 128]) },
  ],
};

const deployPath = "~/.claude/skills/deploy";
const deploySkillItem = itemOf({
  ir: deployIr,
  path: deployPath,
  keyPath: "deploy",
  harness: "agent-skills",
});

const allowedToolsField: IrField = {
  kind: "field",
  container: "skill",
  key: "allowed-tools",
  summary: "Bash(git *)",
};

function skillIrWith(overrides: Partial<IrSkill>): IrSkill {
  return { ...deployIr, ...overrides };
}

const LONG_DESCRIPTION = "배포 문장이다. ".repeat(150); // 1200자, 문장 끝 경계가 많다

const STDIO_GITHUB: IrMcp = {
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

const reviewerIr: IrAgent = {
  kind: "agent",
  fileName: "reviewer",
  name: "Reviewer",
  description: "Reviews diffs for correctness.",
  prompt: "You review the diff.\n\nList problems first.\n",
  tools: ["Read", "Grep", "Bash", "Glob", "Read"],
  disallowedTools: undefined,
  model: "opus",
  permissionMode: "bypassPermissions",
};

const reviewerItem = itemOf({
  ir: reviewerIr,
  path: "~/.claude/agents/reviewer.md",
  keyPath: "reviewer",
});

const deployCommandIr: IrCommand = {
  kind: "command",
  name: "deploy",
  relPath: "deploy.md",
  text: "---\ndescription: 배포한다\n---\n\n스테이징에 배포하고 주소를 알려 준다.\n",
  description: "배포한다",
  hasSubstitutions: false,
};

// ── 보고 줄과 항목 수 ─────────────────────────────────────────────────────

test("every item gets exactly one report line, and an unknown field key is no_rule", () => {
  const unknownField: IrField = {
    kind: "field",
    container: "skill",
    key: "x-future-key",
    summary: undefined,
  };
  const items = [
    deploySkillItem,
    itemOf({
      ir: unknownField,
      path: `${deployPath}/SKILL.md`,
      keyPath: "deploy.frontmatter.x-future-key",
      harness: "agent-skills",
    }),
    itemOf({
      ir: { kind: "blocked", of: "field", code: "unknown_blocked_thing", text: "x" },
      path: "~/.claude/settings.json",
    }),
  ];
  const proposal = propose(scanOf(items), BUNDLED_RULESETS, NO_ANSWERS);

  expect(proposal.report.length).toBe(items.length);
  expect(new Set(proposal.report.map((line) => line.itemId)).size).toBe(items.length);
  const unknown = lineOf(proposal, items[1] ?? deploySkillItem);
  expect(unknown.status).toBe("not_ported");
  expect(unknown.reason?.code).toBe("no_rule");
  const blocked = lineOf(proposal, items[2] ?? deploySkillItem);
  expect(blocked.reason?.code).toBe("no_rule");
});

test("a harness without a ruleset reports every item as no_rule", () => {
  const onlyClaude = BUNDLED_RULESETS.filter((ruleset) => ruleset.harness === "claude-code");
  const proposal = propose(scanOf([deploySkillItem]), onlyClaude, NO_ANSWERS);
  expect(proposal.plugins).toEqual([]);
  expect(lineOf(proposal, deploySkillItem).reason?.code).toBe("no_rule");
});

test("a known skill field is reported from the rule table, with its difference", () => {
  const field = itemOf({
    ir: allowedToolsField,
    path: `${deployPath}/SKILL.md`,
    keyPath: "deploy.frontmatter.allowed-tools",
    harness: "agent-skills",
  });
  const proposal = propose(scanOf([deploySkillItem, field]), BUNDLED_RULESETS, NO_ANSWERS);
  const line = lineOf(proposal, field);
  expect(line.status).toBe("not_ported");
  expect(line.reason?.code).toBe("skill_preapproval_unsupported");
  expect(line.differences.map((difference) => difference.kind)).toEqual(["approval_flow"]);
  expect(line.label).toBe("스킬 deploy의 머리말 allowed-tools");
  expect(line.output).toBeUndefined();
});

// ── 스킬 ─────────────────────────────────────────────────────────────────

test("a well-formed skill is copied byte for byte and reported exact", () => {
  const proposal = propose(scanOf([deploySkillItem]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "deploy");

  expect(bytesEqual(fileOf(plugin, "skills/deploy/SKILL.md"), enc(DEPLOY_SKILL_MD))).toBe(true);
  expect(
    bytesEqual(
      fileOf(plugin, "skills/deploy/assets/logo.bin"),
      new Uint8Array([0, 255, 16, 0, 128]),
    ),
  ).toBe(true);
  expect(plugin.purpose).toBe("Deploy the app to staging. Use when the user asks to ship a build.");
  expect(plugin.description).toBe(
    "Deploy the app to staging. Use when the user asks to ship a build.",
  );
  const line = lineOf(proposal, deploySkillItem);
  expect(line.status).toBe("exact");
  expect(line.differences).toEqual([]);
  expect(line.output).toEqual({ plugin: "deploy", path: "skills/deploy/SKILL.md" });
  expect(proposal.questions).toEqual([]);
});

test("a skill description over 1024 characters opens a question and drafts nothing until answered", () => {
  const item = itemOf({
    ir: skillIrWith({ description: LONG_DESCRIPTION }),
    path: deployPath,
    keyPath: "deploy",
    harness: "agent-skills",
  });
  const open = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(open.plugins).toEqual([]);
  expect(lineOf(open, item).reason?.code).toBe("question_open");
  expect(open.questions.map((question) => question.id)).toEqual([
    `skill-description:${item.itemId}`,
  ]);
  expect(open.questions[0]?.options).toEqual(["keep", "skip"]);

  const kept = propose(scanOf([item]), BUNDLED_RULESETS, {
    answers: { [`skill-description:${item.itemId}`]: "keep" },
  });
  const keptLine = lineOf(kept, item);
  expect(keptLine.status).toBe("differs");
  expect(keptLine.differences.map((difference) => difference.kind)).toEqual(["user_choice"]);
  expect(kept.questions).toEqual([]);
  expect(pluginNamed(kept, "deploy").tree.has("skills/deploy/SKILL.md")).toBe(true);

  const skipped = propose(scanOf([item]), BUNDLED_RULESETS, {
    answers: { [`skill-description:${item.itemId}`]: "skip" },
  });
  expect(lineOf(skipped, item).reason?.code).toBe("user_skipped");
  expect(skipped.plugins).toEqual([]);
});

test("a name that differs from the folder opens skill-name, and slug answers rename the plugin", () => {
  const item = itemOf({
    ir: skillIrWith({ dirName: "deploy-tool", name: "deploy" }),
    path: "~/.claude/skills/deploy-tool",
    keyPath: "deploy-tool",
    harness: "agent-skills",
  });
  const open = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(open.questions.map((question) => question.id)).toEqual([`skill-name:${item.itemId}`]);
  expect(open.questions[0]?.options).toEqual(["slug", "skip"]);
  expect(lineOf(open, item).reason?.code).toBe("question_open");

  const slugged = propose(scanOf([item]), BUNDLED_RULESETS, {
    answers: { [`skill-name:${item.itemId}`]: "slug" },
  });
  const line = lineOf(slugged, item);
  expect(line.status).toBe("differs");
  expect(line.differences.map((difference) => difference.kind)).toContain("renamed");
  expect(
    bytesEqual(
      fileOf(pluginNamed(slugged, "deploy-tool"), "skills/deploy-tool/SKILL.md"),
      enc(DEPLOY_SKILL_MD),
    ),
  ).toBe(true);
});

test("a skill without a description is not_ported with description_missing and asks nothing", () => {
  const item = itemOf({
    ir: skillIrWith({ description: undefined }),
    path: deployPath,
    keyPath: "deploy",
    harness: "agent-skills",
  });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(lineOf(proposal, item).reason?.code).toBe("description_missing");
  expect(proposal.questions).toEqual([]);
  expect(proposal.plugins).toEqual([]);
});

// ── MCP 서버 ─────────────────────────────────────────────────────────────

const githubItem = itemOf({
  ir: STDIO_GITHUB,
  path: "~/app/.mcp.json",
  keyPath: "mcpServers.github",
  scope: "project",
  rootLabel: "app",
});
const userGithubItem = itemOf({
  ir: STDIO_GITHUB,
  path: "~/.claude.json",
  keyPath: "mcpServers.github",
});

const mcpFileSchema = Type.Object({ mcpServers: Type.Record(Type.String(), Type.Unknown()) });

test("an stdio server becomes mcp.json that passes McpServerDefSchema, and its secret is a userConfig entry", () => {
  const proposal = propose(scanOf([userGithubItem]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "mcp-github");
  const json = parseJson(new TextDecoder().decode(fileOf(plugin, "mcp.json")));
  expect(json.ok).toBe(true);
  if (!json.ok) return;
  const file = parse(mcpFileSchema, json.value);
  expect(file.ok).toBe(true);
  if (!file.ok) return;
  const entry = file.value.mcpServers["github"];
  expect(parse(McpServerDefSchema, { transport: entry }).ok).toBe(true);
  expect(entry).toEqual({
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: "secret://github-token" },
  });

  expect(plugin.userConfig).toEqual([
    {
      key: "GITHUB_TOKEN",
      title: "GITHUB_TOKEN",
      sensitive: true,
      required: true,
      secretName: "github-token",
    },
  ]);
  const line = lineOf(proposal, userGithubItem);
  expect(line.status).toBe("differs");
  expect(line.differences.map((difference) => difference.kind)).toEqual(["user_choice"]);
  expect(line.output).toEqual({ plugin: "mcp-github", path: "mcp.json" });
});

test("a literal secret left in the definition is never written and makes the server not_ported", () => {
  const leaked: IrMcp = {
    kind: "mcp",
    serverName: "remote",
    id: "remote",
    transport: "http",
    def: {
      transport: {
        type: "http",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer sk-live-LEAKEDVALUE12345" },
      },
    },
    secretRefs: [],
    projectBound: false,
  };
  const item = itemOf({ ir: leaked, path: "~/.claude.json", keyPath: "mcpServers.remote" });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  const line = lineOf(proposal, item);
  expect(line.status).toBe("not_ported");
  expect(line.reason?.code).toBe("literal_secret_in_source");
  expect(proposal.plugins).toEqual([]);
  expect(JSON.stringify(proposal)).not.toContain("LEAKEDVALUE12345");
});

test("a websocket server is not_ported with mcp_ws_unsupported", () => {
  const ws: IrMcp = {
    kind: "mcp",
    serverName: "live",
    id: "live",
    transport: "ws",
    def: undefined,
    secretRefs: [],
    projectBound: false,
  };
  const item = itemOf({ ir: ws, path: "~/.claude.json", keyPath: "mcpServers.live" });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(lineOf(proposal, item).reason?.code).toBe("mcp_ws_unsupported");
  expect(proposal.plugins).toEqual([]);
});

test("a renamed server id is reported as renamed, and a project-bound server gets scope_change", () => {
  const renamed: IrMcp = {
    ...STDIO_GITHUB,
    serverName: "GitHub Server",
    id: "github-server",
    projectBound: true,
  };
  const item = itemOf({
    ir: renamed,
    path: "~/app/.mcp.json",
    keyPath: "mcpServers.GitHub Server",
    scope: "project",
    rootLabel: "app",
  });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  const line = lineOf(proposal, item);
  expect(line.differences.map((difference) => difference.kind)).toEqual([
    "renamed",
    "user_choice",
    "scope_change",
  ]);
  expect(pluginNamed(proposal, "mcp-github-server").name).toBe("mcp-github-server");
  expect(proposal.profileProposals).toEqual([
    {
      profileName: "app",
      plugins: ["mcp-github-server"],
      reason:
        "프로젝트 app의 항목을 모은 새 프로필 제안. 프로필은 사용자가 확인하기 전에는 만들지 않는다",
    },
  ]);
});

test("a project-scoped server goes to a user plugin and proposes a profile named after its root", () => {
  const proposal = propose(scanOf([githubItem]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(proposal.plugins.map((plugin) => plugin.name)).toEqual(["mcp-github"]);
  expect(proposal.profileProposals.map((profile) => profile.profileName)).toEqual(["app"]);
});

// ── 지침 ─────────────────────────────────────────────────────────────────

const USER_CLAUDE_MD = "# 작업 방식\n\n- 한국어로 답한다.\n- 변경 전에 검사한다.\n";

const userInstructionIr: IrInstruction = {
  kind: "instruction",
  name: "CLAUDE",
  text: USER_CLAUDE_MD,
  activation: "always",
  globs: [],
  role: "user_global",
  onlyAgentsMdImport: false,
  parts: [{ source: "~/.claude/CLAUDE.md", text: USER_CLAUDE_MD }],
};
const userInstructionItem = itemOf({ ir: userInstructionIr, path: "~/.claude/CLAUDE.md" });

test("a single-part user instruction is one file with the original text and no added header", () => {
  const proposal = propose(scanOf([userInstructionItem]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "claude-code-user-instructions");
  expect(plugin.tree.size).toBe(1);
  expect(new TextDecoder().decode(fileOf(plugin, "instructions/01-CLAUDE.md"))).toBe(
    USER_CLAUDE_MD,
  );
  const line = lineOf(proposal, userInstructionItem);
  expect(line.status).toBe("exact");
  expect(line.differences.map((difference) => difference.kind)).toEqual(["scope_change"]);
  expect(line.output).toEqual({
    plugin: "claude-code-user-instructions",
    path: "instructions/01-CLAUDE.md",
  });
});

test("an instruction with @imports becomes one file per part, and the parts join back to the original hash", () => {
  const partA = "# 기본\n";
  const partB = "\n## 문체\n한 문장으로 쓴다.\n";
  const joined = partA + partB;
  const ir: IrInstruction = {
    ...userInstructionIr,
    text: joined,
    parts: [
      { source: "~/.claude/CLAUDE.md", text: partA },
      { source: "~/.claude/style.md", text: partB },
    ],
  };
  const item = itemOf({ ir, path: "~/.claude/CLAUDE.md" });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "claude-code-user-instructions");

  expect([...plugin.tree.keys()].toSorted()).toEqual([
    "instructions/01-CLAUDE.md",
    "instructions/02-style.md",
  ]);
  const first = fileOf(plugin, "instructions/01-CLAUDE.md");
  const second = fileOf(plugin, "instructions/02-style.md");
  const rejoined = new Uint8Array([...first, ...second]);
  expect(sha256Hex(rejoined)).toBe(sha256Hex(enc(joined)));
});

test("a project CLAUDE.md that only imports AGENTS.md is not_needed, and a full one is not_ported with the copy alternative", () => {
  const onlyImport: IrInstruction = {
    ...userInstructionIr,
    name: "CLAUDE",
    role: "project_file",
    onlyAgentsMdImport: true,
    text: "@AGENTS.md\n",
    parts: [{ source: "CLAUDE.md", text: "@AGENTS.md\n" }],
  };
  const full: IrInstruction = {
    ...onlyImport,
    onlyAgentsMdImport: false,
    text: "# 프로젝트 규칙\n",
    parts: [{ source: "CLAUDE.md", text: "# 프로젝트 규칙\n" }],
  };
  const importItem = itemOf({
    ir: onlyImport,
    path: "~/app/CLAUDE.md",
    scope: "project",
    rootLabel: "app",
  });
  const fullItem = itemOf({
    ir: full,
    path: "~/app/.claude/CLAUDE.md",
    scope: "project",
    rootLabel: "app",
  });
  const proposal = propose(scanOf([importItem, fullItem]), BUNDLED_RULESETS, NO_ANSWERS);

  expect(lineOf(proposal, importItem).status).toBe("not_needed");
  const fullLine = lineOf(proposal, fullItem);
  expect(fullLine.status).toBe("not_ported");
  expect(fullLine.reason?.code).toBe("not_read_by_fresnel");
  expect(fullLine.alternative).toContain("AGENTS.md");
  expect(proposal.plugins).toEqual([]);
});

test("an AGENTS.md is not_needed and a conditional rule is not_ported with conditional_rule", () => {
  const agentsMd: IrInstruction = {
    ...userInstructionIr,
    name: "AGENTS",
    role: "agents_md",
    text: "# 저장소 안내\n",
    parts: [{ source: "AGENTS.md", text: "# 저장소 안내\n" }],
  };
  const globbed: IrInstruction = {
    ...userInstructionIr,
    name: "ts",
    role: "rule",
    activation: "globs",
    globs: ["**/*.ts"],
    text: "타입을 쓴다.\n",
    parts: [{ source: "~/.claude/rules/ts.md", text: "타입을 쓴다.\n" }],
  };
  const agentsItem = itemOf({
    ir: agentsMd,
    path: "~/app/AGENTS.md",
    harness: "agents-md",
    scope: "project",
    rootLabel: "app",
  });
  const globItem = itemOf({ ir: globbed, path: "~/.claude/rules/ts.md" });
  const proposal = propose(scanOf([agentsItem, globItem]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(lineOf(proposal, agentsItem).status).toBe("not_needed");
  expect(lineOf(proposal, globItem).reason?.code).toBe("conditional_rule_deferred");
  expect(proposal.plugins).toEqual([]);
});

test("a project rule goes to a user plugin with a project-named profile proposal", () => {
  const ruleIr: IrInstruction = {
    ...userInstructionIr,
    name: "style",
    role: "rule",
    text: "들여쓰기는 두 칸이다.\n",
    parts: [{ source: ".claude/rules/style.md", text: "들여쓰기는 두 칸이다.\n" }],
  };
  const item = itemOf({
    ir: ruleIr,
    path: "~/app/.claude/rules/style.md",
    scope: "project",
    rootLabel: "app",
  });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "claude-code-project-instructions");
  expect(new TextDecoder().decode(fileOf(plugin, "instructions/01-style.md"))).toBe(
    "들여쓰기는 두 칸이다.\n",
  );
  expect(proposal.profileProposals.map((profile) => profile.profileName)).toEqual(["app"]);
  expect(proposal.profileProposals[0]?.plugins).toEqual(["claude-code-project-instructions"]);
});

// ── 서브에이전트 ─────────────────────────────────────────────────────────

test("an agent maps tools, drops unknown ones, drops the model unless asked, and maps bypass", () => {
  const proposal = propose(scanOf([reviewerItem]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "claude-code-user-agents");
  const text = new TextDecoder().decode(fileOf(plugin, "agents/reviewer.md"));
  const parsed = parseDocument(text);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.frontmatter.get("tools")).toEqual(["read", "grep", "bash"]);
  expect(parsed.value.frontmatter.has("model")).toBe(false);
  expect(parsed.value.frontmatter.get("permissions")).toEqual({ mode: "bypass" });
  expect(parsed.value.body).toBe("You review the diff.\n\nList problems first.\n");

  const line = lineOf(proposal, reviewerItem);
  expect(line.status).toBe("differs");
  expect(line.differences.map((difference) => difference.kind)).toEqual([
    "renamed",
    "semantic_loss",
    "user_choice",
    "approval_flow",
  ]);
  expect(proposal.questions.map((question) => question.id)).toEqual([
    `agent-model:${reviewerItem.itemId}`,
  ]);
});

test("the agent file parses as an AgentDefinition, and a model answer keeps the model", () => {
  const proposal = propose(scanOf([reviewerItem]), BUNDLED_RULESETS, {
    answers: { [`agent-model:${reviewerItem.itemId}`]: "opus" },
  });
  const plugin = pluginNamed(proposal, "claude-code-user-agents");
  const parsed = parseDocument(new TextDecoder().decode(fileOf(plugin, "agents/reviewer.md")));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const definition = parse(AgentDefinitionSchema, {
    ...Object.fromEntries(parsed.value.frontmatter),
    prompt: parsed.value.body,
  });
  expect(definition.ok).toBe(true);
  if (!definition.ok) return;
  expect(definition.value.name).toBe("reviewer");
  expect(definition.value.model).toBe("opus");
  expect(definition.value.tools).toEqual(["read", "grep", "bash"]);
  expect(proposal.questions).toEqual([]);
});

test("a long agent description opens a question, and truncate cuts at a sentence boundary within 1000 characters", () => {
  const long: IrAgent = {
    ...reviewerIr,
    description: "설명 문장이다. ".repeat(150),
    model: undefined,
  };
  const item = itemOf({ ir: long, path: "~/.claude/agents/reviewer.md", keyPath: "reviewer" });
  const open = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(open.plugins).toEqual([]);
  expect(lineOf(open, item).reason?.code).toBe("question_open");

  const truncated = propose(scanOf([item]), BUNDLED_RULESETS, {
    answers: { [`agent-description:${item.itemId}`]: "truncate" },
  });
  const plugin = pluginNamed(truncated, "claude-code-user-agents");
  const parsed = parseDocument(new TextDecoder().decode(fileOf(plugin, "agents/reviewer.md")));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const description = parsed.value.frontmatter.get("description");
  expect(typeof description).toBe("string");
  if (typeof description !== "string") return;
  expect(Array.from(description).length).toBeLessThanOrEqual(1000);
  expect(description.endsWith("다.")).toBe(true);
  expect(lineOf(truncated, item).differences.map((difference) => difference.kind)).toContain(
    "user_choice",
  );
});

test("a plan permissionMode and disallowedTools are not carried and are said so", () => {
  const planned: IrAgent = {
    ...reviewerIr,
    name: "planner",
    fileName: "planner",
    model: undefined,
    tools: undefined,
    disallowedTools: ["Write"],
    permissionMode: "plan",
  };
  const item = itemOf({ ir: planned, path: "~/.claude/agents/planner.md", keyPath: "planner" });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  const plugin = pluginNamed(proposal, "claude-code-user-agents");
  const parsed = parseDocument(new TextDecoder().decode(fileOf(plugin, "agents/planner.md")));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.frontmatter.has("permissions")).toBe(false);
  expect(parsed.value.frontmatter.has("tools")).toBe(false);
  const kinds = lineOf(proposal, item).differences.map((difference) => difference.kind);
  expect(kinds.filter((kind) => kind === "semantic_loss").length).toBe(2);
});

// ── 명령 ─────────────────────────────────────────────────────────────────

test("a command without substitutions is copied byte for byte, and one with substitutions is not_ported", () => {
  const plain = itemOf({
    ir: deployCommandIr,
    path: "~/.claude/commands/deploy.md",
    keyPath: "deploy",
  });
  const substituted: IrCommand = {
    ...deployCommandIr,
    name: "echo",
    relPath: "echo.md",
    text: "말한다: $ARGUMENTS\n",
    hasSubstitutions: true,
  };
  const subItem = itemOf({ ir: substituted, path: "~/.claude/commands/echo.md", keyPath: "echo" });
  const proposal = propose(scanOf([plain, subItem]), BUNDLED_RULESETS, NO_ANSWERS);

  const plugin = pluginNamed(proposal, "claude-code-user-commands");
  expect(bytesEqual(fileOf(plugin, "commands/deploy.md"), enc(deployCommandIr.text))).toBe(true);
  expect(lineOf(proposal, plain).status).toBe("exact");
  expect(lineOf(proposal, subItem).reason?.code).toBe("command_args_unspecified");
  expect(proposal.plugins.map((entry) => entry.name)).toEqual(["claude-code-user-commands"]);
});

test("a flattened command name is reported renamed", () => {
  const nested: IrCommand = {
    ...deployCommandIr,
    name: "frontend-component",
    relPath: "frontend/component.md",
  };
  const item = itemOf({
    ir: nested,
    path: "~/.claude/commands/frontend/component.md",
    keyPath: "frontend-component",
  });
  const proposal = propose(scanOf([item]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(lineOf(proposal, item).differences.map((difference) => difference.kind)).toContain(
    "renamed",
  );
});

// ── 이름 충돌, 질문 순서, 결정성 ─────────────────────────────────────────

test("two skills with the same folder name in different roots get a suffix, and existing plugins are avoided", () => {
  const projectCopy = itemOf({
    ir: deployIr,
    path: "~/app/.claude/skills/deploy",
    keyPath: "deploy",
    harness: "agent-skills",
    scope: "project",
    rootLabel: "app",
  });
  const proposal = propose(scanOf([deploySkillItem, projectCopy]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(proposal.plugins.map((plugin) => plugin.name)).toEqual(["deploy", "deploy-2"]);
  expect(lineOf(proposal, projectCopy).output?.plugin).toBe("deploy-2");

  const avoided = propose(scanOf([deploySkillItem]), BUNDLED_RULESETS, {
    answers: {},
    existingPlugins: ["deploy"],
  });
  expect(avoided.plugins.map((plugin) => plugin.name)).toEqual(["deploy-2"]);
});

test("questions come out in item order", () => {
  const longSkill = itemOf({
    ir: skillIrWith({ name: "deploy", description: LONG_DESCRIPTION, dirName: "deploy" }),
    path: "~/.claude/skills/deploy",
    keyPath: "deploy",
    harness: "agent-skills",
  });
  const reviewer = reviewerItem;
  const proposal = propose(scanOf([longSkill, reviewer]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(proposal.questions.map((question) => question.id)).toEqual([
    `skill-description:${longSkill.itemId}`,
    `agent-model:${reviewer.itemId}`,
  ]);
});

test("the same input and answers give the same plugins, files, and report", () => {
  const scan = scanOf([deploySkillItem, githubItem, userInstructionItem, reviewerItem]);
  const first = propose(scan, BUNDLED_RULESETS, NO_ANSWERS);
  const second = propose(scan, BUNDLED_RULESETS, NO_ANSWERS);

  expect(JSON.stringify(first.report)).toBe(JSON.stringify(second.report));
  expect(first.plugins.map((plugin) => plugin.name)).toEqual(
    second.plugins.map((plugin) => plugin.name),
  );
  for (const plugin of first.plugins) {
    const other = pluginNamed(second, plugin.name);
    expect([...plugin.tree.keys()]).toEqual([...other.tree.keys()]);
    for (const [path, bytes] of plugin.tree) {
      expect(bytesEqual(bytes, fileOf(other, path))).toBe(true);
    }
  }
  expect(JSON.stringify(first.profileProposals)).toBe(JSON.stringify(second.profileProposals));
});

test("no output carries a user's absolute home path or the secret value", () => {
  const proposal = propose(
    scanOf([githubItem, userGithubItem, deploySkillItem]),
    BUNDLED_RULESETS,
    NO_ANSWERS,
  );
  const everything = JSON.stringify(proposal, (_key, value: unknown) =>
    value instanceof Uint8Array ? new TextDecoder().decode(value) : value,
  );
  expect(everything).not.toContain("/Users/");
  expect(everything).not.toContain("ghp_");
});

test("blocked items map to their rule by code", () => {
  const settings: SourceItem = itemOf({
    ir: { kind: "blocked", of: "field", code: "settings_file", text: "설정 파일" },
    path: "~/.claude/settings.json",
  });
  const bundle: SourceItem = itemOf({
    ir: { kind: "blocked", of: "field", code: "plugin_bundle", text: "묶음" },
    path: "~/.claude/plugins/bundle",
  });
  const proposal = propose(scanOf([settings, bundle]), BUNDLED_RULESETS, NO_ANSWERS);
  expect(lineOf(proposal, settings).reason?.code).toBe("later_piece");
  expect(lineOf(proposal, bundle).reason?.text).toContain("조각 4");
  expect(lineOf(proposal, settings).label).toBe("설정 settings.json");
});
