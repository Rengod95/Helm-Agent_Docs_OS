// 감독자 시험(engine.rs의 감독자 단위 시험을 옮긴다). 가짜 launcher와 가짜 시계를 쓴다. 시간은 `advance`로만 간다.
import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { createRelay } from "../../src/main/engine/relay.ts";
import type { EngineTarget } from "../../src/main/engine/state.ts";
import { Supervisor } from "../../src/main/engine/supervisor.ts";
import {
  EOF_EXIT,
  enc,
  FakeLauncher,
  fakeClock,
  flush,
  recordingLog,
  recordingSink,
  until,
  type FakeBehavior,
  type FakeClock,
  type RecordingLog,
  type RecordingSink,
} from "./support.ts";

const LOCAL: EngineTarget = { kind: "local" };
const EMPTY_OUTPUT = { exitCode: 0, stdout: "", stderr: "" };
const RUN_ONCE_CHECK_A = "run-once:db restore /backups/a --check --json";
const RUN_ONCE_BACKUP_A = "run-once:db restore /backups/a --json";

function remote(address: string): EngineTarget {
  return { kind: "remote", address };
}

interface Rig {
  readonly launcher: FakeLauncher;
  readonly supervisor: Supervisor;
  readonly relay: ReturnType<typeof createRelay>;
  readonly sink: RecordingSink;
  readonly clock: FakeClock;
  readonly log: RecordingLog;
}

function rig(behavior: FakeBehavior = EOF_EXIT, restartLimit = 3): Rig {
  const launcher = new FakeLauncher(behavior);
  const relay = createRelay({ kind: "stopped" });
  const sink = recordingSink();
  relay.attach(sink);
  const clock = fakeClock();
  const log = recordingLog();
  const supervisor = new Supervisor({
    launcher,
    relay,
    config: { shutdownGraceMs: 7000, restartLimit },
    log,
    clock,
  });
  return { launcher, supervisor, relay, sink, clock, log };
}

/** 마지막으로 간 상태의 `kind` */
function lastKind(r: Rig): string | undefined {
  return r.sink.kinds().at(-1);
}

function runningUntil(r: Rig, count: number): Promise<void> {
  return until(`running ${String(count)}`, () => r.sink.runningCount() >= count);
}

describe("engine output and the first start", () => {
  test("engine output reaches the page and state goes running", async () => {
    const r = rig();
    r.supervisor.start();
    await until("running", () => r.sink.kinds().includes("running"));
    r.launcher.engine(0).stdout('{"hello":1}\n');
    await until("bytes", () => r.sink.text() !== "");
    expect(r.sink.text()).toBe('{"hello":1}\n');
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
  });

  test("a missing binary fails without retrying", async () => {
    const r = rig();
    r.launcher.failLaunch = true;
    r.supervisor.start();
    await until("failed", () => lastKind(r) === "failed");
    await r.clock.advance(60_000);
    expect(r.launcher.launches()).toBe(0);
    expect(r.sink.kinds()).toEqual(["starting", "failed"]);
  });

  test("restarted engine starts with a fresh line buffer", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).stdout('{"id":"1","resu');
    r.launcher.engine(0).crash(1);
    await until("second launch", () => r.launcher.launches() === 2);
    await runningUntil(r, 2);
    r.launcher.engine(1).stdout('{"id":"2"}\n');
    await until("bytes", () => r.sink.text() !== "");
    expect(r.sink.text()).toBe('{"id":"2"}\n');
  });
});

describe("crash, backoff and the restart limit (4.4)", () => {
  test("crashes restart with backoff then fail, and a manual restart recovers", async () => {
    const r = rig(EOF_EXIT, 2);
    r.supervisor.start();
    // 엔진 n을 띄우고 나서 죽인다. 두 번째 재기동(두 번째 종료 뒤)은 1초를 기다린다
    const crashAt = async (n: number, waitMs: number): Promise<void> => {
      await until(`launch ${String(n)}`, () => r.launcher.launches() > n);
      await until(`running ${String(n)}`, () => r.relay.state().kind === "running");
      r.launcher.engine(n).crash(1);
      await r.clock.advance(waitMs);
    };
    await crashAt(0, 0);
    await crashAt(1, 1_000);
    await crashAt(2, 0);
    await until("failed", () => lastKind(r) === "failed");
    // limit 2: 최초 1번 + 자동 재기동 2번 = 3번 뜨고, 세 번째 종료에서 failed가 된다
    expect(r.launcher.launches()).toBe(3);
    expect(r.sink.kinds()).toEqual([
      "starting",
      "running",
      "restarting",
      "starting",
      "running",
      "restarting",
      "starting",
      "running",
      "failed",
    ]);
    expect(r.relay.state()).toMatchObject({ kind: "failed", attempts: 2 });
    // 수동 재기동. 확인 없이도 failed에서는 다시 뜬다.
    expect(r.supervisor.restartManually(null, false)).toEqual(ok(undefined));
    await until("relaunch", () => r.launcher.launches() === 4);
    await until("running again", () => lastKind(r) === "running");
    expect(r.supervisor.restartManually(null, false)).toEqual(err("not-confirmed"));
  });

  test("exit during a restart backoff cancels the restart", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    // 1번째 재기동은 즉시
    r.launcher.engine(0).crash(1);
    await until("second launch", () => r.launcher.launches() === 2);
    await runningUntil(r, 2);
    // 2번째 재기동은 1초 백오프를 기다린다
    r.launcher.engine(1).crash(1);
    await until("restarting", () => lastKind(r) === "restarting");
    expect(r.supervisor.onExitRequested()).toBe("allow");
    await r.clock.advance(30_000);
    expect(r.launcher.launches()).toBe(2);
    expect(r.clock.pending()).toBe(0);
  });
});

describe("exit records carry the generation's first stderr line (4.4)", () => {
  /** 시험 시계의 출발 시각. 시계를 움직이지 않은 채 끝난 엔진의 `at`이다 */
  const AT = "2026-10-24T00:00:00.000Z";

  test("an environment exit (code 3) is not retried: failed with one launch, and a manual restart still works", async () => {
    // 한도 3: 종료코드 3이 자동 재기동을 쓰면 아래 `restarting`이 보인다
    const r = rig(EOF_EXIT, 3);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher
      .engine(0)
      .stderr("The service socket does not exist\nCheck that the service is running\n");
    r.launcher.engine(0).crash(3);
    await until("failed", () => lastKind(r) === "failed");
    await r.clock.advance(60_000);
    expect(r.launcher.launches()).toBe(1);
    expect(r.sink.kinds()).toEqual(["starting", "running", "failed"]);
    expect(r.relay.state()).toEqual({
      kind: "failed",
      attempts: 0,
      lastExit: { code: 3, signal: null, at: AT, detail: "The service socket does not exist" },
    });
    // 수동 재기동은 failed에서 확인 없이 다시 띄운다
    expect(r.supervisor.restartManually(null, false)).toEqual(ok(undefined));
    await runningUntil(r, 2);
    expect(r.launcher.launches()).toBe(2);
  });

  test("another exit code still restarts, and the record carries its first stderr line", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    // 앞의 빈 줄과 공백은 건너뛰고, 앞뒤 공백을 뗀 첫 비어 있지 않은 줄을 싣는다
    r.launcher.engine(0).stderr("\n  database is locked  \nsecond line\n");
    r.launcher.engine(0).crash(1);
    await runningUntil(r, 2);
    expect(r.sink.kinds()).toEqual(["starting", "running", "restarting", "starting", "running"]);
    expect(r.sink.states[2]).toEqual({
      kind: "restarting",
      attempt: 1,
      retryAt: AT,
      lastExit: { code: 1, signal: null, at: AT, detail: "database is locked" },
    });
  });

  test("a first line longer than 200 characters is cut to 200 characters, not bytes", async () => {
    // 가는 한 글자가 UTF-8로 세 바이트라 바이트로 자르면 66글자만 남는다
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).stderr(`${"가".repeat(201)}\n`);
    r.launcher.engine(0).crash(1);
    await until("failed", () => lastKind(r) === "failed");
    expect(r.relay.state()).toEqual({
      kind: "failed",
      attempts: 0,
      lastExit: { code: 1, signal: null, at: AT, detail: "가".repeat(200) },
    });
  });

  test("leading blank and control-only lines are skipped and the first real line is used", async () => {
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).stderr("\n   \n\t\u0007\n  first real line  \nsecond line\n");
    r.launcher.engine(0).crash(1);
    await until("failed", () => lastKind(r) === "failed");
    expect(r.relay.state()).toEqual({
      kind: "failed",
      attempts: 0,
      lastExit: { code: 1, signal: null, at: AT, detail: "first real line" },
    });
  });

  test("a last line without a newline, read after the exit, is the detail", async () => {
    // 줄 끝이 없는 꼬리는 종료 뒤에야 나온다. 그래도 세대의 첫 줄이면 싣는다
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).stderr("socket missing");
    r.launcher.engine(0).crash(1);
    await until("failed", () => lastKind(r) === "failed");
    expect(r.relay.state()).toEqual({
      kind: "failed",
      attempts: 0,
      lastExit: { code: 1, signal: null, at: AT, detail: "socket missing" },
    });
  });

  test("no stderr gives a null detail", async () => {
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).crash(1);
    await until("failed", () => lastKind(r) === "failed");
    expect(r.relay.state()).toEqual({
      kind: "failed",
      attempts: 0,
      lastExit: { code: 1, signal: null, at: AT, detail: null },
    });
  });
});

describe("graceful shutdown (4.3)", () => {
  test("writes the request, closes stdin and does not wait for the grace when the engine exits on EOF", async () => {
    const r = rig(EOF_EXIT);
    r.supervisor.start();
    await runningUntil(r, 1);
    const engine = r.launcher.engine(0);
    const startedAt = r.clock.now();
    await r.supervisor.shutdown();
    // 시간이 가지 않았다: 시한을 기다리지 않고 EOF로 끝났다
    expect(r.clock.now()).toBe(startedAt);
    expect(engine.written()).toContain('"method":"host.shutdown"');
    expect(engine.stdinClosed()).toBe(true);
    // 시한 안에 끝났더라도 남은 손자를 위해 그룹 종료를 한 번 보낸다
    expect(r.launcher.killed).toEqual([1001]);
    expect(r.sink.kinds()).toContain("stopping");
    expect(lastKind(r)).toBe("stopped");
    expect(await r.supervisor.write(enc("x\n"))).toEqual(err("engine-stopping"));
    expect(r.clock.pending()).toBe(0);
  });

  test("an engine that ignores EOF is killed only after the grace period", async () => {
    const r = rig({ exitOnEof: false, blockWrites: false, dieOnKill: true });
    r.supervisor.start();
    await runningUntil(r, 1);
    const stopping = r.supervisor.shutdown();
    await until("stdin closed", () => r.launcher.engine(0).stdinClosed());
    await r.clock.advance(6_999);
    expect(r.launcher.killed).toEqual([]);
    await r.clock.advance(1);
    await stopping;
    expect(r.launcher.killed).toEqual([1001]);
    expect(lastKind(r)).toBe("stopped");
  });

  test("shutdown proceeds while a stdin write is blocked", async () => {
    const r = rig({ exitOnEof: false, blockWrites: true, dieOnKill: true });
    r.supervisor.start();
    await runningUntil(r, 1);
    // 엔진이 stdin을 읽지 않는다. 쓰기 하나가 막히고 나머지는 대기열에 쌓인다
    const writes = [0, 1, 2, 3].map((n) => r.supervisor.write(enc(`{"n":${String(n)}}\n`)));
    expect(await Promise.all(writes)).toEqual([
      ok(undefined),
      ok(undefined),
      ok(undefined),
      ok(undefined),
    ]);
    const stopping = r.supervisor.shutdown();
    await r.clock.advance(7_000);
    await stopping;
    expect(r.launcher.killed).toEqual([1001]);
    expect(lastKind(r)).toBe("stopped");
  });

  test("exit requested prevents once then allows", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.onExitRequested()).toBe("preventAndShutdown");
    expect(r.supervisor.onExitRequested()).toBe("prevent");
    await r.supervisor.shutdown();
    r.supervisor.allowExit();
    expect(r.supervisor.onExitRequested()).toBe("allow");
  });

  test("a shutdown that finds no live engine still stops the loop", async () => {
    const r = rig();
    expect(r.supervisor.onExitRequested()).toBe("allow");
    r.supervisor.start();
    await until("stopped", () => lastKind(r) === "stopped");
    expect(r.launcher.launches()).toBe(0);
  });
});

describe("retarget (W-08)", () => {
  test("retarget to the current target does not restart the engine", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.retarget(LOCAL)).toEqual(ok(undefined));
    await r.clock.advance(30_000);
    expect(r.launcher.launches()).toBe(1);
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
    expect(r.launcher.killed).toEqual([]);

    const target = remote("tcp://host:1234");
    expect(r.supervisor.retarget(target)).toEqual(ok(undefined));
    expect(r.supervisor.retarget(target)).toEqual(ok(undefined));
    await until("relaunch", () => r.launcher.launches() === 2);
    await r.clock.advance(30_000);
    expect(r.launcher.launches()).toBe(2);
    expect(r.launcher.targets).toEqual([LOCAL, target]);
  });

  test("retarget stops the running engine and launches the new target (the limit is not spent)", async () => {
    // 한도 1: 바꾸기가 횟수를 먹었다면 아래 충돌이 자동 재기동 없이 failed가 된다
    const r = rig(EOF_EXIT, 1);
    r.supervisor.start();
    await runningUntil(r, 1);
    const target = remote("tcp://build.local:1234");
    expect(r.supervisor.retarget(target)).toEqual(ok(undefined));
    await runningUntil(r, 2);
    expect(r.launcher.targets).toEqual([LOCAL, target]);
    expect(r.sink.kinds()).toEqual(["starting", "running", "restarting", "starting", "running"]);
    // 이전 엔진은 host.shutdown과 stdin 닫기로 끝났고 그룹은 한 번 정리했다
    const old = r.launcher.engine(0);
    expect(old.written()).toContain('"method":"host.shutdown"');
    expect(old.stdinClosed()).toBe(true);
    expect(r.launcher.killed).toEqual([1001]);
    expect(r.relay.state()).toMatchObject({ kind: "running", pid: 1002 });

    // 새 엔진이 죽으면 한도 1 안에서 한 번 자동 재기동한다
    r.launcher.engine(1).crash(1);
    await until("third launch", () => r.launcher.launches() === 3);
    await runningUntil(r, 3);
    expect(r.launcher.targets).toEqual([LOCAL, target, target]);
    expect(r.sink.kinds()).toEqual([
      "starting",
      "running",
      "restarting",
      "starting",
      "running",
      "restarting",
      "starting",
      "running",
    ]);
  });

  test("a retarget during launch replaces the engine that was just started", async () => {
    const r = rig();
    const target = remote("tcp://host:1234");
    r.launcher.beforeLaunch = () => {
      r.supervisor.retarget(target);
    };
    r.supervisor.start();
    await until("second running", () => r.launcher.launches() === 2 && r.sink.runningCount() === 2);
    expect(r.launcher.targets).toEqual([LOCAL, target]);
    expect(r.sink.kinds()).toEqual(["starting", "running", "restarting", "starting", "running"]);
    expect(r.launcher.killed).toEqual([1001]);
    expect(r.relay.state()).toMatchObject({ kind: "running", pid: 1002 });
  });

  test("retarget from failed relaunches with the new target even with the limit at zero", async () => {
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).crash(1);
    await until("failed", () => lastKind(r) === "failed");
    expect(r.launcher.launches()).toBe(1);
    const target = remote("tcp://host:1234");
    expect(r.supervisor.retarget(target)).toEqual(ok(undefined));
    await until("relaunch", () => r.launcher.launches() === 2);
    await until("running again", () => lastKind(r) === "running");
    expect(r.launcher.targets).toEqual([LOCAL, target]);
    expect(r.sink.kinds()).toEqual(["starting", "running", "failed", "starting", "running"]);
  });

  test("retarget during a backoff wait relaunches at once", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).crash(1);
    await runningUntil(r, 2);
    // 2번째 재기동은 1초 백오프
    r.launcher.engine(1).crash(1);
    await until("restarting", () => lastKind(r) === "restarting");
    const target = remote("tcp://host:1234");
    const askedAt = r.clock.now();
    expect(r.supervisor.retarget(target)).toEqual(ok(undefined));
    await until("third launch", () => r.launcher.launches() === 3);
    // 1초를 기다리지 않고 바로 띄웠다
    expect(r.clock.now()).toBe(askedAt);
    expect(r.launcher.targets).toEqual([LOCAL, LOCAL, target]);
  });

  test("retarget is refused once the shutdown has started, and a bad address is refused first", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    await r.supervisor.shutdown();
    expect(r.supervisor.retarget(remote("tcp://host:1234"))).toEqual(err("engine-stopping"));
    // 검사는 상태 검사보다 먼저다. 잘못된 주소는 종료 중이어도 bad-request다
    expect(r.supervisor.retarget(remote(""))).toEqual(err("bad-request"));
    expect(r.launcher.targets).toEqual([LOCAL]);
  });

  test("a bad remote address is refused and the engine keeps running", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.retarget(remote("tcp://host 1234"))).toEqual(err("bad-request"));
    await r.clock.advance(30_000);
    expect(r.launcher.launches()).toBe(1);
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
  });

  test("leaving a remote engine only closes its stdin, and the local one gets host.shutdown", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    const remoteTarget = remote("tcp://host:1234");
    expect(r.supervisor.retarget(remoteTarget)).toEqual(ok(undefined));
    await until("remote running", () => r.launcher.launches() === 2 && r.sink.runningCount() === 2);
    expect(r.supervisor.retarget(LOCAL)).toEqual(ok(undefined));
    await until("local again", () => r.launcher.launches() === 3 && r.sink.runningCount() === 3);

    const remoteEngine = r.launcher.engine(1);
    expect(remoteEngine.written()).toBe("");
    expect(remoteEngine.stdinClosed()).toBe(true);
    expect(r.launcher.engine(0).written()).toContain('"method":"host.shutdown"');
    expect(r.launcher.killed).toEqual([1001, 1002]);
    expect(r.launcher.targets).toEqual([LOCAL, remoteTarget, LOCAL]);
  });

  test("quitting with a remote engine only closes its stdin", async () => {
    const r = rig();
    const remoteTarget = remote("tcp://host:1234");
    expect(r.supervisor.retarget(remoteTarget)).toEqual(ok(undefined));
    r.supervisor.start();
    await runningUntil(r, 1);
    const engine = r.launcher.engine(0);
    expect(r.supervisor.onExitRequested()).toBe("preventAndShutdown");
    await r.supervisor.shutdown();
    expect(engine.written()).toBe("");
    expect(engine.stdinClosed()).toBe(true);
    expect(lastKind(r)).toBe("stopped");
    expect(r.launcher.targets).toEqual([remoteTarget]);
  });
});

describe("restart and safe mode (W-35)", () => {
  test("a running engine is not restarted without confirmation, and safe mode is not set", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.restartManually(null, false)).toEqual(err("not-confirmed"));
    expect(r.supervisor.restartManually(true, false)).toEqual(err("not-confirmed"));
    await r.clock.advance(30_000);
    expect(r.launcher.launches()).toBe(1);
    expect(r.launcher.killed).toEqual([]);
    expect(r.supervisor.snapshot().safeMode).toBe("default");
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
  });

  test("a confirmed restart relaunches in safe mode without using a restart", async () => {
    // 한도 1: 재기동이 횟수를 먹었다면 아래 충돌은 자동 재기동 없이 failed가 된다
    const r = rig(EOF_EXIT, 1);
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.restartManually(true, true)).toEqual(ok(undefined));
    await runningUntil(r, 2);
    expect(r.launcher.targets).toEqual([LOCAL, LOCAL]);
    expect(r.launcher.safeModes).toEqual(["default", "on"]);
    expect(r.launcher.killed).toEqual([1001]);
    expect(r.launcher.engine(0).written()).toContain('"method":"host.shutdown"');
    expect(r.sink.kinds()).toEqual(["starting", "running", "restarting", "starting", "running"]);
    // 새 엔진이 죽으면 한도 1을 그대로 쓴 자동 재기동이 한 번 뜬다. 안전 모드는 그대로 남는다
    r.launcher.engine(1).crash(1);
    await until("third launch", () => r.launcher.launches() === 3);
    await runningUntil(r, 3);
    expect(r.launcher.safeModes).toEqual(["default", "on", "on"]);
    expect(r.relay.state()).toMatchObject({ kind: "running", pid: 1003 });
  });

  test("safe mode lasts until it is turned off", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.restartManually(true, true)).toEqual(ok(undefined));
    await runningUntil(r, 2);
    expect(r.supervisor.restartManually(null, true)).toEqual(ok(undefined));
    await runningUntil(r, 3);
    expect(r.supervisor.restartManually(false, true)).toEqual(ok(undefined));
    await runningUntil(r, 4);
    expect(r.launcher.safeModes).toEqual(["default", "on", "on", "off"]);
  });

  test("turning safe mode off is kept as off and survives an automatic restart", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.restartManually(false, true)).toEqual(ok(undefined));
    await runningUntil(r, 2);
    r.launcher.engine(1).crash(1);
    await runningUntil(r, 3);
    expect(r.launcher.safeModes).toEqual(["default", "off", "off"]);
  });

  test("turning safe mode off is accepted for a remote target, and the flag is not passed", async () => {
    const r = rig();
    expect(r.supervisor.retarget(remote("tcp://host:1234"))).toEqual(ok(undefined));
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.restartManually(false, true)).toEqual(ok(undefined));
    await runningUntil(r, 2);
    expect(r.launcher.safeModes).toEqual(["default", "off"]);
    expect(r.launcher.targets).toEqual([remote("tcp://host:1234"), remote("tcp://host:1234")]);
  });

  test("safe mode is refused for a remote target, whether confirmed or not", async () => {
    const r = rig();
    expect(r.supervisor.retarget(remote("tcp://host:1234"))).toEqual(ok(undefined));
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.restartManually(true, true)).toEqual(err("bad-request"));
    expect(r.supervisor.restartManually(true, false)).toEqual(err("bad-request"));
    await r.clock.advance(30_000);
    expect(r.launcher.launches()).toBe(1);
    expect(r.supervisor.snapshot().safeMode).toBe("default");
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
  });

  test("a failed engine restarts without confirmation and takes safe mode", async () => {
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.engine(0).crash(1);
    await until("failed", () => lastKind(r) === "failed");
    expect(r.supervisor.restartManually(true, false)).toEqual(ok(undefined));
    await until("relaunch", () => r.launcher.launches() === 2);
    await runningUntil(r, 2);
    expect(r.launcher.safeModes).toEqual(["default", "on"]);
    expect(r.sink.kinds()).toEqual(["starting", "running", "failed", "starting", "running"]);
  });

  test("a restart with no engine to restart is not running, and stores nothing", async () => {
    const r = rig();
    expect(r.supervisor.restartManually(true, true)).toEqual(err("engine-not-running"));
    expect(r.supervisor.restartManually(null, false)).toEqual(err("engine-not-running"));
    expect(r.supervisor.snapshot().safeMode).toBe("default");
    expect(r.launcher.calls).toEqual([]);
  });

  test("a restart is refused once the shutdown has started", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    await r.supervisor.shutdown();
    expect(r.supervisor.restartManually(null, true)).toEqual(err("engine-stopping"));
  });
});

describe("database restore (db_restore)", () => {
  test("an exit request during the restore waits for it to end", async () => {
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await until("running", () => r.sink.kinds().includes("running"));
    r.launcher.closeOnceGate();
    const restore = r.supervisor.restoreDatabase("/backups/a");
    await until("cli ran", () => r.launcher.calls.includes(RUN_ONCE_BACKUP_A));
    expect(r.supervisor.onExitRequested()).toBe("preventUntilRestore");
    expect(r.supervisor.onExitRequested()).toBe("prevent");
    const waiter = r.supervisor.waitRestoreEnd();
    const early = await Promise.race([waiter.then(() => "done"), flush().then(() => "pending")]);
    expect(early).toBe("pending");
    r.launcher.openOnceGate();
    expect(await restore).toEqual(ok(EMPTY_OUTPUT));
    await waiter;
    expect(r.supervisor.snapshot().exitWaitsForRestore).toBe(false);
  });

  test("the hold keeps the engine down during the restore, and that exit is not a crash", async () => {
    const r = rig(EOF_EXIT, 0);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.closeOnceGate();
    const restore = r.supervisor.restoreDatabase("/backups/a");
    await until("cli ran", () => r.launcher.calls.includes(RUN_ONCE_BACKUP_A));
    // CLI가 도는 동안 엔진은 내려가 있고 다시 뜨지 않는다
    await r.clock.advance(300);
    expect(r.launcher.launches()).toBe(1);
    expect(r.relay.state()).toEqual({ kind: "stopped" });
    r.launcher.openOnceGate();
    expect(await restore).toEqual(ok(EMPTY_OUTPUT));
    await until("relaunch", () => r.launcher.launches() === 2);
    await until("running again", () => lastKind(r) === "running");
    expect(r.sink.kinds()).toEqual([
      "starting",
      "running",
      "stopping",
      "stopped",
      "starting",
      "running",
    ]);
  });

  test("the live engine is stopped before the CLI runs, and started again after", async () => {
    const r = rig(EOF_EXIT, 3);
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(ok(EMPTY_OUTPUT));
    await until("relaunch", () => r.launcher.launches() === 2);
    expect(r.launcher.calls).toEqual([
      "launch:1001",
      RUN_ONCE_CHECK_A,
      "shutdown:1001",
      "stdin-closed:1001",
      "kill:1001",
      RUN_ONCE_BACKUP_A,
      "launch:1002",
    ]);
  });

  test("a command that cannot run clears the hold, and the engine starts again", async () => {
    const r = rig(EOF_EXIT, 3);
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.scriptedOnce = err({ message: "spawn failed" });
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(err("storage-failed"));
    expect(r.supervisor.snapshot().hold).toBe(false);
    await until("relaunch", () => r.launcher.launches() === 2);
    await until("running again", () => lastKind(r) === "running");
  });

  test("the exit code and the output come back unchanged, and exit 3 is not a command error", async () => {
    const r = rig(EOF_EXIT, 3);
    r.supervisor.start();
    await runningUntil(r, 1);
    const stdout = '{"ok":false,"error":"engine_running"}\n';
    const stderr = "refused\n";
    r.launcher.scriptedOnce = ok({ exitCode: 3, stdout, stderr });
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(
      ok({ exitCode: 3, stdout, stderr }),
    );
    expect(r.launcher.calls).toContain(RUN_ONCE_BACKUP_A);
    await until("relaunch", () => r.launcher.launches() === 2);
  });

  test("a backup the check refuses is answered as is, and the live engine is never stopped", async () => {
    const r = rig(EOF_EXIT, 3);
    r.supervisor.start();
    await runningUntil(r, 1);
    const stderr = "fresnel: 백업의 manifest.json이 깨져 있다\n";
    r.launcher.scriptedCheck = ok({ exitCode: 3, stdout: "", stderr });
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(
      ok({ exitCode: 3, stdout: "", stderr }),
    );
    await r.clock.advance(300);
    expect(r.launcher.calls).toEqual(["launch:1001", RUN_ONCE_CHECK_A]);
    expect(r.launcher.launches()).toBe(1);
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
    expect(r.supervisor.snapshot().hold).toBe(false);
  });

  test("a remote target is refused without stopping the engine", async () => {
    const r = rig();
    expect(r.supervisor.retarget(remote("tcp://host:1234"))).toEqual(ok(undefined));
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(err("remote-target"));
    await r.clock.advance(300);
    expect(r.launcher.calls).toEqual(["launch:1001"]);
    expect(r.supervisor.snapshot().hold).toBe(false);
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
  });

  test("a service-attached local engine holds the store, so the restore is refused", async () => {
    const r = rig();
    r.launcher.viaService = true;
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(err("remote-target"));
    await r.clock.advance(300);
    expect(r.launcher.calls).toEqual(["launch:1001"]);
    expect(r.supervisor.snapshot().hold).toBe(false);
    expect(r.sink.kinds()).toEqual(["starting", "running"]);
  });

  test("a second restore while one runs is busy", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    r.launcher.closeOnceGate();
    const first = r.supervisor.restoreDatabase("/backups/a");
    await until("cli ran", () => r.launcher.calls.includes(RUN_ONCE_BACKUP_A));
    expect(await r.supervisor.restoreDatabase("/backups/b")).toEqual(err("busy"));
    r.launcher.openOnceGate();
    expect(await first).toEqual(ok(EMPTY_OUTPUT));
  });

  test("a restore after the shutdown started is refused", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    await r.supervisor.shutdown();
    expect(await r.supervisor.restoreDatabase("/backups/a")).toEqual(err("engine-stopping"));
    expect(r.launcher.calls.some((call) => call.startsWith("run-once"))).toBe(false);
  });

  test("a restore gives up when the engine never exits, and the hold is released", async () => {
    const r = rig({ exitOnEof: false, blockWrites: false, dieOnKill: false });
    r.supervisor.start();
    await runningUntil(r, 1);
    const restore = r.supervisor.restoreDatabase("/backups/a");
    // 종료 시한 7초, 그룹 종료 뒤 2초, 복원 시한은 종료 시한 + 5초
    await r.clock.advance(13_000);
    expect(await restore).toEqual(err("engine-stopping"));
    expect(r.supervisor.snapshot().hold).toBe(false);
    expect(r.launcher.calls).not.toContain(RUN_ONCE_BACKUP_A);
  });
});

describe("the engine source follows the child and the target (service mode)", () => {
  test("a service-attached local engine runs with source service and is never sent host.shutdown", async () => {
    const r = rig();
    r.launcher.viaService = true;
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.sink.states).toEqual([
      { kind: "starting", source: "sidecar", attempt: 0 },
      { kind: "running", source: "service", pid: 1001 },
    ]);
    expect(r.supervisor.onExitRequested()).toBe("preventAndShutdown");
    await r.supervisor.shutdown();
    const engine = r.launcher.engine(0);
    expect(engine.written()).toBe("");
    expect(engine.stdinClosed()).toBe(true);
    expect(r.launcher.calls).not.toContain("shutdown:1001");
    expect(lastKind(r)).toBe("stopped");
  });

  test("a hand-typed local socket target is a service source from the start", async () => {
    const r = rig();
    expect(r.supervisor.retarget(remote("unix:/tmp/x/fresnel.sock"))).toEqual(ok(undefined));
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.sink.states).toEqual([
      { kind: "starting", source: "service", attempt: 0 },
      { kind: "running", source: "service", pid: 1001 },
    ]);
  });

  test("a tcp remote target stays a sidecar source", async () => {
    const r = rig();
    expect(r.supervisor.retarget(remote("tcp://host:1234"))).toEqual(ok(undefined));
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.sink.states).toEqual([
      { kind: "starting", source: "sidecar", attempt: 0 },
      { kind: "running", source: "sidecar", pid: 1001 },
    ]);
  });
});

describe("the supervisor's log lines never carry the remote address (E11)", () => {
  test("a retarget to a remote address logs the change without the address", async () => {
    const r = rig();
    r.supervisor.start();
    await runningUntil(r, 1);
    expect(r.supervisor.retarget(remote("tcp://secret-host.example:1234"))).toEqual(ok(undefined));
    await runningUntil(r, 2);
    expect(r.log.lines).toContain("retarget: the engine target changed");
    expect(r.log.lines.join("\n")).not.toContain("secret-host.example");
  });
});
