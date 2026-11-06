// 엔진 명령 시험(relay.rs의 명령과 db_restore 검사). 가짜 ctx의 명령 등록부를 거쳐 renderer가 받는 모양을 본다.
import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import { engineConfigFrom } from "../../src/main/engine/policy.ts";
import { MAX_WRITE_BYTES } from "../../src/main/engine/relay.ts";
import {
  onWindowClosed,
  registerEngine,
  relayOf,
  type ClosableWindow,
} from "../../src/main/engine.ts";
import { fakeCtx, type FakeCtx } from "../support/fake-ctx.ts";
import {
  EOF_EXIT,
  enc,
  FakeLauncher,
  fakeClock,
  recordingLog,
  until,
  type FakeBehavior,
  type RecordingLog,
} from "./support.ts";

const REMOTE_ADDRESS = "tcp://secret-host.example:1234";

interface Harness {
  readonly fake: FakeCtx;
  readonly launcher: FakeLauncher;
  readonly log: RecordingLog;
}

/** 명령을 등록한 가짜 ctx. 감독자는 가짜 launcher와 가짜 시계로 돈다 */
function harness(behavior: FakeBehavior = EOF_EXIT): Harness {
  const fake = fakeCtx();
  const launcher = new FakeLauncher(behavior);
  const log = recordingLog();
  registerEngine(fake.ctx, {
    launcher,
    clock: fakeClock(),
    config: engineConfigFrom(null, null),
    log,
  });
  return { fake, launcher, log };
}

function runningOf(h: Harness): Promise<void> {
  return until("running", () => relayOf(h.fake.ctx).state().kind === "running");
}

function channelsArgs(): unknown {
  return { onBytes: { $channel: 1 }, onState: { $channel: 2 } };
}

function writeArgs(epoch: string | undefined, body: Uint8Array | string): unknown {
  const headers: Record<string, string> = epoch === undefined ? {} : { "x-fresnel-epoch": epoch };
  return { body, headers };
}

/** 페이지를 붙이고 세대 번호를 돌려준다 */
async function attach(h: Harness): Promise<number> {
  const reply = await h.fake.call("engine_attach", channelsArgs());
  if (!reply.ok || typeof reply.value !== "object" || reply.value === null) {
    throw new Error("attach did not return a value");
  }
  const epoch: unknown = Object.getOwnPropertyDescriptor(reply.value, "epoch")?.value;
  if (typeof epoch !== "number") throw new Error("epoch is not a number");
  return epoch;
}

describe("engine_attach (3.3)", () => {
  test("attach returns the epoch and the current state, and bytes go to the page's channel", async () => {
    const h = harness();
    await runningOf(h);
    const reply = await h.fake.call("engine_attach", channelsArgs());
    expect(reply).toEqual({
      ok: true,
      value: { epoch: 1, state: { kind: "running", source: "sidecar", pid: 1001 } },
    });
    h.launcher.engine(0).stdout('{"hello":1}\n');
    await until("bytes on the page channel", () => h.fake.sent.some((entry) => entry.id === 1));
    expect(h.fake.sent.find((entry) => entry.id === 1)?.message).toBeInstanceOf(Uint8Array);
  });

  test("a missing channel is a bad request", async () => {
    const h = harness();
    expect(await h.fake.call("engine_attach", { onBytes: { $channel: 1 } })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("engine_attach", {})).toEqual({ ok: false, error: "bad-request" });
  });
});

describe("engine_write (epoch and size checks, in the Rust order)", () => {
  test("a write without the epoch header, or with a body that is not raw bytes, is a bad request", async () => {
    const h = harness();
    await runningOf(h);
    await attach(h);
    expect(await h.fake.call("engine_write", writeArgs(undefined, new Uint8Array([1])))).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("engine_write", writeArgs("1x", new Uint8Array([1])))).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("engine_write", writeArgs("1", "text"))).toEqual({
      ok: false,
      error: "bad-request",
    });
  });

  test("a body over 2 MiB is too large, and that check comes before the epoch check", async () => {
    const h = harness();
    await runningOf(h);
    await attach(h);
    const big = new Uint8Array(MAX_WRITE_BYTES + 1);
    expect(await h.fake.call("engine_write", writeArgs("999", big))).toEqual({
      ok: false,
      error: "too-large",
    });
  });

  test("a stale epoch is rejected with epoch-stale and nothing reaches the engine", async () => {
    const h = harness();
    await runningOf(h);
    await attach(h);
    expect(await h.fake.call("engine_write", writeArgs("99", enc("{}\n")))).toEqual({
      ok: false,
      error: "epoch-stale",
    });
    expect(h.launcher.engine(0).written()).toBe("");
  });

  test("the current epoch writes the bytes to the engine", async () => {
    const h = harness();
    await runningOf(h);
    const epoch = await attach(h);
    expect(
      await h.fake.call("engine_write", writeArgs(String(epoch), enc('{"id":"1"}\n'))),
    ).toEqual(ok(null));
    expect(h.launcher.engine(0).written()).toBe('{"id":"1"}\n');
  });

  test("a valid epoch while the engine failed to start is engine-not-running", async () => {
    const h = harness();
    h.launcher.failLaunch = true;
    await until("failed", () => relayOf(h.fake.ctx).state().kind === "failed");
    const epoch = await attach(h);
    expect(await h.fake.call("engine_write", writeArgs(String(epoch), enc("{}\n")))).toEqual({
      ok: false,
      error: "engine-not-running",
    });
  });
});

describe("engine_detach and the window close (relay.detach, detachCurrent)", () => {
  test("detach drops only the current epoch, and a later write is epoch-stale", async () => {
    const h = harness();
    await runningOf(h);
    const epoch = await attach(h);
    expect(await h.fake.call("engine_detach", { epoch: epoch + 5 })).toEqual(ok(null));
    expect(await h.fake.call("engine_write", writeArgs(String(epoch), enc("{}\n")))).toEqual(
      ok(null),
    );
    expect(await h.fake.call("engine_detach", { epoch })).toEqual(ok(null));
    expect(await h.fake.call("engine_write", writeArgs(String(epoch), enc("{}\n")))).toEqual({
      ok: false,
      error: "epoch-stale",
    });
  });

  test("a non-number epoch to detach is a bad request", async () => {
    const h = harness();
    expect(await h.fake.call("engine_detach", { epoch: "1" })).toEqual({
      ok: false,
      error: "bad-request",
    });
  });

  test("closing the window detaches the page, and the engine keeps running", async () => {
    const h = harness();
    await runningOf(h);
    const epoch = await attach(h);
    const listeners: (() => void)[] = [];
    const stand: ClosableWindow = {
      on: (_event, listener) => {
        listeners.push(listener);
        return undefined;
      },
    };
    onWindowClosed(relayOf(h.fake.ctx))(stand);
    expect(listeners.length).toBe(1);
    for (const listener of listeners) listener();
    expect(await h.fake.call("engine_write", writeArgs(String(epoch), enc("{}\n")))).toEqual({
      ok: false,
      error: "epoch-stale",
    });
    expect(h.launcher.launches()).toBe(1);
  });
});

describe("engine_ack", () => {
  test("a missing or negative count is a bad request, and a valid ack is ok", async () => {
    const h = harness();
    await runningOf(h);
    const epoch = await attach(h);
    expect(await h.fake.call("engine_ack", { epoch })).toEqual({ ok: false, error: "bad-request" });
    expect(await h.fake.call("engine_ack", { epoch, bytes: -1 })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("engine_ack", { epoch, bytes: 1024 })).toEqual(ok(null));
  });
});

describe("engine_restart (W-35): only booleans count", () => {
  test("a running engine needs confirmed true, and a string is treated as absent", async () => {
    const h = harness();
    await runningOf(h);
    expect(await h.fake.call("engine_restart", { confirmed: "yes" })).toEqual({
      ok: false,
      error: "not-confirmed",
    });
    expect(await h.fake.call("engine_restart", { safeMode: "on", confirmed: true })).toEqual(
      ok(null),
    );
    await until("second launch", () => h.launcher.launches() === 2);
    expect(h.launcher.safeModes).toEqual(["default", "default"]);
  });

  test("a confirmed restart with safeMode true relaunches in safe mode", async () => {
    const h = harness();
    await runningOf(h);
    expect(await h.fake.call("engine_restart", { safeMode: true, confirmed: true })).toEqual(
      ok(null),
    );
    await until("second launch", () => h.launcher.launches() === 2);
    expect(h.launcher.safeModes).toEqual(["default", "on"]);
  });

  test("a failed engine restarts without confirmation", async () => {
    const h = harness();
    h.launcher.failLaunch = true;
    await until("failed", () => relayOf(h.fake.ctx).state().kind === "failed");
    h.launcher.failLaunch = false;
    expect(await h.fake.call("engine_restart", {})).toEqual(ok(null));
    await until("running", () => relayOf(h.fake.ctx).state().kind === "running");
  });
});

describe("engine_retarget (W-08)", () => {
  test("a malformed target or a bad address is a bad request, and nothing changes", async () => {
    const h = harness();
    await runningOf(h);
    expect(await h.fake.call("engine_retarget", { target: { kind: "sidecar" } })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(
      await h.fake.call("engine_retarget", { target: { kind: "remote", address: "a b" } }),
    ).toEqual({ ok: false, error: "bad-request" });
    expect(h.launcher.targets).toEqual([{ kind: "local" }]);
  });

  test("a valid target relaunches, and the address stays out of the log", async () => {
    const h = harness();
    await runningOf(h);
    expect(
      await h.fake.call("engine_retarget", {
        target: { kind: "remote", address: REMOTE_ADDRESS },
      }),
    ).toEqual(ok(null));
    await until("second launch", () => h.launcher.launches() === 2);
    expect(h.launcher.targets.at(-1)).toEqual({ kind: "remote", address: REMOTE_ADDRESS });
    expect(h.log.lines.join("\n")).not.toContain("secret-host.example");
  });
});

describe("db_restore (validation and the result shape)", () => {
  test("the backup dir is validated: blank, NUL, over-long and non-string values are bad requests", async () => {
    const h = harness();
    await runningOf(h);
    expect(await h.fake.call("db_restore", { backupDir: "  " })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("db_restore", { backupDir: "a\u0000b" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("db_restore", { backupDir: "x".repeat(4097) })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await h.fake.call("db_restore", { backupDir: 3 })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(h.launcher.calls.some((call) => call.startsWith("run-once"))).toBe(false);
  });

  test("the result is the camel-case shape, with the exit code passed through", async () => {
    const h = harness();
    await runningOf(h);
    h.launcher.scriptedOnce = ok({ exitCode: 3, stdout: "o", stderr: "e" });
    expect(await h.fake.call("db_restore", { backupDir: "/backups/a" })).toEqual({
      ok: true,
      value: { exitCode: 3, stdout: "o", stderr: "e" },
    });
  });

  test("a remote target is refused with remote-target", async () => {
    const h = harness();
    await runningOf(h);
    await h.fake.call("engine_retarget", { target: { kind: "remote", address: REMOTE_ADDRESS } });
    await until("remote launch", () => h.launcher.launches() === 2);
    await until("remote running", () => relayOf(h.fake.ctx).state().kind === "running");
    expect(await h.fake.call("db_restore", { backupDir: "/backups/a" })).toEqual({
      ok: false,
      error: "remote-target",
    });
  });
});

describe("module hooks", () => {
  test("the quit sequence shuts the engine down and kills what is left", async () => {
    const h = harness();
    await runningOf(h);
    const epoch = await attach(h);
    await h.fake.quit();
    expect(h.launcher.engine(0).stdinClosed()).toBe(true);
    expect(h.launcher.killed).toEqual([1001]);
    expect(await h.fake.call("engine_write", writeArgs(String(epoch), enc("{}\n")))).toEqual({
      ok: false,
      error: "engine-stopping",
    });
    expect(relayOf(h.fake.ctx).state()).toEqual({ kind: "stopped" });
  });

  test("the relay of a context is the same object for every caller", () => {
    const h = harness();
    expect(relayOf(h.fake.ctx)).toBe(relayOf(h.fake.ctx));
  });
});
