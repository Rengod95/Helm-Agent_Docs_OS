import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGroupTemplatesFs, locateGroupTemplates } from "../src/group/fs-port.ts";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// S1 종단 시험(L3.slots.spec §3.3.6, S-08, L4.cli.spec §3.8): 실제 파일 시스템과 실제 templates/로 만든 그룹이
// 코어 보호 경로(contracts, ext-host, platform-*, core-*)를 한 줄도 바꾸지 않는지 본다.
// 검사 스크립트는 scripts/core-diff-check.ts를 자식 프로세스로 부른다. apps/cli 소스가 scripts/를 상대 경로로
// import하면 DR-05(패키지 밖 상대 import)에 걸린다. 대신 시험이 저장소를 만들고 스크립트의 출력과 종료 코드를 본다.

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK_SCRIPT = join(HERE, "..", "..", "..", "scripts", "core-diff-check.ts");
const TEMPLATES = locateGroupTemplates({}, HERE);

/** observe 9개 + drive 10개 + policy 8개(templates/index.json의 files 개수) */
const EXPECTED_FILES = 27;

const PROTECTED_READMES = [
  "xeon/packages/contracts/README.md",
  "xeon/packages/ext-host/README.md",
  "xeon/packages/core-loop/README.md",
  "xeon/packages/platform-os/README.md",
];

const harnesses: Harness[] = [];
const repos: string[] = [];

afterAll(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
  for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
});

function git(cwd: string, args: readonly string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(run.stderr)}`);
  }
  return new TextDecoder().decode(run.stdout).trim();
}

/** 임시 저장소를 만들고 보호 경로의 README 네 개를 첫 커밋으로 넣는다 */
function freshRepo(): { readonly repo: string; readonly base: string } {
  const repo = mkdtempSync(join(tmpdir(), "xgrp-core-diff-"));
  repos.push(repo);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "xeon test"]);
  git(repo, ["config", "user.email", "xeon-test@example.invalid"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  for (const readme of PROTECTED_READMES) {
    mkdirSync(join(repo, dirname(readme)), { recursive: true });
    writeFileSync(join(repo, readme), `# ${readme}\n`);
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "init"]);
  return { repo, base: git(repo, ["rev-parse", "HEAD"]) };
}

/** 검사 스크립트를 임시 저장소 안에서 돌린다. 종료 코드와 표준 출력을 그대로 돌려준다 */
async function runCheck(
  repo: string,
  base: string,
): Promise<{ readonly code: number; readonly stdout: string }> {
  const child = Bun.spawn([process.execPath, CHECK_SCRIPT, base], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, stdout };
}

function filesUnder(root: string): number {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  ).length;
}

test("templates are found from the CLI source tree", () => {
  expect(TEMPLATES).not.toBeNull();
  expect(TEMPLATES === null ? "" : join(TEMPLATES, "index.json")).toBe(
    join(HERE, "..", "..", "..", "packages", "group-kit", "templates", "index.json"),
  );
});

test("group-new.output-passes-core-diff-check-with-zero-lines", async () => {
  if (TEMPLATES === null) throw new Error("group-kit templates not found");
  const { repo, base } = freshRepo();
  const h = createHarness({
    cwd: repo,
    env: { NO_COLOR: "1" },
    groupTemplates: createGroupTemplatesFs({
      templatesDir: TEMPLATES,
      userConfigDir: () => join(repo, "no-user-config"),
      builtinNames: [],
    }),
  });
  harnesses.push(h);

  const groups: readonly (readonly [string, readonly string[]])[] = [
    ["focus-drive", ["--drive"]],
    ["focus-observe", []],
    ["focus-policy", ["--policy"]],
  ];
  const codes = await Promise.all(
    groups.map(([name, flags]) =>
      h.run(["group", "new", name, ...flags, "--dir", `xeon/packages/group-${name}`]),
    ),
  );
  expect(codes).toEqual([EXIT.ok, EXIT.ok, EXIT.ok]);
  expect(filesUnder(join(repo, "xeon", "packages", "group-focus-drive"))).toBe(10);
  expect(filesUnder(join(repo, "xeon", "packages", "group-focus-observe"))).toBe(9);
  expect(filesUnder(join(repo, "xeon", "packages", "group-focus-policy"))).toBe(8);

  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "groups"]);

  const clean = await runCheck(repo, base);
  expect(clean.code).toBe(0);
  expect(clean.stdout).toBe(
    `core-diff-check: ok, ${String(EXPECTED_FILES)} changed paths, none under contracts, ext-host, platform-*, core-*\n`,
  );

  // negative control: 같은 저장소에 보호 경로 한 줄을 더하면 검사가 그 경로를 정확히 보고해야 한다
  writeFileSync(join(repo, "xeon/packages/ext-host/README.md"), "# touched\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "touch ext-host"]);

  const violated = await runCheck(repo, base);
  expect(violated.code).toBe(1);
  expect(violated.stdout).toBe(
    "core-diff-check: 1 protected paths changed (S1 needs zero):\n  xeon/packages/ext-host/README.md\n",
  );
}, 60_000);
