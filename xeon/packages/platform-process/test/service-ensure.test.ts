import { describe, expect, test } from "bun:test";
import { err, ok, repeatAsync, type Result } from "@xeon/contracts";
import {
  ensureService,
  newServiceToken,
  stopProcess,
  spawnDetachedService,
  isProcessAlive,
  type EnsureDeps,
  type ProbeError,
  type RegistrationStore,
  type ServiceProbe,
  type ServiceRegistration,
  type SocketError,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";

const TOKEN = newServiceToken((bytes) => new Uint8Array(bytes).fill(3));

function registration(version: string, pid: number): ServiceRegistration {
  return {
    schemaVersion: 1,
    version,
    protocolVersion: "1.0.0",
    socket: "/run/xeon/xeon.sock",
    pid,
    startedAt: 1,
    token: TOKEN,
    storeId: "s",
  };
}

interface World {
  /** 등록 파일 내용. null이면 없다 */
  reg: ServiceRegistration | null;
  /** 서비스가 실제로 듣고 있는가 */
  listening: boolean;
  probe: ServiceProbe;
  spawns: number;
  replaced: number;
  insecure: number | null;
}

function build(world: World, options: { readonly spawnDelayMs?: number } = {}) {
  const clock = manualClock();
  let spawnedAt: number | null = null;
  const store: RegistrationStore = {
    path: "/run/xeon/service.json",
    read() {
      if (world.insecure !== null) return err({ kind: "insecure_mode", mode: world.insecure });
      // 띄운 서비스는 지연 뒤에 등록 파일을 쓰고 듣기 시작한다
      if (spawnedAt !== null && clock.now() - spawnedAt >= (options.spawnDelayMs ?? 0)) {
        world.reg = registration("1.0.0", 777);
        world.listening = true;
      }
      return world.reg === null ? err({ kind: "absent" }) : ok(world.reg);
    },
    write: () => ok(undefined),
    removeIfOwned: () => ok(false),
  };
  const deps: EnsureDeps = {
    registration: store,
    probe(): Promise<Result<ServiceProbe, ProbeError | SocketError>> {
      return Promise.resolve(
        world.listening ? ok(world.probe) : err({ kind: "refused", path: "/run/xeon/xeon.sock" }),
      );
    },
    replace() {
      world.replaced += 1;
      world.reg = null;
      world.listening = false;
      return Promise.resolve(ok(undefined));
    },
    spawnService() {
      world.spawns += 1;
      spawnedAt = clock.now();
      return ok({ pid: 777 });
    },
    clock,
    scheduler: clock,
    engineVersion: "1.0.0",
    protocolVersion: "1.0.0",
  };
  return { clock, deps };
}

function freshWorld(): World {
  return {
    reg: null,
    listening: false,
    probe: { version: "1.0.0", protocolVersion: "1.0.0", idle: true },
    spawns: 0,
    replaced: 0,
    insecure: null,
  };
}

/** 시계가 앞서 가도록 ensure가 기다리는 동안 시간을 민다 */
async function run(
  clock: ReturnType<typeof manualClock>,
  promise: Promise<unknown>,
  stepMs: number,
  steps: number,
): Promise<void> {
  let done = 0;
  await repeatAsync<void>(async () => {
    await clock.advance(stepMs);
    done += 1;
    return done >= steps ? { value: undefined } : undefined;
  });
  await promise;
}

describe("ensureService", () => {
  test("no service: spawns once and connects with started true", async () => {
    const world = freshWorld();
    const { clock, deps } = build(world, { spawnDelayMs: 400 });
    const pending = ensureService(deps, { startTimeoutMs: 10_000, retryMs: 200 });
    await run(clock, pending, 200, 5);
    const result = await pending;
    expect(world.spawns).toBe(1);
    expect(result).toEqual({
      ok: true,
      value: { kind: "connected", registration: registration("1.0.0", 777), started: true },
    });
  });

  test("a second ensure attaches to the running service instead of starting another", async () => {
    const world = freshWorld();
    const { clock, deps } = build(world);
    const first = ensureService(deps, { retryMs: 200 });
    await run(clock, first, 200, 2);
    const second = await ensureService(deps, { retryMs: 200 });
    expect(world.spawns).toBe(1);
    expect(second).toEqual({
      ok: true,
      value: { kind: "connected", registration: registration("1.0.0", 777), started: false },
    });
  });

  test("a registration whose service is gone is treated as stale and a new service is spawned", async () => {
    const world = freshWorld();
    world.reg = registration("1.0.0", 5);
    world.listening = false;
    const { clock, deps } = build(world);
    const pending = ensureService(deps, { retryMs: 200 });
    await run(clock, pending, 200, 2);
    const result = await pending;
    expect(world.spawns).toBe(1);
    expect(result.ok && result.value.kind).toBe("connected");
  });

  test("start_timeout when the service never answers", async () => {
    const world = freshWorld();
    const { clock, deps } = build(world, { spawnDelayMs: 1_000_000 });
    const pending = ensureService(deps, { startTimeoutMs: 1000, retryMs: 200 });
    await run(clock, pending, 200, 8);
    const result = await pending;
    expect(!result.ok && result.error.kind).toBe("start_timeout");
  });

  test("an idle service of another version is replaced and a new one started", async () => {
    const world = freshWorld();
    world.reg = registration("0.9.0", 5);
    world.listening = true;
    world.probe = { version: "0.9.0", protocolVersion: "1.0.0", idle: true };
    const { clock, deps } = build(world);
    const pending = ensureService(deps, { retryMs: 200 });
    // 교체 뒤에 띄운 새 서비스는 probe가 현재 버전을 답한다
    await clock.advance(0);
    world.probe = { version: "1.0.0", protocolVersion: "1.0.0", idle: true };
    await run(clock, pending, 200, 3);
    const result = await pending;
    expect(world.replaced).toBe(1);
    expect(world.spawns).toBe(1);
    expect(result.ok && result.value.kind).toBe("connected");
  });

  test("a busy service of another version is joined as version_mismatch_busy and keeps running", async () => {
    const world = freshWorld();
    world.reg = registration("0.9.0", 5);
    world.listening = true;
    world.probe = { version: "0.9.0", protocolVersion: "1.0.0", idle: false };
    const { deps } = build(world);
    const result = await ensureService(deps);
    expect(world.replaced).toBe(0);
    expect(world.spawns).toBe(0);
    expect(result).toEqual({
      ok: true,
      value: { kind: "version_mismatch_busy", registration: registration("0.9.0", 5) },
    });
  });

  test("an idle service on another protocol major that cannot be replaced is replace_failed", async () => {
    const world = freshWorld();
    world.reg = registration("2.0.0", 5);
    world.listening = true;
    world.probe = { version: "2.0.0", protocolVersion: "2.0.0", idle: true };
    const { deps } = build(world);
    const result = await ensureService({
      ...deps,
      replace: () => Promise.resolve(err({ kind: "replace_failed" })),
    });
    expect(result).toEqual({ ok: false, error: { kind: "replace_failed" } });
  });

  test("a busy service on another protocol major is protocol_unsupported", async () => {
    const world = freshWorld();
    world.reg = registration("2.0.0", 5);
    world.listening = true;
    world.probe = { version: "2.0.0", protocolVersion: "2.0.0", idle: false };
    const { deps } = build(world);
    expect(await ensureService(deps)).toEqual({
      ok: false,
      error: { kind: "protocol_unsupported", serviceVersion: "2.0.0" },
    });
  });

  test("a registration file wider than 0600 is not trusted", async () => {
    const world = freshWorld();
    world.insecure = 0o644;
    const { deps } = build(world);
    expect(await ensureService(deps)).toEqual({
      ok: false,
      error: { kind: "insecure_registration", mode: 0o644 },
    });
    expect(world.spawns).toBe(0);
  });
});

describe("supervision helpers", () => {
  test("stopProcess sends SIGTERM, then SIGKILL when the process stays", async () => {
    const clock = manualClock();
    const signals: string[] = [];
    let alive = true;
    const pending = stopProcess(
      {
        kill: (_pid, signal) => {
          signals.push(signal);
          if (signal === "SIGKILL") alive = false;
        },
        alive: () => alive,
        clock,
        scheduler: clock,
        pollMs: 50,
      },
      9,
      { termWaitMs: 200, killWaitMs: 200 },
    );
    await clock.advance(500);
    expect(await pending).toBe("killed");
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("stopProcess reports already_gone without signalling", async () => {
    const clock = manualClock();
    const signals: string[] = [];
    const outcome = await stopProcess(
      { kill: (_pid, signal) => signals.push(signal), alive: () => false, clock, scheduler: clock },
      9,
      { termWaitMs: 100, killWaitMs: 100 },
    );
    expect(outcome).toBe("already_gone");
    expect(signals).toEqual([]);
  });

  test("spawnDetachedService returns spawn_failed for a missing program and a live pid otherwise", () => {
    const missing = spawnDetachedService({ command: "/nonexistent/xeon-none", args: [], cwd: "/" });
    expect(missing).toEqual({ ok: false, error: { kind: "spawn_failed", code: "ENOENT" } });
    const started = spawnDetachedService({ command: "sleep", args: ["30"], cwd: "/" });
    if (!started.ok) throw new Error("spawn failed");
    expect(isProcessAlive(started.value.pid)).toBe(true);
    process.kill(started.value.pid, "SIGKILL");
  });
});
