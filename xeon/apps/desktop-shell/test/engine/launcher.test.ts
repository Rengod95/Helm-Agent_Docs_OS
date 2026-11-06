// 엔진 launcher 시험: 명령 계획(개발 덮어쓰기와 번들 사이드카), `db restore` 출력 모으기, 그리고 실제 자식 한 번의 왕복.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { attempt, err, ok, repeatAsync } from "@fresnel/contracts";
import { nodeScheduler } from "../../src/main/lib/scheduler.ts";
import {
  collectOnce,
  pipedLauncher,
  planCommand,
  type PlanInputs,
} from "../../src/main/engine/launcher.ts";
import { createRelay } from "../../src/main/engine/relay.ts";
import {
  engineConfigFrom,
  engineFlags,
  ONCE_OUTPUT_MAX_BYTES,
} from "../../src/main/engine/policy.ts";
import { Supervisor } from "../../src/main/engine/supervisor.ts";
import { fakeCtx } from "../support/fake-ctx.ts";
import { enc, recordingLog, recordingSink, sourceOf } from "./support.ts";

const RESOURCES = "/work/app/Resources";
const BUNDLED = path.join(RESOURCES, "fresnel-aarch64-apple-darwin");
const OVERRIDE_BIN = "/dev/fake-engine";
const FAKE_TOKEN = "fake-remote-token-not-a-secret";

function inputs(overrides: Partial<PlanInputs> = {}): PlanInputs {
  return {
    env: { PATH: "/usr/bin:/bin" },
    platform: "darwin",
    arch: "arm64",
    resources: RESOURCES,
    home: "/Users/tester",
    exists: () => false,
    ...overrides,
  };
}

function withOverride(args: string): PlanInputs {
  return inputs({
    env: {
      PATH: "/usr/bin:/bin",
      FRESNEL_DESKTOP_ENGINE_BIN: OVERRIDE_BIN,
      FRESNEL_DESKTOP_ENGINE_ARGS: args,
    },
  });
}

describe("command plan (engine.rs launch and run_once)", () => {
  test("the bundled sidecar is used with the host arguments", () => {
    const planned = planCommand(inputs({ exists: (file) => file === BUNDLED }), {
      kind: "engine",
      flags: [],
    });
    expect(planned).toEqual(
      ok({
        file: BUNDLED,
        args: ["host", "--stdio"],
        cwd: "/Users/tester",
        env: {
          PATH: "/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/Users/tester/.local/bin:/Users/tester/.nix-profile/bin",
        },
      }),
    );
  });

  test("the dev override gets only the engine flags after its host --stdio arguments", () => {
    const local = planCommand(withOverride("--inspect  host --stdio"), {
      kind: "engine",
      flags: engineFlags({ kind: "local" }, "on"),
    });
    expect(local.ok && local.value.file).toBe(OVERRIDE_BIN);
    expect(local.ok && local.value.args).toEqual(["--inspect", "host", "--stdio", "--safe-mode"]);
    const remoteTarget = { kind: "remote", address: "tcp://host:1234" } as const;
    const remote = planCommand(withOverride("--inspect host --stdio"), {
      kind: "engine",
      flags: engineFlags(remoteTarget, "on"),
    });
    expect(remote.ok && remote.value.args).toEqual([
      "--inspect",
      "host",
      "--stdio",
      "--remote",
      "tcp://host:1234",
    ]);
  });

  test("a once run uses the dev override only through its host --stdio prefix", () => {
    const planned = planCommand(withOverride("--inspect host --stdio"), {
      kind: "once",
      args: ["db", "restore", "/backups/a", "--json"],
    });
    expect(planned.ok && planned.value.file).toBe(OVERRIDE_BIN);
    expect(planned.ok && planned.value.args).toEqual([
      "--inspect",
      "db",
      "restore",
      "/backups/a",
      "--json",
    ]);
  });

  test("an override without the host --stdio suffix falls back to the bundled sidecar for a once run", () => {
    const planned = planCommand(withOverride("apps/cli/src/main.ts"), {
      kind: "once",
      args: ["db", "restore", "/backups/a", "--json"],
    });
    expect(planned).toEqual(err({ message: "sidecar `fresnel` is not available" }));
    const bundled = planCommand(
      { ...withOverride("apps/cli/src/main.ts"), exists: (file) => file === BUNDLED },
      { kind: "once", args: ["db", "restore", "/backups/a", "--json"] },
    );
    expect(bundled.ok && bundled.value.file).toBe(BUNDLED);
  });

  test("a bundled sidecar wins over the dev override", () => {
    const planned = planCommand(
      { ...withOverride("--inspect host --stdio"), exists: (file) => file === BUNDLED },
      { kind: "engine", flags: [] },
    );
    expect(planned.ok && planned.value.file).toBe(BUNDLED);
    expect(planned.ok && planned.value.args).toEqual(["host", "--stdio"]);
  });

  test("no sidecar and no override is an error, and a home that is not absolute is refused", () => {
    expect(planCommand(inputs(), { kind: "engine", flags: [] })).toEqual(
      err({ message: "sidecar `fresnel` is not available" }),
    );
    expect(planCommand(inputs({ home: "relative/home" }), { kind: "engine", flags: [] })).toEqual(
      err({ message: "home directory is not absolute" }),
    );
  });

  test("the remote token reaches the engine through its environment and never through the arguments", () => {
    const planned = planCommand(
      {
        ...inputs({ exists: (file) => file === BUNDLED }),
        env: { PATH: "/usr/bin", FRESNEL_REMOTE_TOKEN: FAKE_TOKEN, BUN_OPTIONS: "--inspect" },
      },
      {
        kind: "engine",
        flags: engineFlags({ kind: "remote", address: "tcp://host:1234" }, "default"),
      },
    );
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(JSON.stringify(planned.value.args)).not.toContain(FAKE_TOKEN);
    expect(planned.value.env["FRESNEL_REMOTE_TOKEN"]).toBe(FAKE_TOKEN);
    expect(planned.value.env["BUN_OPTIONS"]).toBeUndefined();
  });
});

describe("db restore output (collect_once)", () => {
  test("the output is capped at 256 KiB, the rest is read and dropped, and the exit code is kept", async () => {
    const big = new Uint8Array(ONCE_OUTPUT_MAX_BYTES + 10).fill(0x61);
    const outcome = await collectOnce(
      sourceOf([
        { kind: "stdout", bytes: big },
        { kind: "stderr", bytes: enc("warn") },
        { kind: "terminated", code: 0, signal: null },
      ]),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stdout.length).toBe(ONCE_OUTPUT_MAX_BYTES);
    expect(outcome.value.stderr).toBe("warn");
    expect(outcome.value.exitCode).toBe(0);
  });

  test("a signal exit is -1, and a missing exit event is an error", async () => {
    const signaled = await collectOnce(sourceOf([{ kind: "terminated", code: null, signal: 9 }]));
    expect(signaled.ok && signaled.value.exitCode).toBe(-1);
    const missing = await collectOnce(sourceOf([]));
    expect(missing).toEqual(err({ message: "the command ended without an exit event" }));
  });
});

/** 실제 시간으로 조건을 기다린다. 시험의 실제 자식은 가짜 시계를 쓰지 않는다 */
function waitReal(what: string, condition: () => boolean, limitMs: number): Promise<void> {
  const deadline = Date.now() + limitMs;
  return repeatAsync<void>(async () => {
    if (condition()) return { value: undefined };
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 10);
    });
    return undefined;
  });
}

/**
 * 자식 대역. stdin 줄마다 `echo <줄>`을 stdout에 쓰고, 받은 줄을 `PROBE_LOG` 파일에도 남긴다(종료 뒤에는 stdout이 버려지므로).
 * stdin이 닫히면 끝난다.
 */
const PROBE_SOURCE = [
  'import { appendFileSync } from "node:fs";',
  'import { createInterface } from "node:readline";',
  'const logFile = process.env["PROBE_LOG"] ?? "";',
  "const lines = createInterface({ input: process.stdin });",
  'lines.on("line", (line) => {',
  "  appendFileSync(logFile, line + '\\n');",
  "  process.stdout.write('echo ' + line + '\\n');",
  "});",
  "",
].join("\n");

describe("production launcher against a real child process", () => {
  test("stdin reaches the engine, its stdout reaches the page, and graceful shutdown ends it", async () => {
    const fake = fakeCtx();
    const probe = path.join(fake.dir, "engine-probe.ts");
    const probeLog = path.join(fake.dir, "engine-probe.log");
    writeFileSync(probe, PROBE_SOURCE);
    const log = recordingLog();
    const relay = createRelay({ kind: "stopped" });
    const sink = recordingSink();
    relay.attach(sink);
    const scheduler = nodeScheduler();
    const supervisor = new Supervisor({
      launcher: pipedLauncher({
        env: {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          PROBE_LOG: probeLog,
          FRESNEL_DESKTOP_ENGINE_BIN: process.execPath,
          FRESNEL_DESKTOP_ENGINE_ARGS: `${probe} host --stdio`,
        },
        platform: process.platform,
        arch: process.arch,
        resources: fake.dir,
        home: fake.dir,
        log,
        scheduler,
      }),
      relay,
      config: engineConfigFrom(null, null),
      log,
      clock: { now: () => Date.now(), scheduler },
    });
    let pid: number | null = null;
    supervisor.start();
    try {
      await waitReal("running", () => relay.state().kind === "running", 4000);
      const state = relay.state();
      pid = state.kind === "running" ? state.pid : null;
      expect(await supervisor.write(enc('{"id":1}\n'))).toEqual(ok(undefined));
      await waitReal("the echo", () => sink.text().includes('echo {"id":1}'), 4000);

      const startedAt = Date.now();
      await supervisor.shutdown();
      expect(Date.now() - startedAt).toBeLessThan(4000);
      // 엔진은 종료 요청 줄을 EOF 전에 읽었다. 종료가 시작되면 stdout 바이트는 버린다(Rust begin_drain과 같다)
      expect(readFileSync(probeLog, "utf8")).toContain('"method":"host.shutdown"');
      expect(relay.state()).toEqual({ kind: "stopped" });
      expect(pid).not.toBeNull();
      if (pid !== null) {
        const alive = attempt(() => {
          process.kill(pid ?? 0, 0);
        }).ok;
        expect(alive).toBe(false);
      }
    } finally {
      supervisor.killRemaining();
    }
  });

  test("a sidecar that is not installed is a launch failure, and the engine state is failed", async () => {
    const fake = fakeCtx();
    const log = recordingLog();
    const relay = createRelay({ kind: "stopped" });
    const sink = recordingSink();
    relay.attach(sink);
    const scheduler = nodeScheduler();
    const supervisor = new Supervisor({
      launcher: pipedLauncher({
        env: { PATH: "/usr/bin:/bin" },
        platform: process.platform,
        arch: process.arch,
        resources: fake.dir,
        home: fake.dir,
        log,
        scheduler,
      }),
      relay,
      config: engineConfigFrom(null, null),
      log,
      clock: { now: () => Date.now(), scheduler },
    });
    supervisor.start();
    await waitReal("failed", () => relay.state().kind === "failed", 4000);
    expect(log.lines).toContain("launch failed: sidecar `fresnel` is not available");
    expect(relay.state()).toMatchObject({ kind: "failed", attempts: 0 });
  });
});
