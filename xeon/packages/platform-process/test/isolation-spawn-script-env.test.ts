import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import {
  createBackgroundRegistry,
  createIsolationProcessPort,
  detectProcessPlatform,
  type BackgroundRegistryController,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { realScheduler } from "./support/real-time.ts";
import { memoryLogger, sequentialLocalIds } from "./support/fakes.ts";
import { fakeSandbox } from "./support/sandbox-fake.ts";

// L0.process.spec §4.8과 review.m5-drive-isolation §3.1: 가져온 훅의 스크립트 환경 띄우기(`spec.scriptEnv`, AGE-58 원칙 가).
// 샌드박스 서비스는 대역이다(정책 입력과 wrapArgv 요청을 값으로 본다). 띄우는 자식은 짧은 실제 프로세스다.

const MARKER_CHILD = `${import.meta.dir}/fixtures/marker-child.ts`;
const ORIGINAL = "/nonexistent/script-runner-original";
const LABEL = "ext:hook:v1";

const platform = detectProcessPlatform();
if (!platform.ok) throw new Error("this test needs a supported platform");
const processPlatform = platform.value;

const children: IsolatedChild[] = [];
const registries: BackgroundRegistryController[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(registries.splice(0).map((registry) => registry.close({ graceMs: 100 })));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDirOf(): string {
  const dir = mkdtempSync(join(tmpdir(), "fresnel-script-env-"));
  dirs.push(dir);
  return dir;
}

function open(sandbox: Parameters<typeof createIsolationProcessPort>[0]["sandbox"]): {
  readonly background: BackgroundRegistryController;
  readonly port: IsolationProcessPort;
} {
  const background = createBackgroundRegistry({
    clock: manualClock(),
    scheduler: realScheduler(),
    ids: sequentialLocalIds(),
    logger: memoryLogger(),
  });
  registries.push(background);
  const port = createIsolationProcessPort({
    platform: processPlatform,
    background,
    sandbox,
    parentEnv: { PATH: process.env["PATH"] },
    scheduler: realScheduler(),
    logger: memoryLogger(),
    drainMs: 300,
    stdinCloseMs: 100,
  });
  return { background, port };
}

function specOf(overrides: Partial<IsolationSpawnSpec> = {}): IsolationSpawnSpec {
  return {
    command: ORIGINAL,
    args: ["--stdio"],
    readRoot: tempDirOf(),
    env: {},
    label: LABEL,
    ...overrides,
  };
}

describe("IsolationProcessPort.spawn with the script environment", () => {
  test("the policy is the script-env profile for the project folder with its carve-outs, and the child runs in the project folder", async () => {
    const projectDir = tempDirOf();
    const readRoot = tempDirOf();
    const carveOut = "/home/user/.claude/hooks";
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MARKER_CHILD, "marker"] }));
    const { port, background } = open(() => sandbox.source);
    const spawned = await port.spawn(
      specOf({
        readRoot,
        command: ORIGINAL,
        args: [MARKER_CHILD, "marker"],
        scriptEnv: { projectDir, readCarveOuts: [carveOut] },
      }),
    );
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;
    children.push(spawned.value);
    expect(background.list({ kind: "plugin-host" })).toHaveLength(1);
    expect(await spawned.value.exited).toEqual({ code: 0, signal: null });

    expect(sandbox.policyInputs).toEqual([
      {
        workspaceRoots: [],
        tempDir: projectDir,
        profile: "script-env",
        projectDir,
        readCarveOuts: [carveOut],
        systemTools: true,
      },
    ]);
    const [call] = sandbox.wrapCalls;
    expect(sandbox.wrapCalls).toHaveLength(1);
    expect(call?.request).toEqual({
      command: ORIGINAL,
      args: [MARKER_CHILD, "marker"],
      cwd: projectDir,
    });
    // 표식 파일은 프로젝트 폴더에 생기고 읽기 루트에는 생기지 않는다(작업 폴더는 프로젝트 폴더다)
    expect(existsSync(join(projectDir, "marker"))).toBe(true);
    expect(existsSync(join(readRoot, "marker"))).toBe(false);
    expect(sandbox.cleanups()).toBe(1);
  });

  test("a relative project folder is refused as a value before the sandbox is asked, and nothing starts", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MARKER_CHILD, "marker"] }));
    const { port, background } = open(() => sandbox.source);
    expect(
      await port.spawn(
        specOf({ scriptEnv: { projectDir: "relative/project", readCarveOuts: [] } }),
      ),
    ).toEqual({
      ok: false,
      error: {
        kind: "spawn_failed",
        code: "EINVAL",
        message: "scriptEnv.projectDir must be an absolute path",
      },
    });
    expect(sandbox.wrapCalls).toHaveLength(0);
    expect(sandbox.policyInputs).toHaveLength(0);
    expect(background.list()).toEqual([]);
  });

  test("a relative read root is still refused when the script environment is set", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MARKER_CHILD, "marker"] }));
    const { port } = open(() => sandbox.source);
    expect(
      await port.spawn(
        specOf({
          readRoot: "relative/root",
          scriptEnv: { projectDir: tempDirOf(), readCarveOuts: [] },
        }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "EINVAL", message: "readRoot must be an absolute path" },
    });
    expect(sandbox.wrapCalls).toHaveLength(0);
  });

  test("a script environment that cannot be isolated starts nothing and the refusal is a value", async () => {
    const projectDir = tempDirOf();
    const marker = join(projectDir, "marker");
    const sandbox = fakeSandbox(err({ kind: "unavailable", reason: "missing_dependency" }));
    const { port, background } = open(() => sandbox.source);
    expect(
      await port.spawn(
        specOf({
          args: [MARKER_CHILD, marker],
          scriptEnv: { projectDir, readCarveOuts: [] },
        }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "missing_dependency" },
    });
    expect(sandbox.wrapCalls).toHaveLength(1);
    expect(background.list()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });
});
