import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import type { IsolatedChild } from "@fresnel/contracts/extensions";
import {
  createBackgroundRegistry,
  createIsolationProcessPort,
  detectProcessPlatform,
  type BackgroundRegistryController,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { memoryLogger, sequentialLocalIds } from "./support/fakes.ts";
import { realScheduler, waitFor } from "./support/real-time.ts";
import { fakeSandbox } from "./support/sandbox-fake.ts";

// review.m5-drive-isolation §3.1: 실제 자식 프로세스로 격리 포트의 줄 단위 왕복과 stdin 닫힘 종료를 확인한다.
// 샌드박스는 대역이다. 대역은 명령줄을 그대로 돌려주므로 이 시험은 격리 효과를 보지 않는다(실제 격리는 scratch 점검이 본다).

const ECHO_CHILD = `${import.meta.dir}/fixtures/mcp-child.ts`;

const platform = detectProcessPlatform();
if (!platform.ok) throw new Error("this test needs a supported platform");

const children: IsolatedChild[] = [];
const registries: BackgroundRegistryController[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(registries.splice(0).map((registry) => registry.close({ graceMs: 100 })));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("IsolationProcessPort.spawn with a real child", () => {
  test("stdin lines come back on stdout, and closing stdin ends the child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fresnel-isolation-int-"));
    dirs.push(dir);
    // 감싸기 전 명령은 없는 경로다. 줄이 돌아오면 샌드박스가 준 명령줄이 실제로 돌았다
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, ECHO_CHILD, "echo"] }));
    const background = createBackgroundRegistry({
      clock: manualClock(),
      scheduler: realScheduler(),
      ids: sequentialLocalIds(),
      logger: memoryLogger(),
    });
    registries.push(background);
    const port = createIsolationProcessPort({
      platform: platform.value,
      background,
      sandbox: () => sandbox.source,
      parentEnv: { PATH: process.env["PATH"] },
      scheduler: realScheduler(),
      logger: memoryLogger(),
      drainMs: 300,
    });
    const spawned = await port.spawn({
      command: "/nonexistent/plugin-host-original",
      args: ["--stdio"],
      readRoot: dir,
      env: {},
      label: "ext:fixture:v1",
    });
    if (!spawned.ok) throw new Error(`spawn failed: ${JSON.stringify(spawned.error)}`);
    const child = spawned.value;
    children.push(child);

    const lines: string[] = [];
    let pending = "";
    child.stdout.on("data", (chunk: string | Uint8Array) => {
      pending += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      lines.push(...parts);
    });
    child.stdin.write("hello\n");
    expect(await waitFor(() => lines.includes("echo:hello"), 5000)).toBe(true);
    expect(background.list({ kind: "plugin-host" })).toHaveLength(1);

    child.stdin.end();
    expect(await child.exited).toEqual({ code: 0, signal: null });
    expect(sandbox.cleanups()).toBe(1);
  });
});
