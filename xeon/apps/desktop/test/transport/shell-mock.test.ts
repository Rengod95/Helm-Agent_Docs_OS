import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/app/bootstrap.ts";
import { err, ok, type Result } from "@fresnel/contracts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, until } from "../app/support.ts";
import { BACKUP_REPORT, PREVIOUS_REMOVED, STORAGE_USAGE, fakeIpc } from "./fake-ipc.ts";
import { rawShellIpc, shellMockIpc } from "./shell-mock.ts";
import type { IpcError, ServiceAutostart, ServiceStatusReply } from "../../src/transport/ipc.ts";

// createDesktopIpc를 Electron 다리 위에서: 명령 이름과 인자 모양, 채널 메시지(바이트와 상태)의 해석, 오류 코드 변환을 본다.

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function mocked(fake = fakeIpc()): ReturnType<typeof shellMockIpc> {
  const shell = shellMockIpc(fake);
  disposers.push(shell.dispose);
  return shell;
}

describe("createDesktopIpc over the shell bridge", () => {
  test("attach sends two channels, parses the result and delivers bytes and states", async () => {
    const fake = fakeIpc({ state: { kind: "running", source: "sidecar", pid: 7 } });
    const shell = mocked(fake);
    const chunks: string[] = [];
    const states: string[] = [];
    const attached = await shell.ipc.attach(
      (chunk) => void chunks.push(new TextDecoder().decode(chunk)),
      (state) => void states.push(state.kind),
    );
    expect(attached).toEqual({
      ok: true,
      value: { epoch: 1, state: { kind: "running", source: "sidecar", pid: 7 } },
    });
    expect(shell.calls.map((c) => c.cmd)).toEqual(["engine_attach"]);
    fake.emitLine({ jsonrpc: "2.0", id: "a", result: {} });
    fake.emitState({ kind: "stopping" });
    // 모르는 상태는 버린다(셸이 보낸 값도 프로세스 밖의 값이다)
    shell.sendRawState({ kind: "paused" });
    expect(chunks).toEqual(['{"jsonrpc":"2.0","id":"a","result":{}}\n']);
    expect(states).toEqual(["stopping"]);
  });

  test("write, ack, restart and detach map to engine_* commands with their arguments", async () => {
    const fake = fakeIpc();
    const shell = mocked(fake);
    await shell.ipc.attach(
      () => {},
      () => {},
    );
    const frame = new TextEncoder().encode('{"jsonrpc":"2.0","method":"x"}\n');
    expect((await shell.ipc.write(1, frame)).ok).toBe(true);
    expect((await shell.ipc.ack(1, 256)).ok).toBe(true);
    expect((await shell.ipc.restart()).ok).toBe(true);
    expect((await shell.ipc.detach(1)).ok).toBe(true);
    expect(shell.calls.slice(1).map((c) => c.cmd)).toEqual([
      "engine_write",
      "engine_ack",
      "engine_restart",
      "engine_detach",
    ]);
    expect(shell.calls[1]?.args).toEqual(frame);
    expect(shell.calls[2]?.args).toEqual({ epoch: 1, bytes: 256 });
    expect(fake.written.map((w) => w.text)).toEqual(['{"jsonrpc":"2.0","method":"x"}\n']);
    expect(fake.acks).toEqual([{ epoch: 1, bytes: 256 }]);
    expect(fake.detached).toEqual([1]);
  });

  test("restart sends only the options it was given as the engine_restart arguments", async () => {
    const fake = fakeIpc();
    const shell = mocked(fake);
    await shell.ipc.attach(
      () => {},
      () => {},
    );
    expect((await shell.ipc.restart({ safeMode: true, confirmed: true })).ok).toBe(true);
    expect((await shell.ipc.restart()).ok).toBe(true);
    // 빠진 키는 인자에 없다(undefined 값도 두지 않는다)
    expect((await shell.ipc.restart({ confirmed: false })).ok).toBe(true);
    expect(shell.calls.slice(1).map((c) => [c.cmd, c.args])).toStrictEqual([
      ["engine_restart", { safeMode: true, confirmed: true }],
      ["engine_restart", {}],
      ["engine_restart", { confirmed: false }],
    ]);
    expect(fake.restarts).toStrictEqual([
      { safeMode: true, confirmed: true },
      {},
      { confirmed: false },
    ]);
  });

  test("a string rejection from the shell becomes the command error code; anything else is unknown", async () => {
    const fake = fakeIpc({
      writeError: { kind: "command", command: "engine_write", code: "epoch-stale" },
    });
    const shell = mocked(fake);
    await shell.ipc.attach(
      () => {},
      () => {},
    );
    expect(await shell.ipc.write(1, new Uint8Array([10]))).toEqual({
      ok: false,
      error: { kind: "command", command: "engine_write", code: "epoch-stale" },
    });
  });

  test("an attach result that does not match the schema is an invalid error", async () => {
    // 세대가 0인 결과는 셸이 보내서는 안 된다(TY-10: 셸의 값도 프로세스 밖의 값이다)
    const ipc = rawShellIpc(() => ({ epoch: 0, state: { kind: "stopped" } }));
    const attached = await ipc.attach(
      () => {},
      () => {},
    );
    expect(attached).toEqual({ ok: false, error: { kind: "invalid", command: "engine_attach" } });
  });
});

describe("db_restore over the shell bridge", () => {
  test("sends the backup folder as backupDir and hands back the exit code and both outputs", async () => {
    const reply = {
      exitCode: 3,
      stdout: "",
      stderr: "fresnel: 실행 중인 엔진이 데이터베이스를 쓰고 있다\n",
    };
    const fake = fakeIpc({ dbRestoreResult: ok(reply) });
    const shell = mocked(fake);
    expect(await shell.ipc.dbRestore("/backups/export-1")).toEqual({ ok: true, value: reply });
    expect(shell.calls.map((call) => [call.cmd, call.args])).toEqual([
      ["db_restore", { backupDir: "/backups/export-1" }],
    ]);
    expect(fake.restored).toEqual(["/backups/export-1"]);
  });

  test("a string rejection from the shell becomes the command code", async () => {
    const fake = fakeIpc({
      dbRestoreResult: err({ kind: "command", command: "db_restore", code: "busy" }),
    });
    const shell = mocked(fake);
    expect(await shell.ipc.dbRestore("/backups/export-1")).toEqual({
      ok: false,
      error: { kind: "command", command: "db_restore", code: "busy" },
    });
  });

  test("a reply that does not match the schema is an invalid error", async () => {
    // 종료 코드가 정수가 아니면 셸이 보낸 값이 아니다(TY-10)
    const ipc = rawShellIpc(() => ({ exitCode: "3", stdout: "", stderr: "" }));
    expect(await ipc.dbRestore("/backups/export-1")).toEqual({
      ok: false,
      error: { kind: "invalid", command: "db_restore" },
    });
  });
});

describe("the storage tools over the shell bridge", () => {
  test("db_export sends the parent folder as parent and hands back the exit code and both outputs", async () => {
    const reply = { exitCode: 0, stdout: JSON.stringify(BACKUP_REPORT), stderr: "" };
    const fake = fakeIpc({ dbExportResult: ok(reply) });
    const shell = mocked(fake);
    expect(await shell.ipc.dbExport("/Users/me/Desktop")).toEqual({ ok: true, value: reply });
    expect(shell.calls.map((call) => [call.cmd, call.args])).toEqual([
      ["db_export", { parent: "/Users/me/Desktop" }],
    ]);
    expect(fake.dbExportCalls).toEqual(["/Users/me/Desktop"]);
  });

  test("db_usage is called without arguments and hands back the usage reply", async () => {
    const fake = fakeIpc();
    const shell = mocked(fake);
    expect(await shell.ipc.dbUsage()).toEqual({
      ok: true,
      value: { exitCode: 0, stdout: JSON.stringify(STORAGE_USAGE), stderr: "" },
    });
    expect(shell.calls.map((call) => call.cmd)).toEqual(["db_usage"]);
    expect(fake.dbUsageCalls).toBe(1);
  });

  test("db_previous_remove sends the copy name as name", async () => {
    const fake = fakeIpc();
    const shell = mocked(fake);
    const name = "20261104T000000000Z";
    expect(await shell.ipc.dbPreviousRemove(name)).toEqual({
      ok: true,
      value: { exitCode: 0, stdout: JSON.stringify(PREVIOUS_REMOVED), stderr: "" },
    });
    expect(shell.calls.map((call) => [call.cmd, call.args])).toEqual([
      ["db_previous_remove", { name }],
    ]);
    expect(fake.dbPreviousRemoveCalls).toEqual([name]);
  });

  test("a string rejection from db_export becomes the command code", async () => {
    const fake = fakeIpc({
      dbExportResult: err({ kind: "command", command: "db_export", code: "remote-target" }),
    });
    const shell = mocked(fake);
    expect(await shell.ipc.dbExport("/Users/me/Desktop")).toEqual({
      ok: false,
      error: { kind: "command", command: "db_export", code: "remote-target" },
    });
  });

  test("open_data_dir sends no arguments and a null reply is success", async () => {
    const fake = fakeIpc();
    const shell = mocked(fake);
    expect(await shell.ipc.openDataDir()).toEqual({ ok: true, value: null });
    expect(shell.calls.map((call) => call.cmd)).toEqual(["open_data_dir"]);
    expect(fake.openDataDirCalls).toBe(1);
  });

  test("a reply to open_data_dir that is not null is an invalid error", async () => {
    const ipc = rawShellIpc(() => "/data");
    expect(await ipc.openDataDir()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "open_data_dir" },
    });
  });

  test("a db_usage reply whose exit code is not an integer is an invalid error", async () => {
    // 종료 코드가 정수가 아니면 셸이 보낸 값이 아니다(TY-10)
    const ipc = rawShellIpc(() => ({ exitCode: "0", stdout: "{}", stderr: "" }));
    expect(await ipc.dbUsage()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "db_usage" },
    });
  });
});

/** 자동 시작 객체의 한 칸을 바꾼 `service_status` 답(등록 안 됨). 자동 시작 객체 모양을 시험할 때 쓴다 */
function notRunningWith(patch: Record<string, unknown>): unknown {
  return {
    running: false,
    reason: "no registration",
    autostart: {
      supported: true,
      registered: true,
      active: true,
      linger: false,
      platform: "linux",
      ...patch,
    },
  };
}

describe("the service commands over the shell bridge", () => {
  const SOCKET = "/Users/me/Library/Application Support/fresnel/service.sock";
  const AUTOSTART: ServiceAutostart = {
    supported: true,
    registered: true,
    active: true,
    linger: false,
    platform: "linux",
  };

  test("service_status sends no arguments and passes the running answer through, autostart included", async () => {
    const running: ServiceStatusReply = {
      running: true,
      socket: SOCKET,
      pid: 4321,
      version: "1.2.3",
      startedAt: 1_700_000_000_000,
      autostart: AUTOSTART,
    };
    const fake = fakeIpc({ serviceStatusResult: ok(running) });
    const shell = mocked(fake);
    expect(await shell.ipc.serviceStatus()).toEqual({ ok: true, value: running });
    expect(shell.calls.map((call) => call.cmd)).toEqual(["service_status"]);
  });

  test("a not-running answer carries its reason and the autostart state", async () => {
    const ipc = rawShellIpc(() => ({
      running: false,
      reason: "no registration",
      autostart: { ...AUTOSTART, registered: false, active: false, linger: null },
    }));
    expect(await ipc.serviceStatus()).toEqual({
      ok: true,
      value: {
        running: false,
        reason: "no registration",
        autostart: { ...AUTOSTART, registered: false, active: false, linger: null },
      },
    });
  });

  test("a status answer with an extra field, a missing one, or no autostart is an invalid error", async () => {
    const extra = rawShellIpc(() => ({
      running: false,
      reason: "no registration",
      autostart: AUTOSTART,
      token: "x",
    }));
    expect(await extra.serviceStatus()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "service_status" },
    });
    const partial = rawShellIpc(() => ({
      running: true,
      socket: SOCKET,
      pid: 1,
      version: "1.2.3",
      startedAt: 1,
    }));
    expect(await partial.serviceStatus()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "service_status" },
    });
    const noAutostart = rawShellIpc(() => ({ running: false, reason: "no registration" }));
    expect(await noAutostart.serviceStatus()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "service_status" },
    });
  });

  test("the autostart object is closed and typed in both arms", async () => {
    const invalid: Result<ServiceStatusReply, IpcError> = {
      ok: false,
      error: { kind: "invalid", command: "service_status" },
    };
    expect(
      await rawShellIpc(() => notRunningWith({ path: "/Users/me/x.plist" })).serviceStatus(),
    ).toEqual(invalid);
    expect(await rawShellIpc(() => notRunningWith({ linger: "yes" })).serviceStatus()).toEqual(
      invalid,
    );
    expect(
      await rawShellIpc(() => notRunningWith({ supported: undefined })).serviceStatus(),
    ).toEqual(invalid);
    const runningWithout = rawShellIpc(() => ({
      running: true,
      socket: SOCKET,
      pid: 1,
      version: "1.2.3",
      startedAt: 1,
      autostart: { ...AUTOSTART, platform: 3 },
    }));
    expect(await runningWithout.serviceStatus()).toEqual(invalid);
  });

  test("a rejected service_status is a command error with the shell code", async () => {
    const fake = fakeIpc({
      serviceStatusResult: err({
        kind: "command",
        command: "service_status",
        code: "storage-failed",
      }),
    });
    const shell = mocked(fake);
    expect(await shell.ipc.serviceStatus()).toEqual({
      ok: false,
      error: { kind: "command", command: "service_status", code: "storage-failed" },
    });
  });

  test("service_ensure answers with the socket, version and action, and a rejection keeps its code", async () => {
    const shell = mocked(fakeIpc());
    expect(await shell.ipc.serviceEnsure()).toEqual({
      ok: true,
      value: { socket: "/run/fresnel/service.sock", version: "1.2.3", action: "spawned" },
    });
    expect(shell.calls.map((call) => call.cmd)).toEqual(["service_ensure"]);
    const failed = mocked(
      fakeIpc({
        serviceEnsureResult: err({
          kind: "command",
          command: "service_ensure",
          code: "start_failed",
        }),
      }),
    );
    expect(await failed.ipc.serviceEnsure()).toEqual({
      ok: false,
      error: { kind: "command", command: "service_ensure", code: "start_failed" },
    });
  });

  test("service_stop answers stopped true, and a rejection keeps its code", async () => {
    const shell = mocked(fakeIpc());
    expect(await shell.ipc.serviceStop()).toEqual({ ok: true, value: { stopped: true } });
    expect(shell.calls.map((call) => call.cmd)).toEqual(["service_stop"]);
    const failed = mocked(
      fakeIpc({
        serviceStopResult: err({
          kind: "command",
          command: "service_stop",
          code: "service_failed",
        }),
      }),
    );
    expect(await failed.ipc.serviceStop()).toEqual({
      ok: false,
      error: { kind: "command", command: "service_stop", code: "service_failed" },
    });
  });

  test("a stop answer that is not stopped true is an invalid error", async () => {
    const ipc = rawShellIpc(() => ({ stopped: false }));
    expect(await ipc.serviceStop()).toEqual({
      ok: false,
      error: { kind: "invalid", command: "service_stop" },
    });
  });

  test("service_autostart_set sends { enabled } and answers with the linger advice", async () => {
    const shell = mocked(fakeIpc());
    expect(await shell.ipc.serviceAutostartSet(true)).toEqual({
      ok: true,
      value: { enabled: true, lingerAdvice: false },
    });
    expect(await shell.ipc.serviceAutostartSet(false)).toEqual({
      ok: true,
      value: { enabled: false, lingerAdvice: false },
    });
    expect(shell.calls).toEqual([
      { cmd: "service_autostart_set", args: { enabled: true } },
      { cmd: "service_autostart_set", args: { enabled: false } },
    ]);
    const linger = mocked(
      fakeIpc({ serviceAutostartSetResult: ok({ enabled: true, lingerAdvice: true }) }),
    );
    expect(await linger.ipc.serviceAutostartSet(true)).toEqual({
      ok: true,
      value: { enabled: true, lingerAdvice: true },
    });
  });

  test("a rejected service_autostart_set keeps the shell code", async () => {
    const failed = mocked(
      fakeIpc({
        serviceAutostartSetResult: err({
          kind: "command",
          command: "service_autostart_set",
          code: "autostart_failed",
        }),
      }),
    );
    expect(await failed.ipc.serviceAutostartSet(true)).toEqual({
      ok: false,
      error: { kind: "command", command: "service_autostart_set", code: "autostart_failed" },
    });
  });

  test("a set answer without lingerAdvice, or with an extra field, is an invalid error", async () => {
    const missing = rawShellIpc(() => ({ enabled: true }));
    expect(await missing.serviceAutostartSet(true)).toEqual({
      ok: false,
      error: { kind: "invalid", command: "service_autostart_set" },
    });
    const extra = rawShellIpc(() => ({ enabled: true, lingerAdvice: false, path: "/x" }));
    expect(await extra.serviceAutostartSet(true)).toEqual({
      ok: false,
      error: { kind: "invalid", command: "service_autostart_set" },
    });
  });
});

describe("the whole app over the shell bridge", () => {
  test("attach, hello, subscribe and thread.list reach a live link through the real ipc.ts", async () => {
    const { fake, methods } = engineFake([summary(thr(1))]);
    const shell = mocked(fake);
    const app = createApp({
      ipc: shell.ipc,
      clock: { now: () => Date.now() },
      scheduler: {
        setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
        clearTimeout: (h) => clearTimeout(h),
      },
      frames: {
        requestAnimationFrame: (cb) => Number(setTimeout(() => cb(0), 0)),
        cancelAnimationFrame: (h) => clearTimeout(h),
      },
      monotonic: () => performance.now(),
      clipboard: { writeText: () => Promise.resolve() },
      appVersion: "0.0.0",
      frameFallbackMs: 20,
      logSink: () => {},
    });
    await until(() => app.engine.read.getState().link.phase === "live", "live link");
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    expect(methods.slice(0, 5)).toEqual([
      "$/connectionReset",
      "host.hello",
      "events.subscribe",
      "events.subscribe",
      "thread.list",
    ]);
    expect(app.engine.read.getState().threads.ids).toEqual([thr(1)]);
    await app.stop();
  });
});
