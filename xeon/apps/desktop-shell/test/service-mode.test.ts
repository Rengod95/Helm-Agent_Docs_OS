// 서비스 모드 시험. 가짜 launcher가 응답을 미리 정하고 부른 인자와 띄운 대상을 기록한다. 실제 프로세스는 없다.
import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { LaunchFailure, Launched, Launcher, OnceOutput } from "../src/main/engine/launcher.ts";
import type { SafeMode } from "../src/main/engine/policy.ts";
import type { EngineTarget } from "../src/main/engine/state.ts";
import { createServiceModule, serviceAwareLauncher } from "../src/main/service-mode.ts";
import { recordingLog, sourceOf } from "./engine/support.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

const LOCAL: EngineTarget = { kind: "local" };
const SOCKET = "/tmp/x/fresnel.sock";
const BRIDGE: EngineTarget = { kind: "remote", address: `unix:${SOCKET}` };
const LAUNCH_MODE = "service launch-mode";
const ENSURE = "service ensure --json";
const ENSURE_SAFE = "service ensure --json --safe-mode";

type OnceReply = Result<OnceOutput, LaunchFailure>;

interface Launch {
  readonly target: EngineTarget;
  readonly safeMode: SafeMode;
}

interface Inner {
  readonly launcher: Launcher;
  /** 부른 `runOnce` 인자들 */
  readonly runs: string[][];
  /** 띄우려고 부른 대상들 */
  readonly launches: Launch[];
  /** 그룹 종료를 받은 자식의 pid */
  readonly killed: number[];
}

interface InnerOptions {
  /** 인자를 `join(" ")`한 키로 고르는 응답. 없는 인자는 종료 0과 빈 출력이다 */
  readonly replies?: Readonly<Record<string, OnceReply>>;
  /** 이 대상을 띄울 때 실패한다 */
  readonly failLaunch?: (target: EngineTarget) => boolean;
}

/** 응답과 실패 대상을 미리 정하는 가짜 launcher. 띄운 자식의 pid는 2001부터 1씩 오른다 */
function innerOf(options: InnerOptions = {}): Inner {
  const replies = options.replies ?? {};
  const failLaunch = options.failLaunch ?? (() => false);
  const runs: string[][] = [];
  const launches: Launch[] = [];
  const killed: number[] = [];
  const launcher: Launcher = {
    launch: (target, safeMode) => {
      launches.push({ target, safeMode });
      if (failLaunch(target)) return Promise.resolve(err({ message: "spawn failed: ENOENT" }));
      const pid = 2000 + launches.length;
      const child: Launched = {
        pid,
        events: sourceOf([]),
        stdin: { write: () => Promise.resolve(), close: () => undefined },
        killGroup: () => {
          killed.push(pid);
        },
      };
      return Promise.resolve(ok(child));
    },
    runOnce: (args) => {
      runs.push([...args]);
      return Promise.resolve(
        replies[args.join(" ")] ?? ok({ exitCode: 0, stdout: "", stderr: "" }),
      );
    },
  };
  return { launcher, runs, launches, killed };
}

function out(exitCode: number, stdout: string, stderr = ""): OnceReply {
  return ok({ exitCode, stdout, stderr });
}

/** 성공 값을 꺼낸다. 실패면 시험이 실패한다 */
function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("expected a success");
  return result.value;
}

const SERVICE_MODE = out(0, '{"mode":"service"}');
const ENSURE_OK = out(
  0,
  JSON.stringify({ ok: true, socket: SOCKET, version: "1.2.3", action: "connected" }),
);

describe("serviceAwareLauncher", () => {
  test("with service mode off the in-process sidecar is launched and nothing is bridged", async () => {
    const inner = innerOf({ replies: { [LAUNCH_MODE]: out(0, '{"mode":"in-process"}') } });
    const log = recordingLog();
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, log).launch(LOCAL, "default"),
    );
    expect(launched.viaService).toBeUndefined();
    expect(inner.launches).toEqual([{ target: LOCAL, safeMode: "default" }]);
    expect(inner.runs).toEqual([["service", "launch-mode"]]);
    expect(log.lines).toEqual([]);
  });

  test("with service mode on and ensure ok the bridge is launched and the result is viaService", async () => {
    const inner = innerOf({ replies: { [LAUNCH_MODE]: SERVICE_MODE, [ENSURE]: ENSURE_OK } });
    const log = recordingLog();
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, log).launch(LOCAL, "default"),
    );
    expect(inner.runs).toEqual([
      ["service", "launch-mode"],
      ["service", "ensure", "--json"],
    ]);
    expect(inner.launches).toEqual([{ target: BRIDGE, safeMode: "default" }]);
    expect(launched.viaService).toBe(true);
    expect(launched.pid).toBe(2001);
    launched.killGroup();
    expect(inner.killed).toEqual([2001]);
    expect(log.lines).toEqual([]);
  });

  test("safe mode on adds --safe-mode to the ensure args", async () => {
    const inner = innerOf({ replies: { [LAUNCH_MODE]: SERVICE_MODE, [ENSURE_SAFE]: ENSURE_OK } });
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, recordingLog()).launch(LOCAL, "on"),
    );
    expect(inner.runs).toEqual([
      ["service", "launch-mode"],
      ["service", "ensure", "--json", "--safe-mode"],
    ]);
    expect(inner.launches).toEqual([{ target: BRIDGE, safeMode: "on" }]);
    expect(launched.viaService).toBe(true);
  });

  test("ensure exiting 1 falls back to the in-process sidecar and logs one line", async () => {
    const inner = innerOf({
      replies: { [LAUNCH_MODE]: SERVICE_MODE, [ENSURE]: out(1, "", "boom") },
    });
    const log = recordingLog();
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, log).launch(LOCAL, "default"),
    );
    expect(inner.launches).toEqual([{ target: LOCAL, safeMode: "default" }]);
    expect(launched.viaService).toBeUndefined();
    expect(log.lines).toEqual(["service-mode: ensure failed exit=1, using the in-process engine"]);
  });

  test("launch-mode output that is not JSON falls back without ensure", async () => {
    const inner = innerOf({ replies: { [LAUNCH_MODE]: out(0, "not json") } });
    const log = recordingLog();
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, log).launch(LOCAL, "default"),
    );
    expect(inner.runs).toEqual([["service", "launch-mode"]]);
    expect(inner.launches).toEqual([{ target: LOCAL, safeMode: "default" }]);
    expect(launched.viaService).toBeUndefined();
    expect(log.lines).toEqual([
      "service-mode: launch-mode output is not readable, using the in-process engine",
    ]);
  });

  test("an ensure answer with a relative socket is not used", async () => {
    const inner = innerOf({
      replies: {
        [LAUNCH_MODE]: SERVICE_MODE,
        [ENSURE]: out(
          0,
          JSON.stringify({ ok: true, socket: "fresnel.sock", version: "1", action: "spawned" }),
        ),
      },
    });
    const log = recordingLog();
    await serviceAwareLauncher(inner.launcher, log).launch(LOCAL, "default");
    expect(inner.launches).toEqual([{ target: LOCAL, safeMode: "default" }]);
    expect(log.lines).toEqual([
      "service-mode: ensure output is not usable, using the in-process engine",
    ]);
  });

  test("a bridge that cannot be launched falls back to the sidecar, and the log has no address", async () => {
    const inner = innerOf({
      replies: { [LAUNCH_MODE]: SERVICE_MODE, [ENSURE]: ENSURE_OK },
      failLaunch: (target) => target.kind === "remote",
    });
    const log = recordingLog();
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, log).launch(LOCAL, "default"),
    );
    expect(inner.launches).toEqual([
      { target: BRIDGE, safeMode: "default" },
      { target: LOCAL, safeMode: "default" },
    ]);
    expect(launched.viaService).toBeUndefined();
    expect(log.lines).toEqual([
      "service-mode: bridge launch failed (spawn failed: ENOENT), using the in-process engine",
    ]);
    expect(log.lines.join("\n")).not.toContain(SOCKET);
  });

  test("a remote target is launched unchanged and runs no service command", async () => {
    const inner = innerOf();
    const target: EngineTarget = { kind: "remote", address: "tcp://host:1234" };
    const launched = valueOf(
      await serviceAwareLauncher(inner.launcher, recordingLog()).launch(target, "on"),
    );
    expect(inner.runs).toEqual([]);
    expect(inner.launches).toEqual([{ target, safeMode: "on" }]);
    expect(launched.viaService).toBeUndefined();
  });
});

/** 서비스 명령 모듈을 가짜 ctx에 등록하고, 부른 `runOnce` 인자를 함께 돌려준다 */
function commandRig(replies: Readonly<Record<string, OnceReply>> = {}) {
  const inner = innerOf({ replies });
  const fake = fakeCtx();
  createServiceModule({ launcherOf: () => inner.launcher }).register(fake.ctx);
  return { fake, runs: inner.runs };
}

describe("service_status", () => {
  test("a running service answers with the registration's socket, pid, version and start time only", async () => {
    const running = JSON.stringify({
      running: true,
      registration: {
        socket: SOCKET,
        pid: 4321,
        startedAt: 1_700_000_000_000,
        version: "1.2.3",
        token: "SECRET",
      },
      status: { engines: 1, token: "SECRET" },
    });
    const r = commandRig({ "service status --json": out(0, running) });
    const reply = await r.fake.call("service_status");
    expect(reply).toEqual({
      ok: true,
      value: {
        running: true,
        socket: SOCKET,
        pid: 4321,
        version: "1.2.3",
        startedAt: 1_700_000_000_000,
      },
    });
    expect(JSON.stringify(reply)).not.toContain("SECRET");
    expect(r.runs).toEqual([["service", "status", "--json"]]);
  });

  test("exit 1 with running false is a normal not-running answer", async () => {
    const r = commandRig({
      "service status --json": out(1, '{"running":false,"reason":"no registration"}'),
    });
    expect(await r.fake.call("service_status")).toEqual({
      ok: true,
      value: { running: false, reason: "no registration" },
    });
  });

  test("output that cannot be read, or a command that cannot run, is storage-failed", async () => {
    const garbled = commandRig({ "service status --json": out(0, "not json") });
    expect(await garbled.fake.call("service_status")).toEqual({
      ok: false,
      error: "storage-failed",
    });
    const missing = commandRig({ "service status --json": out(0, '{"running":true}') });
    expect(await missing.fake.call("service_status")).toEqual({
      ok: false,
      error: "storage-failed",
    });
    const spawn = commandRig({ "service status --json": err({ message: "spawn failed" }) });
    expect(await spawn.fake.call("service_status")).toEqual({ ok: false, error: "storage-failed" });
  });
});

describe("service_ensure and service_stop", () => {
  test("ensure answers with the socket, version and action", async () => {
    const r = commandRig({
      [ENSURE]: out(
        0,
        JSON.stringify({ ok: true, socket: SOCKET, version: "1.2.3", action: "spawned" }),
      ),
    });
    expect(await r.fake.call("service_ensure")).toEqual({
      ok: true,
      value: { socket: SOCKET, version: "1.2.3", action: "spawned" },
    });
    expect(r.runs).toEqual([["service", "ensure", "--json"]]);
  });

  test("ensure exiting non-zero is start_failed", async () => {
    const r = commandRig({ [ENSURE]: out(1, "", "no binary") });
    expect(await r.fake.call("service_ensure")).toEqual({ ok: false, error: "start_failed" });
  });

  test("stop answers stopped true, and a non-zero exit is service_failed", async () => {
    const stopped = commandRig({ "service stop": out(0, "") });
    expect(await stopped.fake.call("service_stop")).toEqual({ ok: true, value: { stopped: true } });
    expect(stopped.runs).toEqual([["service", "stop"]]);
    const failed = commandRig({ "service stop": out(1, "") });
    expect(await failed.fake.call("service_stop")).toEqual({ ok: false, error: "service_failed" });
  });
});
