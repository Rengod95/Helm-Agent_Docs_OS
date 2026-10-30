import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(import.meta.dir, "ensure-sidecar.sh");
const PACKAGE = "packages/fake-cli";
const SOURCE = `${PACKAGE}/src/main.ts`;
const BINARY = "apps/desktop/src-tauri/binaries/xeon-test";
const STAMP = "apps/desktop/src-tauri/binaries/.sources.sha256";

// Stands in for `mise exec -- <command>`, the only two calls the script makes: turbo's package listing (the line format the
// script's sed reads) and the sidecar build (appends to the build log and creates the binary, cwd is the fixture root).
const FAKE_MISE = `#!/usr/bin/env bash
set -e
if [ "$1" != exec ] || [ "$2" != -- ]; then echo "fake mise: unexpected $*" >&2; exit 3; fi
shift 2
if [ "$1 $2 $3" = "bun run turbo" ]; then
  cat <<JSON
[
  {
    "name": "@xeon/cli",
    "path": "$FAKE_PACKAGE"
  }
]
JSON
elif [ "$*" = "bun scripts/build-sidecar.ts host" ]; then
  echo build >>"$FAKE_BUILD_LOG"
  mkdir -p apps/desktop/src-tauri/binaries
  echo built >apps/desktop/src-tauri/binaries/xeon-test
else
  echo "fake mise: unexpected $*" >&2
  exit 3
fi
`;

interface Repo {
  readonly root: string;
  readonly fakeBin: string;
  readonly buildLog: string;
}

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function place(root: string, rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const child = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, stdout: "ignore", stderr: "pipe" },
  );
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${await new Response(child.stderr).text()}`);
  }
}

// A committed throwaway repo with the script copied in and the files its hash reads (a fake package, sidecar.json, build-sidecar.ts,
// bun.lock, mise.toml). The script runs as `bash <root>/scripts/ensure-sidecar.sh` with the fake mise first on PATH.
async function makeRepo(): Promise<Repo> {
  const root = mkdtempSync(join(tmpdir(), "ensure-sidecar-"));
  roots.push(root);
  place(root, "bin/mise", FAKE_MISE);
  chmodSync(join(root, "bin", "mise"), 0o755);
  place(root, "scripts/ensure-sidecar.sh", readFileSync(SCRIPT, "utf8"));
  place(
    root,
    "scripts/build-sidecar.ts",
    "// placeholder: the fake mise stands in for the build\n",
  );
  place(root, "apps/desktop/sidecar.json", "{}\n");
  place(root, "bun.lock", "placeholder\n");
  place(root, "mise.toml", "placeholder\n");
  place(root, SOURCE, "export const version = 1;\n");
  await git(root, ["init", "-q"]);
  await git(root, ["add", "--all"]);
  await git(root, ["commit", "-q", "-m", "fixture"]);
  return { root, fakeBin: join(root, "bin"), buildLog: join(root, "build.log") };
}

async function ensure(repo: Repo): Promise<Run> {
  const child = Bun.spawn(["bash", join(repo.root, "scripts", "ensure-sidecar.sh")], {
    cwd: repo.root,
    env: {
      ...process.env,
      PATH: `${repo.fakeBin}:${process.env["PATH"] ?? ""}`,
      FAKE_PACKAGE: PACKAGE,
      FAKE_BUILD_LOG: repo.buildLog,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function buildLog(repo: Repo): string {
  return existsSync(repo.buildLog) ? readFileSync(repo.buildLog, "utf8") : "";
}

function builds(repo: Repo): number {
  return buildLog(repo)
    .split("\n")
    .filter((line) => line === "build").length;
}

function stamp(repo: Repo): string | undefined {
  const path = join(repo.root, STAMP);
  return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
}

test("without a binary the first run builds once and writes the stamp", async () => {
  const repo = await makeRepo();
  const run = await ensure(repo);
  expect(run.exitCode).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toContain("sources changed or no binary, building");
  expect(builds(repo)).toBe(1);
  expect(existsSync(join(repo.root, BINARY))).toBe(true);
  expect(stamp(repo)).toMatch(/^[0-9a-f]{64}$/);
});

test("an unchanged tree reports the binary as current and does not rebuild", async () => {
  const repo = await makeRepo();
  await ensure(repo);
  const logBefore = buildLog(repo);
  const stampBefore = stamp(repo);
  const run = await ensure(repo);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("binary is current");
  expect(buildLog(repo)).toBe(logBefore);
  expect(builds(repo)).toBe(1);
  expect(stamp(repo)).toBe(stampBefore);
});

test("a source changed after the build rebuilds, with its mtime newer than the binary's", async () => {
  const repo = await makeRepo();
  await ensure(repo);
  const stampBefore = stamp(repo);
  const binary = join(repo.root, BINARY);
  const source = join(repo.root, SOURCE);
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(binary, past, past);
  writeFileSync(source, "export const version = 2;\n");
  const now = new Date();
  utimesSync(source, now, now);
  expect(statSync(source).mtimeMs).toBeGreaterThan(statSync(binary).mtimeMs);

  const run = await ensure(repo);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("sources changed or no binary, building");
  expect(builds(repo)).toBe(2);
  expect(stamp(repo)).not.toBe(stampBefore);
});

test("a binary without its stamp is rebuilt", async () => {
  const repo = await makeRepo();
  await ensure(repo);
  const stampBefore = stamp(repo);
  rmSync(join(repo.root, STAMP));
  expect(existsSync(join(repo.root, BINARY))).toBe(true);

  const run = await ensure(repo);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("sources changed or no binary, building");
  expect(builds(repo)).toBe(2);
  expect(stamp(repo)).toBe(stampBefore);
});

const reporting = (version: string): string =>
  `#!/usr/bin/env bash\necho '{"cli":"${version}","contract":"0.1.0","bun":"1.0.0"}'\n`;

test("a binary that reports a release version is stale and is rebuilt, one that reports 0.0.0 is current", async () => {
  const repo = await makeRepo();
  await ensure(repo);
  const binary = join(repo.root, BINARY);
  writeFileSync(binary, reporting("0.0.0"));
  chmodSync(binary, 0o755);
  expect((await ensure(repo)).stdout).toContain("binary is current");
  expect(builds(repo)).toBe(1);

  writeFileSync(binary, reporting("0.0.0-smoke"));
  const run = await ensure(repo);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("sources changed or no binary, building");
  expect(builds(repo)).toBe(2);
});
