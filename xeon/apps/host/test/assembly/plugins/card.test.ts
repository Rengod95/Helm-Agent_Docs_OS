import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { textTokens } from "@fresnel/core-context";
import {
  HOOKS,
  PluginCardSchema,
  type ExtensionManifest,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import {
  buildPluginCard,
  launchOf,
  type BuildCardInput,
  type CardSubject,
} from "../../../src/assembly/plugins/card.ts";
import { pluginCostOf } from "../../../src/assembly/m4/profile-cost.ts";
import { pluginCostOf as measuredCostOf } from "../../../src/assembly/measure/turn-context.ts";
import {
  readPluginFolder,
  type PluginFolder,
} from "../../../src/assembly/plugins/folder-reader.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §3.1, §4.5.5, §4.5.9: 카드는 폴더와 매니페스트에서 정적으로 계산한다. 코드는 실행하지 않는다.

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

function folderOf(name: string, files: Readonly<Record<string, string>>): PluginFolder {
  const parent = tempRoot("plugin-card-");
  roots.push(parent);
  const dir = join(parent, name);
  writeFiles(dir, files);
  const result = readPluginFolder(dir, { origin: "user" });
  if (!result.ok) throw new Error(`folder rejected: ${result.error.kind}`);
  return result.value;
}

const REVIEW: BuildCardInput["review"] = {
  state: "none",
  currentHash: null,
  pendingItemId: null,
  approvedAt: null,
};
const HEALTH: BuildCardInput["health"] = { state: "ok", lastActiveAt: null, lastError: null };

function cardOf(
  folder: PluginFolder,
  origin: BuildCardInput["origin"] = { kind: "user" },
): PluginCard {
  return buildPluginCard({ folder, origin, review: REVIEW, usedBy: [], health: HEALTH });
}

const SKILL = `---\nname: greeter\ndescription: "Say hello politely"\n---\nBody\n`;

test("스킬 폴더의 카드는 스키마를 만족하고 Inject 칸만 채운다", () => {
  const card = cardOf(folderOf("hello-skill", { "SKILL.md": SKILL }));
  expect(parse(PluginCardSchema, card).ok).toBe(true);
  expect(card.name).toBe("hello-skill");
  expect(card.purpose).toBe("Say hello politely");
  expect(card.does.hook).toBeNull();
  expect(card.does.drive).toBeNull();
  expect(card.enforcement).toBe("advisory");
  expect(card.runs).toEqual({ code: false, isolated: null });
  expect(card.does.inject?.instructions.skills).toEqual([
    { name: "greeter", path: "SKILL.md", descriptionChars: 18 },
  ]);
});

test("비용: 항상 싣는 지침과 스킬의 토큰 어림값, 도구 수. Drive 중 양은 null이다", () => {
  const card = cardOf(
    folderOf("rules-kit", {
      "SKILL.md": SKILL,
      "instructions.md": "Keep it short.",
      "instructions/extra.md": "해요체.",
    }),
  );
  // 지침은 14글자(4토큰)와 4글자(1토큰), 스킬은 설명 18글자(5토큰)와 본문 "Body"(1토큰)다
  expect(card.cost).toEqual({
    always: 5,
    drive: null,
    onDemand: 6,
    toolCount: 0,
    basis: "declared",
  });
});

test("비용: 선언된 도구의 이름과 설명이 항상 싣는 양에 든다", () => {
  const card = cardOf(
    folderOf("tool-cost", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "tool-cost",
        version: "1.0.0",
        tools: [{ name: "ping", description: "abcdefgh" }],
        entry: "./plugin.ts",
      }),
      "plugin.ts": "export {};",
    }),
  );
  // "ping\nabcdefgh"는 13글자라 4토큰이다
  expect(card.cost).toEqual({
    always: 4,
    drive: null,
    onDemand: 0,
    toolCount: 1,
    basis: "declared",
  });
});

test("비용: 도구를 선언하지 않은 코드 플러그인은 셀 수 없어 숫자가 null이다", () => {
  const card = cardOf(
    folderOf("code-no-tools", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "code-no-tools",
        version: "1.0.0",
        entry: "./plugin.ts",
      }),
      "plugin.ts": "export {};",
      "instructions.md": "Keep it short.",
    }),
  );
  expect(card.cost).toEqual({
    always: null,
    drive: null,
    onDemand: null,
    toolCount: null,
    basis: "unknown",
  });
});

test("비용: 같은 재료의 카드 값과 프로필 미리 보기 값이 같다", async () => {
  const folder = folderOf("same-cost", {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "same-cost",
      version: "1.0.0",
      tools: [{ name: "note_save", description: "노트를 저장해요. Save a note." }],
      entry: "./plugin.ts",
    }),
    "plugin.ts": "export {};",
    "instructions.md": "Keep it short. 짧게 답해요.",
    "SKILL.md": `---\nname: s\ndescription: "설명 description"\n---\n본문입니다. Body text here.\n`,
  });
  const files = new Map([
    ["/ext/instructions.md", "Keep it short. 짧게 답해요."],
    [
      "/ext/SKILL.md",
      `---\nname: s\ndescription: "설명 description"\n---\n본문입니다. Body text here.\n`,
    ],
  ]);
  const profile = await pluginCostOf(
    {
      code: true,
      root: "/ext",
      tools: [{ name: "note_save", description: "노트를 저장해요. Save a note." }],
      instructions: ["instructions.md"],
      skills: ["SKILL.md"],
    },
    (path) => Promise.resolve(files.get(path)),
  );
  expect(cardOf(folder).cost).toEqual(profile);
});

test("비용: 지침만 있는 플러그인의 카드 값이 턴 기록의 항상 값과 같다", () => {
  const text = "Keep it short. 짧게 답해요. 한글이 섞여도 같은 어림이다.";
  const card = cardOf(folderOf("measured-same", { "instructions.md": text }));
  const measured = measuredCostOf({
    materials: [
      {
        plugin: "measured-same",
        versionId: null,
        registrationId: null,
        kind: "always",
        material: "instruction",
        ref: "instructions.md",
        tokens: textTokens(text),
        truncated: false,
        omitted: 0,
        itemId: null,
        attribution: "declared",
      },
    ],
    tools: [],
    skills: [],
  });
  expect(measured).toHaveLength(1);
  expect(card.cost.always).toBe(
    measured.find((row) => row.plugin === "measured-same")?.always ?? null,
  );
  expect(card.cost.always).toBe(textTokens(text));
});

test("매니페스트 목적이 스킬 설명보다 우선한다. 둘 다 없으면 null이다", () => {
  const withManifest = cardOf(
    folderOf("manifest-purpose", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "manifest-purpose",
        version: "1.0.0",
        purpose: "Declared purpose",
      }),
      "SKILL.md": SKILL,
    }),
  );
  expect(withManifest.purpose).toBe("Declared purpose");

  const bare = cardOf(folderOf("no-purpose", { "instructions.md": "Plain." }));
  expect(bare.purpose).toBeNull();
});

test("코드와 드라이브 선언이 있으면 칸, 강제력, 격리 값이 선언에서 정해진다", () => {
  const files = {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "driver-kit",
      version: "1.0.0",
      purpose: "Drives the flow",
      entry: "./plugin.ts",
      plugins: [{ layer: "plugin", hooks: ["input.user.before"], drives: true }],
    }),
    "plugin.ts": "export {};",
  };
  const folder = folderOf("driver-kit", files);
  const card = cardOf(folder, { kind: "user" });
  expect(card.runs).toEqual({ code: true, isolated: true });
  expect(card.does.drive).toEqual({ start: true, commands: [] });
  expect(card.enforcement).toBe("enforced");
  expect(card.does.hook?.hooks).toEqual([
    {
      name: "input.user.before",
      fold: HOOKS["input.user.before"].fold,
      position: "boundary.input-received",
      powers: ["modify", "decide"],
    },
  ]);
  expect(parse(PluginCardSchema, card).ok).toBe(true);

  expect(cardOf(folder, { kind: "builtin" }).runs).toEqual({ code: true, isolated: false });
  expect(cardOf(folder, { kind: "managed" }).runs).toEqual({ code: true, isolated: true });
});

test("with narrowDrafts on, a code plugin's card says it runs narrow before approval; off, code-less and builtin cards say nothing more [결정: 2026-11-22, 사용자, AGE-63]", () => {
  const folder = folderOf("coded", {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name: "coded",
      version: "1.0.0",
      purpose: "Runs code",
      entry: "./plugin.ts",
    }),
    "plugin.ts": "export {};",
  });
  const input = {
    folder,
    origin: { kind: "user" as const },
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
  };
  const on = buildPluginCard({ ...input, narrowDrafts: true });
  expect(on.runs).toEqual({ code: true, isolated: true, narrowBeforeApproval: true });
  expect(parse(PluginCardSchema, on).ok).toBe(true);
  expect(buildPluginCard({ ...input, narrowDrafts: false }).runs).toEqual({
    code: true,
    isolated: true,
  });
  expect(
    buildPluginCard({ ...input, origin: { kind: "builtin" }, narrowDrafts: true }).runs,
  ).toEqual({
    code: true,
    isolated: false,
  });
});

test("선언만 있는 도구, 명령, 대체는 Inject 칸에 들고 도구 수가 비용에 든다", () => {
  const card = cardOf(
    folderOf("tool-kit", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "tool-kit",
        version: "1.0.0",
        tools: [{ name: "note_save", description: "Save a note" }],
        commands: [{ name: "notes", description: "Open notes" }],
        plugins: [{ layer: "plugin", hooks: [], replaces: ["web_search"] }],
        entry: "./plugin.ts",
      }),
      "plugin.ts": "export {};",
    }),
  );
  expect(card.does.inject?.tools).toEqual([{ name: "note_save", description: "Save a note" }]);
  expect(card.does.inject?.commands).toEqual(["notes"]);
  expect(card.does.inject?.replaces).toEqual(["web_search"]);
  expect(card.cost.toolCount).toBe(1);
});

test("재료와 선언이 하나도 없는 코드 플러그인은 Inject 칸이 null이다", () => {
  const card = cardOf(
    folderOf("bare-code", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "bare-code",
        version: "1.0.0",
        entry: "./plugin.ts",
      }),
      "plugin.ts": "export {};",
    }),
  );
  expect(card.does.inject).toBeNull();
  expect(card.does.hook).toBeNull();
  expect(card.enforcement).toBe("advisory");
});

test("출처, 검토, 사용처, 건강 상태는 입력을 그대로 싣는다. 프로젝트 id가 없으면 키가 없다", () => {
  const folder = folderOf("passthrough", { "SKILL.md": SKILL });
  const usedBy = ["default", "common"];
  const projectCard = buildPluginCard({
    folder,
    origin: { kind: "project", projectId: "prj_one" },
    review: {
      state: "pending",
      currentHash: "sha256:abc",
      pendingItemId: "rvw_1",
      approvedAt: null,
    },
    usedBy,
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
  expect(projectCard.origin).toEqual({ kind: "project", projectId: "prj_one" });
  expect(projectCard.review.state).toBe("pending");
  expect(projectCard.usedBy).toEqual(usedBy);
  expect(projectCard.health.state).toBe("idle");

  const userCard = cardOf(folder);
  expect("projectId" in userCard.origin).toBe(false);
});

// 사용자 결정 2026-11-18(AGE-41): 승인하면 실행될 명령을 카드가 빠뜨리지 않고 싣는다. 값(env 값)은 싣지 않는다.
const SECRET = "s3cr3t-value";

test("a stdio server's card carries its command, args, sorted env names and cwd, and never an env value or a header", () => {
  const card = cardOf(
    folderOf("mcp-kit", {
      "mcp.json": JSON.stringify({
        mcpServers: {
          docs: {
            command: "npx",
            args: ["-y", "docs-server"],
            env: { HOME_DIR: SECRET, API_KEY: SECRET },
            cwd: "tools/docs",
          },
          local: { command: "./bin/local" },
          remote: {
            type: "http",
            url: "https://example.test/mcp",
            headers: { Authorization: SECRET },
          },
        },
      }),
    }),
  );
  expect(card.does.inject?.mcpServers).toEqual([
    {
      name: "docs",
      transport: "stdio",
      launch: {
        command: "npx",
        args: ["-y", "docs-server"],
        envNames: ["API_KEY", "HOME_DIR"],
        cwd: "tools/docs",
      },
    },
    {
      name: "local",
      transport: "stdio",
      launch: { command: "./bin/local", args: [], envNames: [], cwd: null },
    },
    { name: "remote", transport: "http", launch: null },
  ]);
  expect(parse(PluginCardSchema, card).ok).toBe(true);
  expect(JSON.stringify(card)).not.toContain(SECRET);
});

test("a manifest that declares its MCP file gives the same launch line as the convention file", () => {
  const card = cardOf(
    folderOf("declared-mcp", {
      ".fresnel-plugin/plugin.json": JSON.stringify({
        schemaVersion: 2,
        name: "declared-mcp",
        version: "1.0.0",
        components: { mcpServers: "config/servers.json" },
      }),
      "config/servers.json": JSON.stringify({
        mcpServers: { notes: { command: "node", args: ["notes.js"], env: { TOKEN: SECRET } } },
      }),
    }),
  );
  expect(card.does.inject?.mcpServers).toEqual([
    {
      name: "notes",
      transport: "stdio",
      launch: { command: "node", args: ["notes.js"], envNames: ["TOKEN"], cwd: null },
    },
  ]);
  expect(JSON.stringify(card)).not.toContain(SECRET);
});

test("launchOf keeps what is visible of a malformed server instead of dropping it", () => {
  expect(
    launchOf({ command: "node", args: ["a", 7, null, { k: "v" }], env: ["A=1"], cwd: 5 }),
  ).toEqual({ command: "node", args: ["a", "7", "null", '{"k":"v"}'], envNames: [], cwd: "5" });
  expect(launchOf({ command: "node", args: "--stdio", env: { B: "x", A: "y" } })).toEqual({
    command: "node",
    args: ['"--stdio"'],
    envNames: ["A", "B"],
    cwd: null,
  });
  expect(launchOf({ command: "" })).toBeNull();
  expect(launchOf({ url: "https://example.test/mcp" })).toBeNull();
});

test("a long command or argument is cut with an ellipsis, and a long argument list keeps a count, so the card stays valid", () => {
  const long = "x".repeat(2000);
  const many = Array.from({ length: 130 }, (_, index) => `a${index}`);
  const card = cardOf(
    folderOf("long-mcp", {
      "mcp.json": JSON.stringify({
        mcpServers: { big: { command: long, args: [long, ...many.slice(1)] } },
      }),
    }),
  );
  const launch = card.does.inject?.mcpServers[0]?.launch;
  expect(launch?.command).toBe(`${"x".repeat(1023)}…`);
  expect(launch?.args[0]).toBe(`${"x".repeat(1023)}…`);
  expect(launch?.args.length).toBe(128);
  expect(launch?.args.at(-1)).toBe("…(+3)");
  expect(parse(PluginCardSchema, card).ok).toBe(true);
});

test("a card stored before the launch field still parses against the schema", () => {
  const card = cardOf(
    folderOf("old-mcp", {
      "mcp.json": JSON.stringify({ mcpServers: { docs: { command: "npx" } } }),
    }),
  );
  const inject = card.does.inject;
  if (inject === null) throw new Error("the test card has no inject row");
  const legacy = {
    ...card,
    does: {
      ...card.does,
      inject: {
        ...inject,
        mcpServers: inject.mcpServers.map((server) => ({
          name: server.name,
          transport: server.transport,
        })),
      },
    },
  };
  expect(parse(PluginCardSchema, legacy).ok).toBe(true);
});

const EMPTY_MATERIALS: CardSubject["materials"] = {
  instructions: [],
  skills: [],
  mcpServers: [],
  agents: [],
  commands: [],
};

const SCRIPTS_DECLARED = {
  schemaVersion: 2,
  name: "script-kit",
  version: "1.0.0",
  scripts: [
    {
      name: "lint",
      runner: "sh",
      file: "scripts/lint.sh",
      args: ["--strict", "src"],
      envNames: ["ZETA", "PATH", "ALPHA", "ZETA", "TZ", "FETCH_API_KEY", "HOME"],
    },
    { name: "report", runner: "python3", file: "scripts/report.py", timeoutMs: 5000 },
  ],
};

test("a declared script's card line is its runner, then the relative file and args, sorted unique env names, no folder, and the time limit", () => {
  const card = cardOf(
    folderOf("script-kit", { ".fresnel-plugin/plugin.json": JSON.stringify(SCRIPTS_DECLARED) }),
  );
  expect(card.does.inject?.scripts).toEqual([
    {
      name: "lint",
      launch: {
        command: "sh",
        args: ["scripts/lint.sh", "--strict", "src"],
        // 실제로 넘어가는 이름(허용 목록)만 싣는다
        envNames: ["HOME", "PATH", "TZ"],
        cwd: null,
      },
      // 선언했지만 받지 못하는 이름: 허용 목록 밖(`ALPHA`, `ZETA`)과 토큰·키 이름(`FETCH_API_KEY`)
      envNotPassed: ["ALPHA", "FETCH_API_KEY", "ZETA"],
      timeoutMs: 10000,
      uses: ["sandbox_full_access", "network"],
    },
    {
      name: "report",
      launch: { command: "python3", args: ["scripts/report.py"], envNames: [], cwd: null },
      timeoutMs: 5000,
      uses: ["sandbox_full_access", "network"],
    },
  ]);
  expect(parse(PluginCardSchema, card).ok).toBe(true);
});

test("a plugin with scripts and no entry shows the script line but marks no code, so no code calls the script", () => {
  // 승인하면 실행될 명령 줄은 보이지만 `entry`가 없어 `runs.code`는 거짓이다. AGE-14 한 줄은 코드가 있을 때만 뜬다
  const card = cardOf(
    folderOf("script-kit", { ".fresnel-plugin/plugin.json": JSON.stringify(SCRIPTS_DECLARED) }),
  );
  expect(card.runs).toEqual({ code: false, isolated: null });
  expect(card.does.inject?.scripts?.map((script) => script.name)).toEqual(["lint", "report"]);
});

test("a script line longer than the launch limits is cut with a mark, and a long argument list keeps a count", () => {
  // 읽기 단계가 거르는 길이를 일부러 넘긴 선언으로 상한만 본다. 자른 값도 카드 스키마를 지킨다
  const manifest: ExtensionManifest = {
    schemaVersion: 2,
    name: "long-kit",
    version: "1.0.0",
    scripts: [
      {
        name: "long",
        runner: "sh",
        file: "s".repeat(2000),
        args: Array.from({ length: 130 }, (_, index) => `a${index}`),
        envNames: ["N".repeat(200)],
      },
    ],
  };
  const card = buildPluginCard({
    folder: { name: "long-kit", manifest, materials: EMPTY_MATERIALS },
    origin: { kind: "user" },
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
  });
  const script = card.does.inject?.scripts?.[0];
  expect(script?.launch.args.length).toBe(128);
  expect(script?.launch.args[0]).toBe(`${"s".repeat(1023)}…`);
  expect(script?.launch.args.at(-1)).toBe("…(+4)");
  expect(script?.launch.envNames).toEqual([]);
  expect(script?.envNotPassed).toEqual([`${"N".repeat(127)}…`]);
  expect(script?.timeoutMs).toBe(10000);
  expect(parse(PluginCardSchema, card).ok).toBe(true);
});

const ENV_HASH = `sha256:${"b".repeat(64)}`;
const ENV_DECLARED = {
  schemaVersion: 2,
  name: "env-kit",
  version: "1.0.0",
  scripts: [
    {
      name: "guard",
      runner: "sh",
      file: "scripts/guard.cmd",
      env: {
        command: 'PYTHONPATH=x python3.11 "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.py --strict',
        shell: "sh",
        refs: [{ path: "/Users/u/proj/.claude/hooks/x.py", hash: ENV_HASH }],
        refsKnown: true,
      },
    },
    {
      name: "unknown",
      runner: "bash",
      file: "scripts/unknown.cmd",
      env: { command: "cd src && ./run.sh", shell: "bash", refs: [], refsKnown: false },
    },
  ],
};

test("an environment-mode script line shows the original command, the tool found on PATH, the references with fingerprints and the full-access uses (AGE-58)", () => {
  const folder = folderOf("env-kit", {
    ".fresnel-plugin/plugin.json": JSON.stringify(ENV_DECLARED),
  });
  const card = buildPluginCard({
    folder,
    origin: { kind: "project", projectId: "p1" },
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
    whichTool: (name) => (name === "python3.11" ? "/opt/homebrew/bin/python3.11" : undefined),
  });
  expect(parse(PluginCardSchema, card).ok).toBe(true);
  const [guard, unknown] = card.does.inject?.scripts ?? [];
  // 기본(샌드박스 설정 꺼짐): 사용자 권한 그대로, 샌드박스 없음
  expect(guard?.uses).toEqual(["user_full_access", "user_environment", "network"]);
  expect(guard?.env).toEqual({
    command: 'PYTHONPATH=x python3.11 "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.py --strict',
    shell: "sh",
    interpreter: "/opt/homebrew/bin/python3.11",
    refs: [{ path: "/Users/u/proj/.claude/hooks/x.py", hash: ENV_HASH }],
    refsKnown: true,
    missingTools: [],
    versionHints: [],
    origin: "project",
    originLabel: null,
    fromProject: true,
  });
  // `cd`는 셸 내장이라 찾지 않는다. 참조를 못 찾았으면 "알 수 없음"(refsKnown false)으로 두고 추측으로 채우지 않는다
  expect(unknown?.env).toEqual({
    command: "cd src && ./run.sh",
    shell: "bash",
    interpreter: null,
    refs: [],
    refsKnown: false,
    missingTools: [],
    versionHints: [],
    origin: "project",
    originLabel: null,
    fromProject: true,
  });
});

test("the hook origin on an environment-mode line comes only from the recorded import origin, never from the manifest, and a missing record reads unknown (enFp)", () => {
  // 매니페스트에 손으로 `origin: "user"`를 더해도 카드는 그것을 읽지 않는다(선언 스키마가 모르는 키라 폴더 읽기가 거절하거나 무시한다)
  const forged = {
    ...ENV_DECLARED,
    scripts: ENV_DECLARED.scripts.map((script) => ({
      ...script,
      env: { ...script.env, origin: "user", originLabel: null },
    })),
  };
  const folder = folderOf("env-kit", {
    ".fresnel-plugin/plugin.json": JSON.stringify(ENV_DECLARED),
  });
  const base = { folder, review: REVIEW, usedBy: [], health: HEALTH } as const;
  const projectImport = buildPluginCard({
    ...base,
    origin: { kind: "user" },
    importedHookOrigin: { kind: "project", label: "~/work/proj" },
  });
  expect(projectImport.does.inject?.scripts?.map((script) => script.env?.origin)).toEqual([
    "project",
    "project",
  ]);
  expect(projectImport.does.inject?.scripts?.map((script) => script.env?.originLabel)).toEqual([
    "~/work/proj",
    "~/work/proj",
  ]);
  // "프로젝트가 싣고 옴" 하나로 쓴다: 플러그인은 사용자 폴더라도 훅이 프로젝트에서 왔으면 `fromProject`가 참이다
  expect(projectImport.does.inject?.scripts?.map((script) => script.env?.fromProject)).toEqual([
    true,
    true,
  ]);
  expect(parse(PluginCardSchema, projectImport).ok).toBe(true);

  const userImport = buildPluginCard({
    ...base,
    origin: { kind: "user" },
    importedHookOrigin: { kind: "user", label: null },
  });
  const userEnv = userImport.does.inject?.scripts?.[0]?.env;
  expect(userEnv?.origin).toBe("user");
  expect(userEnv?.originLabel).toBeNull();
  expect(userEnv?.fromProject).toBe(false);
  // 사용자 범위 기록에 라벨이 딸려 와도 카드는 라벨을 싣지 않는다
  const strayLabel = buildPluginCard({
    ...base,
    origin: { kind: "user" },
    importedHookOrigin: { kind: "user", label: "~/stray" },
  });
  expect(strayLabel.does.inject?.scripts?.[0]?.env?.originLabel).toBeNull();

  // 기록이 없으면(손으로 만든 폴더, 빌더, 초안) 알 수 없음이다
  const unrecorded = buildPluginCard({ ...base, origin: { kind: "user" } });
  expect(unrecorded.does.inject?.scripts?.map((script) => script.env?.origin)).toEqual([
    "unknown",
    "unknown",
  ]);
  expect(unrecorded.does.inject?.scripts?.map((script) => script.env?.fromProject)).toEqual([
    false,
    false,
  ]);
  // 매니페스트에 손으로 `origin`을 적으면 선언 스키마가 거절한다: 매니페스트는 출처를 담을 수 없다
  expect(() =>
    folderOf("env-kit", { ".fresnel-plugin/plugin.json": JSON.stringify(forged) }),
  ).toThrow("manifest_invalid");
});

const ENV_ORIGIN: BuildCardInput["origin"] = { kind: "project", projectId: "p1" };

test("the environment-mode uses are the user's own access by default and the sandboxed list when the sandbox setting is on, and a script without an env declaration keeps the open uses either way (AGE-58, AGE-63)", () => {
  const envFolder = folderOf("env-kit", {
    ".fresnel-plugin/plugin.json": JSON.stringify(ENV_DECLARED),
  });
  const scriptFolder = folderOf("script-kit", {
    ".fresnel-plugin/plugin.json": JSON.stringify(SCRIPTS_DECLARED),
  });
  const plain = buildPluginCard({
    folder: envFolder,
    origin: ENV_ORIGIN,
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
  });
  expect(plain.does.inject?.scripts?.map((script) => script.uses)).toEqual([
    ["user_full_access", "user_environment", "network"],
    ["user_full_access", "user_environment", "network"],
  ]);

  const sandboxed = buildPluginCard({
    folder: envFolder,
    origin: ENV_ORIGIN,
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
    envSandboxed: true,
  });
  expect(parse(PluginCardSchema, sandboxed).ok).toBe(true);
  expect(sandboxed.does.inject?.scripts?.map((script) => script.uses)).toEqual([
    ["user_environment", "read_wide", "write_project", "network"],
    ["user_environment", "read_wide", "write_project", "network"],
  ]);

  // 환경 모드 선언이 없는 스크립트는 샌드박스 설정과 상관없이 열린 정책의 사용 목록이다. 검토 카드는 승인하면 생기는 권한을 싣는다
  const open = buildPluginCard({
    folder: scriptFolder,
    origin: ENV_ORIGIN,
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
    envSandboxed: true,
  });
  expect(open.does.inject?.scripts?.map((script) => script.uses)).toEqual([
    ["sandbox_full_access", "network"],
    ["sandbox_full_access", "network"],
  ]);
});

test("a tool that is not on PATH is listed as missing, and a script without an env declaration shows the open uses and no env", () => {
  const folder = folderOf("env-kit", {
    ".fresnel-plugin/plugin.json": JSON.stringify(ENV_DECLARED),
  });
  const card = buildPluginCard({
    folder,
    origin: { kind: "user" },
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
    whichTool: () => undefined,
  });
  expect(card.does.inject?.scripts?.[0]?.env?.missingTools).toEqual(["python3.11"]);
  expect(card.does.inject?.scripts?.[0]?.env?.fromProject).toBe(false);
  expect(card.does.inject?.scripts?.[0]?.env?.origin).toBe("unknown");
  const scripted = cardOf(
    folderOf("script-kit", { ".fresnel-plugin/plugin.json": JSON.stringify(SCRIPTS_DECLARED) }),
  );
  expect(scripted.does.inject?.scripts?.[0]?.uses).toEqual(["sandbox_full_access", "network"]);
  expect(scripted.does.inject?.scripts?.[0]?.env).toBeUndefined();
});

const folderWith = (name: string, manifest: Record<string, unknown>) =>
  folderOf(name, {
    ".fresnel-plugin/plugin.json": JSON.stringify({
      schemaVersion: 2,
      name,
      version: "1.0.0",
      purpose: "p",
      ...manifest,
    }),
    "plugin.ts": "export {};",
  });

const run = (folder: PluginFolder, narrowDrafts: boolean, kind: "user" | "builtin" = "user") =>
  buildPluginCard({
    folder,
    origin: { kind },
    review: REVIEW,
    usedBy: [],
    health: HEALTH,
    narrowDrafts,
  }).runs;

test("narrowBeforeApproval: a script-only plugin gets it with narrowDrafts on; code, scripts and env-mode hooks follow the case table [결정: 2026-11-22, 사용자, AGE-63]", () => {
  const scriptsOnly = folderWith("only-scripts", {
    scripts: [{ name: "lint", runner: "sh", file: "scripts/lint.sh" }],
  });
  const codeOnly = folderWith("only-code", { entry: "./plugin.ts" });
  const neither = folderWith("neither", {});
  expect(run(scriptsOnly, true)).toEqual({
    code: false,
    isolated: null,
    narrowBeforeApproval: true,
  });
  expect(run(scriptsOnly, false)).toEqual({ code: false, isolated: null });
  expect(run(codeOnly, true)).toEqual({ code: true, isolated: true, narrowBeforeApproval: true });
  expect(run(codeOnly, true, "builtin")).toEqual({ code: true, isolated: false });
  expect(run(neither, true)).toEqual({ code: false, isolated: null });
});
