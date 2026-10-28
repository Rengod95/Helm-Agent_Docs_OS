import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkCoreDiff, isProtected, parseNameList, violations } from "./core-diff-check.ts";

test("protected directories match by segment and wildcard", () => {
  expect(isProtected("xeon/packages/contracts/src/a.ts", "xeon/packages/contracts/")).toBe(true);
  expect(isProtected("xeon/packages/ext-host/package.json", "xeon/packages/ext-host/")).toBe(true);
  expect(isProtected("xeon/packages/platform-store/src/x.ts", "xeon/packages/platform-*/")).toBe(
    true,
  );
  expect(isProtected("xeon/packages/core-loop/src/x.ts", "xeon/packages/core-*/")).toBe(true);
  // sibling names that only share a prefix, and the directory itself, are not inside the pattern
  expect(isProtected("xeon/packages/contracts-extra/src/a.ts", "xeon/packages/contracts/")).toBe(
    false,
  );
  expect(isProtected("xeon/packages/core/x.ts", "xeon/packages/core-*/")).toBe(false);
  expect(isProtected("xeon/packages/core-loop", "xeon/packages/core-*/")).toBe(false);
  expect(isProtected("xeon/packages/group-learning/src/a.ts", "xeon/packages/core-*/")).toBe(false);
});

test("violations keeps only protected paths in order", () => {
  expect(
    violations([
      "xeon/packages/group-learning/src/index.ts",
      "xeon/packages/core-agents/src/a.ts",
      "docs/xeon/L3/learning/spec.md",
      "xeon/packages/platform-os/src/b.ts",
      "xeon/apps/host/src/assemble.ts",
    ]),
  ).toEqual(["xeon/packages/core-agents/src/a.ts", "xeon/packages/platform-os/src/b.ts"]);
  expect(violations([])).toEqual([]);
});

test("parseNameList drops blank lines", () => {
  expect(parseNameList("a\n\nb\n")).toEqual(["a", "b"]);
  expect(parseNameList("")).toEqual([]);
});

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function sh(cwd: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${await new Response(child.stderr).text()}`);
}

async function repoWith(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "core-diff-"));
  dirs.push(dir);
  await sh(dir, "init", "-q", "-b", "main");
  await sh(dir, "config", "user.email", "t@example.com");
  await sh(dir, "config", "user.name", "t");
  await sh(dir, "config", "commit.gpgsign", "false");
  write(dir, { "xeon/packages/contracts/src/a.ts": "a\n" });
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-q", "-m", "base");
  write(dir, files);
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-q", "-m", "change");
  return dir;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

test("a change set outside the protected paths is clean", async () => {
  const dir = await repoWith({ "xeon/packages/group-learning/src/index.ts": "x\n" });
  expect(await checkCoreDiff(dir, "HEAD~1", "HEAD")).toEqual({ kind: "clean", changed: 1 });
});

test("a change set that touches a protected path is reported with the path", async () => {
  const dir = await repoWith({
    "xeon/packages/group-learning/src/index.ts": "x\n",
    "xeon/packages/contracts/src/a.ts": "changed\n",
    "xeon/packages/core-loop/src/b.ts": "b\n",
  });
  expect(await checkCoreDiff(dir, "HEAD~1", "HEAD")).toEqual({
    kind: "violated",
    paths: ["xeon/packages/contracts/src/a.ts", "xeon/packages/core-loop/src/b.ts"],
    changed: 3,
  });
});

test("an unknown base and a directory outside a repository are environment problems", async () => {
  const dir = await repoWith({ "docs/a.md": "x\n" });
  const unknown = await checkCoreDiff(dir, "no-such-ref", "HEAD");
  expect(unknown.kind).toBe("environment");
  const outside = mkdtempSync(join(tmpdir(), "core-diff-none-"));
  dirs.push(outside);
  expect((await checkCoreDiff(outside, "HEAD", "HEAD")).kind).toBe("environment");
});
