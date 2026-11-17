// 스캔 → 제안 → 출력의 끝에서 끝까지. 실제 형식의 표본 파일을 메모리 fs에 두고 값을 비교한다.
import { expect, test } from "bun:test";
import { bundledRulesets, propose, scanRoots, emit } from "../src/index.ts";
import { memoryFs } from "./support.ts";

const HOME = "/home/u";
const PROJECT = "/work/shop";

const files = {
  [`${PROJECT}/.mcp.json`]: JSON.stringify({
    mcpServers: {
      github: {
        type: "http",
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
      },
      local: { command: "node", args: ["server.js"], env: { API_KEY: "sk-live-abcdefghijklmnop" } },
    },
  }),
  [`${PROJECT}/.agents/skills/deploy/SKILL.md`]:
    "---\nname: deploy\ndescription: Deploy the shop to staging.\nallowed-tools: Bash\n---\nRun the deploy script.\n",
  [`${PROJECT}/.agents/skills/deploy/scripts/run.sh`]: "#!/bin/sh\necho deploy\n",
  [`${PROJECT}/CLAUDE.md`]: "# Shop\nUse pnpm.\n",
  [`${PROJECT}/AGENTS.md`]: "# Shop agents\n",
  [`${PROJECT}/.claude/settings.json`]: JSON.stringify({
    hooks: {},
    env: { TOKEN: "ghp_secretsecretsecret" },
  }),
  [`${HOME}/.claude/CLAUDE.md`]: "Always answer briefly.\n",
  [`${HOME}/.claude/commands/ship.md`]: "---\ndescription: Ship it\n---\nRun the ship checklist.\n",
  [`${HOME}/.claude/agents/reviewer.md`]:
    "---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep\nmodel: sonnet\n---\nYou review code.\n",
};

async function run(): Promise<{
  scan: Awaited<ReturnType<typeof scanRoots>>;
  proposal: ReturnType<typeof propose>;
}> {
  const scan = await scanRoots({
    roots: [
      { path: HOME, scope: "user", label: "home" },
      { path: PROJECT, scope: "project", label: "shop" },
    ],
    fs: memoryFs(files),
    ctx: { homeDir: HOME },
  });
  const rulesets = bundledRulesets();
  if (!rulesets.ok) throw new Error("bundled rules are invalid");
  return { scan, proposal: propose(scan, rulesets.value, { answers: {} }) };
}

test("every scanned item has exactly one report line", async () => {
  const { scan, proposal } = await run();
  expect(proposal.report.map((line) => line.itemId).toSorted()).toEqual(
    scan.items.map((item) => item.itemId).toSorted(),
  );
  expect(
    proposal.report
      .filter((line) => line.reason?.code === "no_rule")
      .map((line) => `${line.harness}|${line.kind}|${line.source.key ?? line.source.path}`),
  ).toEqual([]);
});

test("project items go to user-folder plugins with a project-named profile", async () => {
  const { proposal } = await run();
  expect(proposal.profileProposals.map((entry) => entry.profileName)).toEqual(["shop"]);
  const names = proposal.plugins.map((plugin) => plugin.name);
  expect(names).toContain("deploy");
  expect(names).toContain("mcp-github");
  expect(names).toContain("mcp-local");
});

test("no secret value reaches any draft file or report", async () => {
  const { proposal } = await run();
  const decoder = new TextDecoder();
  const everything = [
    JSON.stringify(proposal.report),
    ...proposal.plugins.flatMap((plugin) =>
      [...emit(plugin).values()].map((bytes) => decoder.decode(bytes)),
    ),
  ].join("\n");
  for (const secret of ["sk-live-abcdefghijklmnop", "ghp_secretsecretsecret", "Bearer ${"]) {
    expect(everything.includes(secret)).toBe(false);
  }
});

test("project CLAUDE.md is not ported, AGENTS.md needs no port", async () => {
  const { proposal } = await run();
  const claude = proposal.report.find(
    (line) => line.source.path.endsWith("CLAUDE.md") && line.source.scope === "project",
  );
  expect(claude?.status).toBe("not_ported");
  expect(claude?.reason?.code).toBe("not_read_by_fresnel");
  const agents = proposal.report.find((line) => line.source.path.endsWith("AGENTS.md"));
  expect(agents?.status).toBe("not_needed");
});

test("scan, propose and emit are deterministic", async () => {
  const first = await run();
  const second = await run();
  expect(second.proposal).toEqual(first.proposal);
  const bytes = (plan: (typeof first.proposal.plugins)[number]): string[] =>
    [...emit(plan).entries()].map(([path, data]) => `${path}:${Buffer.from(data).toString("hex")}`);
  expect(second.proposal.plugins.map(bytes)).toEqual(first.proposal.plugins.map(bytes));
});

test("the source tree is only read", async () => {
  const fs = memoryFs(files);
  expect(Object.keys(fs).toSorted()).toEqual(["listDir", "lstat", "readBounded", "realpath"]);
});
