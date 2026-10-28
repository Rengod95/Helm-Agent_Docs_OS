import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CancelScope } from "@xeon/contracts/services";
import { createExecService, type ExecServiceOptions } from "../src/service.ts";
import { hostPlatform } from "./support/platform.ts";

// L0.exec.spec §3.8, §10 4, PATCHES P19: spill 파일과 임시 디렉터리를 호출자가 준 상태 디렉터리 아래 소유자 전용으로 만든다.

const none: CancelScope = { abortSignal: undefined };
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-exec-spill-"));
  roots.push(dir);
  return dir;
}

function service(cwd: string, overrides: Partial<ExecServiceOptions>) {
  return createExecService(
    {
      cwd,
      shellPath: "/bin/bash",
      defaultTimeoutMs: 0,
      outputSpillBytes: 10,
      envExtra: [],
      ...overrides,
    },
    {
      platform: hostPlatform(),
      secrets: undefined,
      parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
}

const OUTPUT = "12345678901234567890";

describe("spill location", () => {
  test("with tempDir the spill file lives under it, owner-only, with the full output", async () => {
    const work = root();
    const state = join(work, "state", "spill");
    const exec = service(work, { tempDir: state });
    const result = await exec.exec(`printf ${OUTPUT}`, undefined, none);
    if (!result.ok) throw new Error(`exec failed: ${result.error.message}`);
    const spillPath = result.value.spillPath;
    if (spillPath === undefined) throw new Error("expected a spill file");
    // <tempDir>/tmp-XXXX/pi-output-<uuid>.log
    expect(dirname(dirname(spillPath))).toBe(state);
    expect(readFileSync(spillPath, "utf8")).toBe(OUTPUT);
    expect(statSync(state).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(spillPath)).mode & 0o777).toBe(0o700);
    expect(statSync(spillPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(state)).toHaveLength(1);
  });

  test("without tempDir the spill file stays in the OS temp folder (original behavior)", async () => {
    const work = root();
    const exec = service(work, {});
    const result = await exec.exec(`printf ${OUTPUT}`, undefined, none);
    if (!result.ok) throw new Error(`exec failed: ${result.error.message}`);
    const spillPath = result.value.spillPath;
    if (spillPath === undefined) throw new Error("expected a spill file");
    expect(spillPath.startsWith(tmpdir())).toBe(true);
    expect(statSync(spillPath).mode & 0o777).toBe(0o600);
    rmSync(dirname(spillPath), { recursive: true, force: true });
  });

  test("createTempDir uses the same root", async () => {
    const work = root();
    const state = join(work, "state", "spill");
    const exec = service(work, { tempDir: state });
    const made = await exec.createTempDir("scratch-", none);
    if (!made.ok) throw new Error("createTempDir failed");
    expect(dirname(made.value)).toBe(state);
    expect(made.value.startsWith(join(state, "scratch-"))).toBe(true);
  });
});
