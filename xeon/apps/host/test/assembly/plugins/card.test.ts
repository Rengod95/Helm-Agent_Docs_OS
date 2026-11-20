import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
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

test("비용: 항상 싣는 지침의 글자 수 합과 도구 수, 나머지는 null이다", () => {
  const card = cardOf(
    folderOf("rules-kit", {
      "SKILL.md": SKILL,
      "instructions.md": "Keep it short.",
      "instructions/extra.md": "해요체.",
    }),
  );
  expect(card.cost).toEqual({
    always: "Keep it short.".length + "해요체.".length,
    drive: null,
    onDemand: null,
    toolCount: 0,
    basis: "declared",
  });
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
      envNames: ["ZETA", "ALPHA", "ZETA"],
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
        envNames: ["ALPHA", "ZETA"],
        cwd: null,
      },
      timeoutMs: 10000,
      uses: ["system_tools", "network"],
    },
    {
      name: "report",
      launch: { command: "python3", args: ["scripts/report.py"], envNames: [], cwd: null },
      timeoutMs: 5000,
      uses: ["system_tools", "network"],
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
  expect(script?.launch.envNames).toEqual([`${"N".repeat(127)}…`]);
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

test("an environment-mode script line shows the original command, the tool found on PATH, the references with fingerprints and the wide uses (AGE-58)", () => {
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
  expect(guard?.uses).toEqual(["user_environment", "read_wide", "write_project", "network"]);
  expect(guard?.env).toEqual({
    command: 'PYTHONPATH=x python3.11 "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.py --strict',
    shell: "sh",
    interpreter: "/opt/homebrew/bin/python3.11",
    refs: [{ path: "/Users/u/proj/.claude/hooks/x.py", hash: ENV_HASH }],
    refsKnown: true,
    missingTools: [],
    versionHints: [],
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
    fromProject: true,
  });
});

test("a tool that is not on PATH is listed as missing, and a narrow script keeps the narrow uses and no env", () => {
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
  const narrow = cardOf(
    folderOf("script-kit", { ".fresnel-plugin/plugin.json": JSON.stringify(SCRIPTS_DECLARED) }),
  );
  expect(narrow.does.inject?.scripts?.[0]?.uses).toEqual(["system_tools", "network"]);
  expect(narrow.does.inject?.scripts?.[0]?.env).toBeUndefined();
});
