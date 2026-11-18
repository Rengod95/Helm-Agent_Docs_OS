import { describe, expect, test } from "bun:test";
import { claudeCodeAdapter } from "../src/adapters/claude-code.ts";
import { sha256Hex } from "../src/hash.ts";
import {
  DEFAULT_SCAN_LIMITS,
  type IrAgent,
  type IrBlocked,
  type IrCommand,
  type IrField,
  type IrInstruction,
  type ScanFs,
  type ScanLimits,
  type ScanRoot,
  type SourceItem,
} from "../src/types.ts";
import { memoryFs, type MemoryEntry } from "./support.ts";

// 시험용 가짜 값. 소스에 한 덩어리로 두지 않아 비밀 검사에 걸리지 않는다.
const FAKE_TOKEN = ["sk", "live-ABCDEFGH12345678"].join("-");

const HOME = "/home/sample";
const CLAUDE = `${HOME}/.claude`;
const APP = `${HOME}/work/app`;
const ctx = { homeDir: HOME };
const USER: ScanRoot = { path: HOME, scope: "user", label: "user" };
const PROJECT: ScanRoot = { path: APP, scope: "project", label: "app" };

type Files = Readonly<Record<string, MemoryEntry>>;

function scanWith(root: ScanRoot, files: Files, limits: ScanLimits = DEFAULT_SCAN_LIMITS) {
  return claudeCodeAdapter.scan(root, memoryFs(files), limits, ctx);
}

/** 항목 하나를 자리로 찾는다. 같은 자리가 둘이면 시험이 실패하도록 던진다 */
function find(items: readonly SourceItem[], path: string, keyPath?: string): SourceItem {
  const [first, ...rest] = items.filter((item) => item.path === path && item.keyPath === keyPath);
  if (first === undefined || rest.length > 0) {
    throw new Error(`expected exactly one item at ${path} ${keyPath ?? ""}`);
  }
  return first;
}

function instructionOf(item: SourceItem): IrInstruction {
  if (item.ir.kind !== "instruction") throw new Error(`expected instruction, got ${item.ir.kind}`);
  return item.ir;
}

function commandOf(item: SourceItem): IrCommand {
  if (item.ir.kind !== "command") throw new Error(`expected command, got ${item.ir.kind}`);
  return item.ir;
}

function agentOf(item: SourceItem): IrAgent {
  if (item.ir.kind !== "agent") throw new Error(`expected agent, got ${item.ir.kind}`);
  return item.ir;
}

function fieldIrOf(item: SourceItem): IrField {
  if (item.ir.kind !== "field") throw new Error(`expected field, got ${item.ir.kind}`);
  return item.ir;
}

function blockedOf(item: SourceItem): IrBlocked {
  if (item.ir.kind !== "blocked") throw new Error(`expected blocked, got ${item.ir.kind}`);
  return item.ir;
}

/** 블록 항목을 (키 경로, 코드, 텍스트) 세 값으로 줄인다. 값 비교에 쓴다 */
function blockedRows(items: readonly SourceItem[]): readonly (readonly string[])[] {
  return items
    .filter((item) => item.ir.kind === "blocked")
    .map((item) => {
      const ir = blockedOf(item);
      return [item.keyPath ?? "", ir.code, ir.text];
    });
}

describe("claude-code: 사용자 지침의 가져오기", () => {
  test("가져온 파일은 자리에서 쪼개지고 토큰은 사라진다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/CLAUDE.md`]: "Intro\n@docs/style.md\nOutro\n",
      [`${CLAUDE}/docs/style.md`]: "Style rule\n",
    });

    expect(result.diagnostics).toEqual([]);
    const item = find(result.items, "~/.claude/CLAUDE.md");
    expect(item.kind).toBe("instruction");
    expect(item.scope).toBe("user");
    expect(item.harness).toBe("claude-code");
    expect(item.sha256).toBe(sha256Hex("Intro\n@docs/style.md\nOutro\n"));
    expect(item.bytes).toBe("Intro\n@docs/style.md\nOutro\n".length);

    const ir = instructionOf(item);
    expect(ir.name).toBe("CLAUDE");
    expect(ir.role).toBe("user_global");
    expect(ir.activation).toBe("always");
    expect(ir.globs).toEqual([]);
    expect(ir.onlyAgentsMdImport).toBe(false);
    expect(ir.text).toBe("Intro\nStyle rule\n\nOutro\n");
    expect(ir.parts).toEqual([
      { source: ".claude/CLAUDE.md", text: "Intro\n" },
      { source: ".claude/docs/style.md", text: "Style rule\n" },
      { source: ".claude/CLAUDE.md", text: "\nOutro\n" },
    ]);
  });

  test("깊이 4까지는 풀고, 5단계째 가져오기는 글자 그대로 남아 차단 항목이 된다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/CLAUDE.md`]: "@d1.md",
      [`${CLAUDE}/d1.md`]: "L1\n@d2.md",
      [`${CLAUDE}/d2.md`]: "L2\n@d3.md",
      [`${CLAUDE}/d3.md`]: "L3\n@d4.md",
      [`${CLAUDE}/d4.md`]: "L4\n@d5.md",
      [`${CLAUDE}/d5.md`]: "L5",
    });

    const ir = instructionOf(find(result.items, "~/.claude/CLAUDE.md"));
    expect(ir.text).toBe("L1\nL2\nL3\nL4\n@d5.md");
    expect(ir.parts.map((part) => part.source)).toEqual([
      ".claude/d1.md",
      ".claude/d2.md",
      ".claude/d3.md",
      ".claude/d4.md",
    ]);
    expect(blockedRows(result.items)).toEqual([
      [".claude/d4.md.import.@d5.md", "import_too_deep", "@d5.md"],
    ]);
    expect(find(result.items, "~/.claude/d4.md", ".claude/d4.md.import.@d5.md").path).toBe(
      "~/.claude/d4.md",
    );
  });

  test("루트 밖과 없는 파일은 글자 그대로 남고, 이메일과 @me는 가져오기가 아니다", async () => {
    const text = "See @../../etc/x.md\nMail a@b.com and @me\nSee @missing/none.md\n";
    const result = await scanWith(USER, { [`${CLAUDE}/CLAUDE.md`]: text });

    const ir = instructionOf(find(result.items, "~/.claude/CLAUDE.md"));
    expect(ir.text).toBe(text);
    expect(ir.parts).toEqual([{ source: ".claude/CLAUDE.md", text }]);
    expect(blockedRows(result.items)).toEqual([
      [".claude/CLAUDE.md.import.@../../etc/x.md", "import_outside_root", "@../../etc/x.md"],
      [".claude/CLAUDE.md.import.@missing/none.md", "import_missing", "@missing/none.md"],
    ]);
  });

  test("코드 펜스와 인라인 백틱 안의 토큰은 가져오지 않는다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/CLAUDE.md`]: "```\n@docs/in-fence.md\n```\n`@docs/in-code.md` and @docs/real.md",
      [`${CLAUDE}/docs/real.md`]: "REAL",
    });

    const ir = instructionOf(find(result.items, "~/.claude/CLAUDE.md"));
    expect(ir.text).toBe("```\n@docs/in-fence.md\n```\n`@docs/in-code.md` and REAL");
    expect(ir.parts).toEqual([
      { source: ".claude/CLAUDE.md", text: "```\n@docs/in-fence.md\n```\n`@docs/in-code.md` and " },
      { source: ".claude/docs/real.md", text: "REAL" },
    ]);
    expect(blockedRows(result.items)).toEqual([]);
  });

  test("같은 토큰이 여러 번이면 차단 항목은 한 번만 낸다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/CLAUDE.md`]: "@../../x.md and @../../x.md",
    });
    expect(blockedRows(result.items)).toEqual([
      [".claude/CLAUDE.md.import.@../../x.md", "import_outside_root", "@../../x.md"],
    ]);
  });

  test("가운데 폴더가 심볼릭 링크라 루트 밖을 가리키면 가져오지 않는다", async () => {
    const files: Files = {
      [`${APP}/.claude/rules/x.md`]: "@../../linked/secret.md\n",
      [`${APP}/linked/secret.md`]: "SECRET\n",
    };
    const base = memoryFs(files);
    const fs: ScanFs = {
      ...base,
      realpath: (path: string) =>
        Promise.resolve(path.includes("/linked/") ? "/elsewhere/secret.md" : path),
    };
    const result = await claudeCodeAdapter.scan(PROJECT, fs, DEFAULT_SCAN_LIMITS, ctx);

    expect(blockedRows(result.items)).toEqual([
      [
        ".claude/rules/x.md.import.@../../linked/secret.md",
        "import_outside_root",
        "@../../linked/secret.md",
      ],
    ]);
    expect(JSON.stringify(result.items)).not.toContain("SECRET");
  });
});

describe("claude-code: 규칙", () => {
  test("머리말이 없으면 항상 싣고, paths가 있으면 조건 규칙이며 본문만 싣는다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/rules/plain.md`]: "Always rule\n",
      [`${CLAUDE}/rules/web/ts.md`]:
        '---\npaths:\n  - "src/**/*.ts"\n  - web/**\n---\n# TS rules\n',
    });

    const plain = instructionOf(find(result.items, "~/.claude/rules/plain.md"));
    expect(plain).toEqual({
      kind: "instruction",
      name: "plain",
      text: "Always rule\n",
      activation: "always",
      globs: [],
      role: "rule",
      onlyAgentsMdImport: false,
      parts: [{ source: ".claude/rules/plain.md", text: "Always rule\n" }],
    });

    const ts = find(result.items, "~/.claude/rules/web/ts.md");
    expect(instructionOf(ts)).toEqual({
      kind: "instruction",
      name: "web-ts",
      text: "# TS rules\n",
      activation: "globs",
      globs: ["src/**/*.ts", "web/**"],
      role: "rule",
      onlyAgentsMdImport: false,
      parts: [{ source: ".claude/rules/web/ts.md", text: "# TS rules\n" }],
    });
  });

  test("머리말이 깨진 규칙은 진단을 내고 원문 전체를 항상 싣는다", async () => {
    const text = "---\n  bad: x\n---\nBODY\n";
    const result = await scanWith(USER, { [`${CLAUDE}/rules/broken.md`]: text });

    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["invalid_frontmatter", "~/.claude/rules/broken.md"],
    ]);
    const ir = instructionOf(find(result.items, "~/.claude/rules/broken.md"));
    expect(ir.text).toBe(text);
    expect(ir.activation).toBe("always");
    expect(ir.globs).toEqual([]);
  });

  test("프로젝트 규칙도 가져오기를 풀고 조각은 프로젝트 기준 경로다", async () => {
    const result = await scanWith(PROJECT, {
      [`${APP}/.claude/rules/r.md`]: "Rule @../shared.md\n",
      [`${APP}/.claude/shared.md`]: "SHARED\n",
    });

    const ir = instructionOf(find(result.items, "~/work/app/.claude/rules/r.md"));
    expect(ir.text).toBe("Rule SHARED\n\n");
    expect(ir.parts).toEqual([
      { source: ".claude/rules/r.md", text: "Rule " },
      { source: ".claude/shared.md", text: "SHARED\n" },
      { source: ".claude/rules/r.md", text: "\n" },
    ]);
    expect(find(result.items, "~/work/app/.claude/rules/r.md").scope).toBe("project");
  });
});

describe("claude-code: 명령", () => {
  test("이름 공간은 하이픈으로 평탄화되고 description 밖의 머리말 키는 field 항목이 된다", async () => {
    const text =
      "---\ndescription: Make a component\nargument-hint: <name>\nallowed-tools: Read\n---\nCreate $ARGUMENTS now\n";
    const result = await scanWith(USER, { [`${CLAUDE}/commands/frontend/component.md`]: text });

    const command = commandOf(find(result.items, "~/.claude/commands/frontend/component.md"));
    expect(command).toEqual({
      kind: "command",
      name: "frontend-component",
      relPath: "frontend/component.md",
      text,
      description: "Make a component",
      hasSubstitutions: true,
    });

    const fields = result.items
      .filter((item) => item.ir.kind === "field")
      .map((item) => {
        const ir = fieldIrOf(item);
        return [item.keyPath, ir.container, ir.key, ir.summary];
      });
    expect(fields).toEqual([
      ["frontend/component.md.frontmatter.allowed-tools", "command", "allowed-tools", "Read"],
      ["frontend/component.md.frontmatter.argument-hint", "command", "argument-hint", "<name>"],
    ]);
  });

  test("치환이 없는 명령과 코드 펜스 안의 치환은 세지 않는다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/commands/plain.md`]: "Say hi\n",
      [`${CLAUDE}/commands/money.md`]: "Costs $ 3 and $!\n",
      [`${CLAUDE}/commands/fenced.md`]: "```\n$ARGUMENTS\n```\nNo args\n",
      [`${CLAUDE}/commands/shell.md`]: "Status: !`git status`\n",
      [`${CLAUDE}/commands/numbered.md`]: "Use $1 here\n",
    });

    const flags = ["plain", "money", "fenced", "shell", "numbered"].map((name) => {
      const command = commandOf(find(result.items, `~/.claude/commands/${name}.md`));
      return [command.name, command.hasSubstitutions, command.description];
    });
    expect(flags).toEqual([
      ["plain", false, undefined],
      ["money", false, undefined],
      ["fenced", false, undefined],
      ["shell", true, undefined],
      ["numbered", true, undefined],
    ]);
  });
});

describe("claude-code: 서브에이전트", () => {
  test("머리말 키마다 IR 값과 field 항목이 맞는다", async () => {
    const text = [
      "---",
      "name: reviewer",
      "description: Reviews code",
      "tools: Read, Grep, Bash",
      "disallowedTools: Write, Edit",
      "model: sonnet",
      "permissionMode: plan",
      "maxTurns: 12",
      "skills:",
      "  - lint",
      "hooks:",
      "  PreToolUse:",
      "    command: echo hi",
      "memory: user",
      "color: blue",
      "api_key: abc",
      "---",
      "You review code.",
      "",
    ].join("\n");
    const result = await scanWith(USER, { [`${CLAUDE}/agents/reviewer.md`]: text });

    expect(agentOf(find(result.items, "~/.claude/agents/reviewer.md"))).toEqual({
      kind: "agent",
      fileName: "reviewer",
      name: "reviewer",
      description: "Reviews code",
      prompt: "You review code.\n",
      tools: ["Read", "Grep", "Bash"],
      disallowedTools: ["Write", "Edit"],
      model: "sonnet",
      permissionMode: "plan",
    });

    const fields = result.items
      .filter((item) => item.ir.kind === "field")
      .map((item) => {
        const ir = fieldIrOf(item);
        return [item.keyPath, ir.container, ir.key, ir.summary];
      });
    expect(fields).toEqual([
      ["reviewer.md.frontmatter.api_key", "agent", "api_key", undefined],
      ["reviewer.md.frontmatter.color", "agent", "color", "blue"],
      ["reviewer.md.frontmatter.disallowedTools", "agent", "disallowedTools", "Write, Edit"],
      ["reviewer.md.frontmatter.hooks", "agent", "hooks", undefined],
      ["reviewer.md.frontmatter.maxTurns", "agent", "maxTurns", "12"],
      ["reviewer.md.frontmatter.memory", "agent", "memory", "user"],
      ["reviewer.md.frontmatter.permissionMode", "agent", "permissionMode", "plan"],
      ["reviewer.md.frontmatter.skills", "agent", "skills", undefined],
    ]);
  });

  test("배열 tools와 표준 권한 모드는 field 항목을 내지 않는다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/agents/arr.md`]:
        "---\ndescription: Arr\ntools: [Read, Glob]\nmodel: haiku\npermissionMode: bypassPermissions\n---\nBody\n",
    });

    expect(agentOf(find(result.items, "~/.claude/agents/arr.md"))).toEqual({
      kind: "agent",
      fileName: "arr",
      name: undefined,
      description: "Arr",
      prompt: "Body\n",
      tools: ["Read", "Glob"],
      disallowedTools: undefined,
      model: "haiku",
      permissionMode: "bypassPermissions",
    });
    expect(result.items.map((item) => item.kind)).toEqual(["agent"]);
  });

  test("머리말이 깨졌거나 없으면 진단을 내고 원문 전체를 본문으로 둔다", async () => {
    const broken = "---\n  bad: x\n---\nPrompt body\n";
    const plain = "Just text\n";
    const result = await scanWith(USER, {
      [`${CLAUDE}/agents/broken.md`]: broken,
      [`${CLAUDE}/agents/nofm.md`]: plain,
    });

    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "invalid_frontmatter",
      "invalid_frontmatter",
    ]);
    expect(agentOf(find(result.items, "~/.claude/agents/broken.md"))).toEqual({
      kind: "agent",
      fileName: "broken",
      name: undefined,
      description: undefined,
      prompt: broken,
      tools: undefined,
      disallowedTools: undefined,
      model: undefined,
      permissionMode: undefined,
    });
    expect(agentOf(find(result.items, "~/.claude/agents/nofm.md")).prompt).toBe(plain);
  });
});

describe("claude-code: 설정 파일", () => {
  test("settings.json은 최상위 키마다 차단 항목을 내고 값은 어디에도 남지 않는다", async () => {
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: `echo ${FAKE_TOKEN}` }],
          },
        ],
      },
      permissions: { allow: ["Bash(npm test)"] },
      env: { OPENAI_KEY: FAKE_TOKEN },
      outputStyle: "Explanatory",
      futureKey: 1,
      enabledPlugins: { "x@y": true },
    };
    const result = await scanWith(USER, {
      [`${CLAUDE}/settings.json`]: JSON.stringify(settings),
    });

    expect(blockedRows(result.items)).toEqual([
      ["settings.enabledPlugins", "plugin_bundle", "enabledPlugins"],
      ["settings.env", "settings_known", "env"],
      ["settings.futureKey", "settings_key", "futureKey"],
      ["settings.outputStyle", "output_style", "outputStyle"],
      ["settings.permissions", "permissions", "permissions"],
    ]);
    expect(find(result.items, "~/.claude/settings.json", "settings.env").scope).toBe("user");
    const serialized = JSON.stringify(result.items);
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("Explanatory");
    expect(serialized).not.toContain("echo");
  });

  test("settings.local.json은 local 범위로 낸다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/settings.local.json`]:
        '{"apiKeyHelper": "./get-key.sh", "statusLine": {"type": "command"}}',
    });
    expect(blockedRows(result.items)).toEqual([
      ["settings.apiKeyHelper", "settings_known", "apiKeyHelper"],
      ["settings.statusLine", "settings_known", "statusLine"],
    ]);
    expect(result.items.map((item) => item.scope)).toEqual(["local", "local"]);
  });

  test("깨진 JSON은 진단 하나이고 항목은 없다", async () => {
    const result = await scanWith(USER, { [`${CLAUDE}/settings.json`]: '{ "hooks": ' });
    expect(result.items).toEqual([]);
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["invalid_json", "~/.claude/settings.json"],
    ]);
  });
});

describe("claude-code: 프로젝트 범위", () => {
  test("CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md, AGENTS.md를 가려서 낸다", async () => {
    const result = await scanWith(PROJECT, {
      [`${APP}/CLAUDE.md`]: "@AGENTS.md\n",
      [`${APP}/CLAUDE.local.md`]: "My local notes\n",
      [`${APP}/.claude/CLAUDE.md`]: "Dot claude @docs/x.md\n",
      [`${APP}/.claude/plugins/p/plugin.json`]: "{}",
      [`${APP}/AGENTS.md`]: "Agent rules\n",
    });

    const root = instructionOf(find(result.items, "~/work/app/CLAUDE.md"));
    expect(root).toEqual({
      kind: "instruction",
      name: "CLAUDE",
      text: "@AGENTS.md\n",
      activation: "always",
      globs: [],
      role: "project_file",
      onlyAgentsMdImport: true,
      parts: [{ source: "CLAUDE.md", text: "@AGENTS.md\n" }],
    });
    expect(find(result.items, "~/work/app/CLAUDE.md").scope).toBe("project");

    const local = find(result.items, "~/work/app/CLAUDE.local.md");
    expect(local.scope).toBe("local");
    expect(instructionOf(local).name).toBe("CLAUDE.local");
    expect(instructionOf(local).onlyAgentsMdImport).toBe(false);

    const dot = find(result.items, "~/work/app/.claude/CLAUDE.md");
    expect(dot.scope).toBe("project");
    expect(instructionOf(dot).role).toBe("project_file");
    expect(instructionOf(dot).parts).toEqual([
      { source: ".claude/CLAUDE.md", text: "Dot claude @docs/x.md\n" },
    ]);

    const agents = find(result.items, "~/work/app/AGENTS.md");
    expect(agents.harness).toBe("agents-md");
    expect(instructionOf(agents)).toEqual({
      kind: "instruction",
      name: "AGENTS",
      text: "Agent rules\n",
      activation: "always",
      globs: [],
      role: "agents_md",
      onlyAgentsMdImport: false,
      parts: [{ source: "AGENTS.md", text: "Agent rules\n" }],
    });

    // 프로젝트 지침의 가져오기와 플러그인 폴더는 읽지 않는다
    expect(blockedRows(result.items)).toEqual([]);
    expect(result.items.some((item) => item.path.includes("plugins"))).toBe(false);
  });

  test("일반 CLAUDE.md는 onlyAgentsMdImport가 거짓이다", async () => {
    const result = await scanWith(PROJECT, { [`${APP}/CLAUDE.md`]: "Project notes\n" });
    expect(instructionOf(find(result.items, "~/work/app/CLAUDE.md")).onlyAgentsMdImport).toBe(
      false,
    );
  });
});

describe("claude-code: 스킬과 나머지 위치", () => {
  test("스킬 폴더는 scanSkillsDir로 읽고 harness는 claude-code다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/skills/deploy/SKILL.md`]:
        "---\nname: deploy\ndescription: Deploy app\n---\nBody\n",
    });
    const skill = find(result.items, "~/.claude/skills/deploy", "deploy");
    expect(skill.kind).toBe("skill");
    expect(skill.harness).toBe("claude-code");
    expect(skill.scope).toBe("user");
    expect(result.scanned).toEqual(["~/.claude/skills"]);
  });

  test("출력 스타일은 파일마다, 플러그인 폴더는 존재만 차단 항목으로 낸다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/output-styles/terse.md`]: "Be terse\n",
      [`${CLAUDE}/plugins/acme/plugin.json`]: "{}",
    });
    expect(
      result.items.map((item) => [item.path, blockedOf(item).code, blockedOf(item).text]),
    ).toEqual([
      ["~/.claude/output-styles/terse.md", "output_style", "terse.md"],
      ["~/.claude/plugins", "plugin_bundle", "설치된 Claude Code 플러그인"],
    ]);
    expect(result.scanned).toEqual(["~/.claude/output-styles", "~/.claude/plugins"]);
  });
});

describe("claude-code: 결정성과 식별자", () => {
  test("같은 입력을 두 번 훑으면 결과가 같고, 내용이 바뀌어도 itemId는 같다", async () => {
    const before: Files = {
      [`${CLAUDE}/CLAUDE.md`]: "Top\n@docs/x.md\n",
      [`${CLAUDE}/docs/x.md`]: "X1\n",
      [`${CLAUDE}/rules/a.md`]: "A1\n",
      [`${CLAUDE}/commands/b.md`]: "B1\n",
    };
    const first = await scanWith(USER, before);
    const second = await scanWith(USER, before);
    expect(second).toEqual(first);

    const after = await scanWith(USER, {
      ...before,
      [`${CLAUDE}/rules/a.md`]: "A2 changed\n",
    });
    const ruleBefore = find(first.items, "~/.claude/rules/a.md");
    const ruleAfter = find(after.items, "~/.claude/rules/a.md");
    expect(ruleAfter.itemId).toBe(ruleBefore.itemId);
    expect(ruleAfter.sha256).not.toBe(ruleBefore.sha256);
  });
});

describe("claude-code: 없는 것과 심볼릭 링크", () => {
  test("없는 폴더와 파일은 항목도 scanned도 없다", async () => {
    const result = await scanWith(USER, {});
    expect(result.items).toEqual([]);
    expect(result.scanned).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("있는 위치만 scanned에 든다", async () => {
    const result = await scanWith(USER, { [`${CLAUDE}/CLAUDE.md`]: "x\n" });
    expect(result.scanned).toEqual(["~/.claude/CLAUDE.md"]);
  });

  test("심볼릭 링크 파일은 건너뛰고 진단을 내며 나머지는 그대로 훑는다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/CLAUDE.md`]: { symlinkTo: "/etc/hosts" },
      [`${CLAUDE}/rules/link.md`]: { symlinkTo: "/etc/passwd" },
      [`${CLAUDE}/commands/ok.md`]: "Ok\n",
    });
    expect(result.items.map((item) => item.kind)).toEqual(["command"]);
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["unreadable", "~/.claude/CLAUDE.md"],
      ["unreadable", "~/.claude/rules/link.md"],
    ]);
  });

  test("심볼릭 링크인 가져오기 대상은 차단되고 진단을 낸다", async () => {
    const result = await scanWith(USER, {
      [`${CLAUDE}/CLAUDE.md`]: "@docs/link.md\n",
      [`${CLAUDE}/docs/link.md`]: { symlinkTo: "/etc/x" },
    });
    expect(blockedRows(result.items)).toEqual([
      [".claude/CLAUDE.md.import.@docs/link.md", "import_missing", "@docs/link.md"],
    ]);
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["unreadable", "~/.claude/docs/link.md"],
    ]);
  });
});

describe("claude-code: 한도", () => {
  test("폴더 깊이 상한을 넘는 폴더는 건너뛰고 진단을 낸다", async () => {
    const result = await scanWith(
      USER,
      { [`${CLAUDE}/rules/a/b/c.md`]: "deep\n" },
      { ...DEFAULT_SCAN_LIMITS, maxDepth: 1 },
    );
    expect(result.items).toEqual([]);
    expect(result.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ["limit", "~/.claude/rules/a/b"],
    ]);
  });

  test("파일당 상한을 넘는 지침은 읽지 않고 진단을 낸다", async () => {
    const result = await scanWith(
      USER,
      { [`${CLAUDE}/CLAUDE.md`]: "x".repeat(20) },
      { ...DEFAULT_SCAN_LIMITS, maxFileBytes: 10 },
    );
    expect(result.items).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["too_large"]);
  });
});
