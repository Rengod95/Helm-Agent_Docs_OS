import { afterEach, describe, expect, test } from "bun:test";
import { createApp } from "../../src/app/bootstrap.ts";
import { err, ok } from "@fresnel/contracts";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { createDesktopIpc } from "../../src/transport/ipc.ts";
import { selectShellBridge } from "../../src/shell/index.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, until } from "../app/support.ts";
import { fakeIpc } from "./fake-ipc.ts";
import { tauriMockIpc } from "./tauri-mock.ts";

// createDesktopIpc를 mockIPC 위에서: 명령 이름과 인자 모양, Channel 메시지(바이트와 상태)의 해석, 오류 코드 변환을 본다.

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function mocked(fake = fakeIpc()): ReturnType<typeof tauriMockIpc> {
  const shell = tauriMockIpc(fake);
  disposers.push(shell.dispose);
  return shell;
}

describe("createDesktopIpc over mockIPC", () => {
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
    tauriMockIpc(fakeIpc());
    // 세대가 0인 결과는 셸이 보내서는 안 된다(TY-10: 셸의 값도 프로세스 밖의 값이다)
    mockIPC(() => ({ epoch: 0, state: { kind: "stopped" } }));
    disposers.push(() => {
      clearMocks();
    });
    const attached = await createDesktopIpc(selectShellBridge()).attach(
      () => {},
      () => {},
    );
    expect(attached).toEqual({ ok: false, error: { kind: "invalid", command: "engine_attach" } });
  });
});

describe("db_restore over mockIPC", () => {
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
    tauriMockIpc(fakeIpc());
    // 종료 코드가 정수가 아니면 셸이 보낸 값이 아니다(TY-10)
    mockIPC(() => ({ exitCode: "3", stdout: "", stderr: "" }));
    disposers.push(() => {
      clearMocks();
    });
    expect(await createDesktopIpc(selectShellBridge()).dbRestore("/backups/export-1")).toEqual({
      ok: false,
      error: { kind: "invalid", command: "db_restore" },
    });
  });
});

describe("the whole app over mockIPC", () => {
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
