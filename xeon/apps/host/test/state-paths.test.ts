import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHostStatePaths } from "../src/state-paths.ts";

// L4.host-service.spec §3.3.6 (review.decisions-2 B-07). XEON_HOME으로 OsDirs를 격리 디렉터리로 돌린다.

let scratch = "";
let savedHome: string | undefined;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "xeon-state-paths-"));
  savedHome = process.env["XEON_HOME"];
  process.env["XEON_HOME"] = scratch;
});
afterEach(() => {
  if (savedHome === undefined) delete process.env["XEON_HOME"];
  else process.env["XEON_HOME"] = savedHome;
  rmSync(scratch, { recursive: true, force: true });
});

test("the default state file is <OsDirs.state>/cli/state.json and its directory is created with mode 0700", async () => {
  const result = await resolveHostStatePaths();
  if (!result.ok) throw new Error(`unexpected error: ${result.error.kind}`);
  expect(result.value.stateDir).toBe(join(scratch, "state"));
  expect(result.value.cliStateFile).toBe(join(scratch, "state", "cli", "state.json"));
  const mode = statSync(join(scratch, "state", "cli")).mode & 0o777;
  expect(mode).toBe(0o700);
});

test("an override is used as is and only its directory is created", async () => {
  const file = join(scratch, "isolated", "deep", "cli-state.json");
  const result = await resolveHostStatePaths({ cliStateFileOverride: file });
  if (!result.ok) throw new Error(`unexpected error: ${result.error.kind}`);
  expect(result.value.cliStateFile).toBe(file);
  expect(statSync(join(scratch, "isolated", "deep")).isDirectory()).toBe(true);
});

test("a directory that cannot be created is a permission error value, not a throw", async () => {
  const blocker = join(scratch, "blocker");
  writeFileSync(blocker, "a file where a directory is needed");
  const result = await resolveHostStatePaths({
    cliStateFileOverride: join(blocker, "inside", "state.json"),
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe("permission");
  if (result.error.kind === "permission") {
    expect(result.error.path).toBe(join(blocker, "inside"));
    expect(result.error.cause).toBeInstanceOf(Error);
  }
});

test("a relative XEON_HOME is a dirs_unavailable error value", async () => {
  process.env["XEON_HOME"] = "relative/dir";
  const result = await resolveHostStatePaths();
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe("dirs_unavailable");
    if (result.error.kind === "dirs_unavailable") expect(result.error.reason).toBe("not_absolute");
  }
});

test("calling it twice keeps the same paths and does not fail on an existing directory", async () => {
  const first = await resolveHostStatePaths();
  const second = await resolveHostStatePaths();
  expect(first).toEqual(second);
});
