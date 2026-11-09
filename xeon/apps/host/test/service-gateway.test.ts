import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { err, ok, type LogFields, type Logger, type Result } from "@fresnel/contracts";
import type { PipedExit, PipedSpawnInput, TreeSignal } from "@fresnel/platform-process";
import {
  bunGatewayLauncher,
  type GatewayChild,
  type GatewayExit,
  type GatewayLaunchError,
  type GatewayLaunchSpec,
  type GatewayLauncher,
  type PipedSpawnFn,
} from "../src/service/gateway-launch.ts";
import {
  createGatewaySupervisor,
  type GatewayConfig,
  type GatewaySupervisor,
  type RemoteStatusView,
} from "../src/service/gateway.ts";
import { settleUntil } from "./fixtures/clock.ts";
import { createManualScheduler, type ManualScheduler } from "./fixtures/manual-scheduler.ts";

// 게이트웨이 감독자(service/gateway.ts)와 기본 런처의 줄 처리를 가짜 자식과 수동 시계로 시험한다. 실제 프로세스를 띄우지 않는다.

const SOCKET = "/run/fresnel/service.sock";
const STATE = "/state/fresnel";
const PLAIN: GatewayConfig = {
  listen: "127.0.0.1:8480",
  listenTls: null,
  hosts: [],
  tlsCert: null,
  tlsKey: null,
};

/** 자식을 띄우지 못한 것처럼 답하는 기동 함수(errno 코드 ENOENT) */
const failingSpawn: PipedSpawnFn = () =>
  Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT", message: "cannot start" }));

interface ReadyPorts {
  readonly loopbackPort: number | null;
  readonly tlsPort: number | null;
  readonly fingerprint: string | null;
}

function ready(ports: ReadyPorts): string {
  return JSON.stringify({ event: "ready", ...ports, pid: 4242 });
}

interface LineQueue {
  readonly lines: AsyncIterable<string>;
  push(line: string): void;
  end(): void;
}

function lineQueue(): LineQueue {
  const items: string[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    const awake = wake;
    wake = null;
    if (awake !== null) awake();
  };
  function take(): Promise<IteratorResult<string>> {
    const head = items.shift();
    if (head !== undefined) {
      const found: IteratorResult<string> = { done: false, value: head };
      return Promise.resolve(found);
    }
    if (closed) {
      const finished: IteratorResult<string> = { done: true, value: undefined };
      return Promise.resolve(finished);
    }
    return new Promise((resolve) => {
      wake = () => {
        resolve(take());
      };
    });
  }
  return {
    lines: {
      [Symbol.asyncIterator]: () => ({ next: take }),
    },
    push(line) {
      items.push(line);
      notify();
    },
    end() {
      closed = true;
      notify();
    },
  };
}

interface FakeChild extends GatewayChild {
  readonly writes: string[];
  readonly signals: string[];
  printOut(line: string): void;
  printErr(line: string): void;
  exit(code: number | null, signal?: string | null): void;
}

function fakeChild(pid: number): FakeChild {
  const out = lineQueue();
  const errors = lineQueue();
  const writes: string[] = [];
  const signals: string[] = [];
  const exit = Promise.withResolvers<GatewayExit>();
  let finished = false;
  const finish = (value: GatewayExit): void => {
    if (finished) return;
    finished = true;
    out.end();
    errors.end();
    exit.resolve(value);
  };
  return {
    pid,
    writes,
    signals,
    write(line) {
      writes.push(line);
    },
    stdout: out.lines,
    stderr: errors.lines,
    exited: exit.promise,
    kill(signal) {
      signals.push(signal);
      if (signal === "SIGKILL") finish({ code: null, signal: "SIGKILL" });
    },
    printOut(line) {
      out.push(line);
    },
    printErr(line) {
      errors.push(line);
    },
    exit(code, signal = null) {
      finish({ code, signal });
    },
  };
}

function recordingLog(sink: string[]): Logger {
  const write =
    (level: string) =>
    (event: string, fields?: LogFields): void => {
      sink.push(JSON.stringify({ level, event, fields: fields ?? {} }));
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: () => recordingLog(sink),
  };
}

interface Rig {
  readonly supervisor: GatewaySupervisor;
  readonly children: FakeChild[];
  readonly specs: GatewayLaunchSpec[];
  readonly logs: string[];
  readonly scheduler: ManualScheduler;
  /** 시계와 스케줄러를 함께 흘린다 */
  advance(ms: number): void;
}

interface RigOptions {
  readonly maxRestarts?: number;
  readonly restartWindowMs?: number;
  readonly launchError?: GatewayLaunchError;
}

function rig(options: RigOptions = {}): Rig {
  const scheduler = createManualScheduler();
  const world = { now: 1_000 };
  const children: FakeChild[] = [];
  const specs: GatewayLaunchSpec[] = [];
  const logs: string[] = [];
  const launch: GatewayLauncher = (spec) => {
    specs.push(spec);
    if (options.launchError !== undefined) return Promise.resolve(err(options.launchError));
    const child = fakeChild(1000 + children.length);
    children.push(child);
    const launched: Result<GatewayChild, GatewayLaunchError> = ok(child);
    return Promise.resolve(launched);
  };
  const supervisor = createGatewaySupervisor({
    socketPath: SOCKET,
    stateDir: STATE,
    launch,
    clock: { now: () => world.now },
    scheduler,
    log: recordingLog(logs),
    readyTimeoutMs: 15_000,
    requestTimeoutMs: 5_000,
    stopGraceMs: 3_000,
    maxRestarts: options.maxRestarts ?? 3,
    restartWindowMs: options.restartWindowMs ?? 60_000,
    backoffMs: [500, 2_000, 5_000],
  });
  return {
    supervisor,
    children,
    specs,
    logs,
    scheduler,
    advance(ms) {
      world.now += ms;
      scheduler.advance(ms);
    },
  };
}

/** 시작하고 첫 자식이 ready를 낼 때까지 간다 */
async function bringUp(
  r: Rig,
  config: GatewayConfig,
  ports: ReadyPorts = { loopbackPort: 8480, tlsPort: null, fingerprint: null },
): Promise<RemoteStatusView> {
  const started = r.supervisor.start(config);
  await settleUntil(() => r.children.length >= 1);
  const child = r.children[r.children.length - 1];
  child?.printOut(ready(ports));
  return started;
}

/** 지금 자식을 죽이고 감독이 그것을 알아챌 때까지 간다 */
async function dieNow(r: Rig): Promise<void> {
  r.children[r.children.length - 1]?.exit(1);
  await settleUntil(() => r.supervisor.status().state !== "running");
}

/** 백오프만큼 시간을 흘리고 새 자식이 ready를 내 running이 될 때까지 간다. `count`는 자식 수다 */
async function restartAfter(r: Rig, delayMs: number, count: number): Promise<void> {
  r.advance(delayMs);
  await settleUntil(() => r.children.length === count);
  r.children[count - 1]?.printOut(ready({ loopbackPort: 8480, tlsPort: null, fingerprint: null }));
  await settleUntil(() => r.supervisor.status().state === "running");
}

describe("gateway supervisor: start and status", () => {
  test("ready makes the gateway running with its ports, fingerprint and the passed arguments", async () => {
    const r = rig();
    const status = await bringUp(r, PLAIN, {
      loopbackPort: 8480,
      tlsPort: null,
      fingerprint: null,
    });
    expect(status).toEqual({
      enabled: true,
      state: "running",
      loopbackPort: 8480,
      tlsPort: null,
      hosts: [],
      fingerprint: null,
      certSource: null,
      pushAvailable: true,
      error: null,
    });
    expect(r.specs[0]?.args).toEqual([
      "--socket",
      SOCKET,
      "--state-dir",
      STATE,
      "--listen",
      "127.0.0.1:8480",
    ]);
  });

  test("an external TLS listener on a wildcard reports its host, self-signed certificate and fingerprint", async () => {
    const r = rig();
    const status = await bringUp(
      r,
      { ...PLAIN, listenTls: "0.0.0.0:8443", hosts: ["home.example"] },
      { loopbackPort: 8480, tlsPort: 8443, fingerprint: "ab12cd34" },
    );
    expect(status).toMatchObject({
      state: "running",
      tlsPort: 8443,
      hosts: ["home.example"],
      fingerprint: "ab12cd34",
      certSource: "self-signed",
    });
    expect(r.specs[0]?.args).toEqual([
      "--socket",
      SOCKET,
      "--state-dir",
      STATE,
      "--listen",
      "127.0.0.1:8480",
      "--listen-tls",
      "0.0.0.0:8443",
      "--hosts",
      "home.example",
    ]);
  });

  test("a user certificate with a named TLS host lists that host first and reports the user source", async () => {
    const r = rig();
    const status = await bringUp(
      r,
      {
        ...PLAIN,
        listenTls: "[::1]:8443",
        hosts: ["home.example", "[::1]"],
        tlsCert: "/certs/fullchain.pem",
        tlsKey: "/certs/key.pem",
      },
      { loopbackPort: 8480, tlsPort: 8443, fingerprint: "ff00" },
    );
    expect(status).toMatchObject({
      hosts: ["::1", "home.example"],
      certSource: "user",
    });
    expect(r.specs[0]?.args).toContain("--tls-cert");
    expect(r.specs[0]?.args).toContain("/certs/key.pem");
  });

  test("a certificate without an external listener is not passed and reports no certificate source", async () => {
    const r = rig();
    const status = await bringUp(r, { ...PLAIN, tlsCert: "/certs/a.pem", tlsKey: "/certs/a.key" });
    expect(status).toMatchObject({ tlsPort: null, hosts: [], certSource: null });
    expect(r.specs[0]?.args).not.toContain("--tls-cert");
  });

  test("starting again while running returns the same state and does not spawn a second child", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const again = await r.supervisor.start({ ...PLAIN, listen: "127.0.0.1:9999" });
    expect(again.state).toBe("running");
    expect(r.children.length).toBe(1);
  });

  test("a missing gateway program fails with gateway-binary-missing and nothing is restarted", async () => {
    const r = rig({ launchError: { kind: "binary-missing", message: "not installed here" } });
    const status = await r.supervisor.start(PLAIN);
    expect(status).toMatchObject({
      state: "failed",
      error: { kind: "gateway-binary-missing", message: "not installed here" },
    });
    r.advance(60_000);
    expect(r.children.length).toBe(0);
    expect(await r.supervisor.pair()).toEqual({ ok: false, error: { kind: "remote-off" } });
  });
});

describe("gateway supervisor: startup failures and restarts", () => {
  test("exit code 2 before ready is an environment failure and the gateway is not restarted", async () => {
    const r = rig();
    const started = r.supervisor.start(PLAIN);
    await settleUntil(() => r.children.length === 1);
    const child = r.children[0];
    child?.printErr("error: --socket must be an absolute path");
    child?.printErr("usage: bun run src/web/main.ts --socket <abs path>");
    await settleUntil(() => false, 20);
    child?.exit(2);
    const status = await started;
    expect(status).toMatchObject({
      state: "failed",
      error: { kind: "gateway-environment", message: "--socket must be an absolute path" },
    });
    r.advance(60_000);
    expect(r.children.length).toBe(1);
  });

  test("a crash after ready is restarted after the first backoff and comes back running on the new ports", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    r.children[0]?.exit(1);
    await settleUntil(() => r.supervisor.status().state === "starting");
    expect(r.supervisor.status()).toMatchObject({
      state: "starting",
      loopbackPort: null,
      pushAvailable: false,
    });
    r.advance(499);
    await settleUntil(() => false, 10);
    expect(r.children.length).toBe(1);
    r.advance(1);
    await settleUntil(() => r.children.length === 2);
    r.children[1]?.printOut(ready({ loopbackPort: 9000, tlsPort: null, fingerprint: null }));
    await settleUntil(() => r.supervisor.status().state === "running");
    expect(r.supervisor.status()).toMatchObject({ state: "running", loopbackPort: 9000 });
  });

  test("more deaths than maxRestarts inside the window fail the gateway with gateway-down", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    await dieNow(r);
    await restartAfter(r, 500, 2);
    await dieNow(r);
    await restartAfter(r, 2_000, 3);
    await dieNow(r);
    await restartAfter(r, 5_000, 4);
    await dieNow(r);
    await settleUntil(() => r.supervisor.status().state === "failed");
    expect(r.supervisor.status()).toMatchObject({
      state: "failed",
      error: { kind: "gateway-down" },
    });
    r.advance(60_000);
    expect(r.children.length).toBe(4);
  });

  test("deaths spread beyond the restart window do not count toward the limit", async () => {
    const r = rig({ maxRestarts: 1, restartWindowMs: 1_000 });
    await bringUp(r, PLAIN);
    r.children[0]?.exit(1);
    await settleUntil(() => r.children.length === 1 && r.supervisor.status().state === "starting");
    r.advance(500);
    await settleUntil(() => r.children.length === 2);
    r.children[1]?.printOut(ready({ loopbackPort: 8480, tlsPort: null, fingerprint: null }));
    await settleUntil(() => r.supervisor.status().state === "running");
    r.advance(5_000);
    r.children[1]?.exit(1);
    await settleUntil(() => r.supervisor.status().state === "starting");
    expect(r.supervisor.status().state).toBe("starting");
  });
});

describe("gateway supervisor: requests", () => {
  test("pair returns the code and the code is never written to the log", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const pairing = r.supervisor.pair();
    await settleUntil(() => r.children[0]?.writes.length === 1);
    expect(r.children[0]?.writes).toEqual(['{"cmd":"pair"}']);
    r.children[0]?.printOut(
      '{"event":"pairing-code","code":"ABCDE-12345","expiresAt":1700000300000}',
    );
    expect(await pairing).toEqual({
      ok: true,
      value: { code: "ABCDE12345", expiresAt: 1_700_000_300_000 },
    });
    expect(r.logs.join("\n")).not.toContain("ABCDE-12345");
  });

  test("pair while the gateway is off or failed is remote-off", async () => {
    const r = rig();
    expect(await r.supervisor.pair()).toEqual({ ok: false, error: { kind: "remote-off" } });
    const failed = rig({ launchError: { kind: "spawn-failed", message: "no" } });
    await failed.supervisor.start(PLAIN);
    expect(await failed.supervisor.pair()).toEqual({ ok: false, error: { kind: "remote-off" } });
  });

  test("a request with no answer in time is gateway-timeout and the wedged child is killed", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const pairing = r.supervisor.pair();
    await settleUntil(() => r.children[0]?.writes.length === 1);
    r.advance(5_000);
    expect(await pairing).toEqual({ ok: false, error: { kind: "gateway-timeout" } });
    expect(r.children[0]?.signals).toEqual(["SIGKILL"]);
    await settleUntil(() => r.supervisor.status().state === "starting");
  });

  test("a reply of another event is gateway-protocol", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const listing = r.supervisor.devices();
    await settleUntil(() => r.children[0]?.writes.length === 1);
    r.children[0]?.printOut('{"event":"pairing-code","code":"ZZZZZ-00000","expiresAt":1}');
    const result = await listing;
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.kind).toBe("gateway-protocol");
  });

  test("devices map a zero lastSeenAt and an empty address to null", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const listing = r.supervisor.devices();
    await settleUntil(() => r.children[0]?.writes.length === 1);
    expect(r.children[0]?.writes).toEqual(['{"cmd":"devices"}']);
    r.children[0]?.printOut(
      JSON.stringify({
        event: "devices",
        devices: [
          {
            id: "dev_a",
            name: "Phone",
            kind: "web",
            createdAt: 10,
            lastSeenAt: 0,
            lastAddress: "",
          },
          {
            id: "dev_b",
            name: "Desk",
            kind: "desktop",
            createdAt: 20,
            lastSeenAt: 30,
            lastAddress: "100.64.0.2",
          },
        ],
      }),
    );
    expect(await listing).toEqual({
      ok: true,
      value: [
        { id: "dev_a", name: "Phone", kind: "web", createdAt: 10, lastSeenAt: null, address: null },
        {
          id: "dev_b",
          name: "Desk",
          kind: "desktop",
          createdAt: 20,
          lastSeenAt: 30,
          address: "100.64.0.2",
        },
      ],
    });
  });

  test("revoke one device returns the count", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const revoking = r.supervisor.revoke({ id: "dev_b" });
    await settleUntil(() => r.children[0]?.writes.length === 1);
    expect(r.children[0]?.writes).toEqual(['{"cmd":"revoke","id":"dev_b"}']);
    r.children[0]?.printOut('{"event":"revoked","count":1}');
    expect(await revoking).toEqual({ ok: true, value: { revoked: 1 } });
  });

  test("revoke of an unknown device is not-found", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const revoking = r.supervisor.revoke({ id: "dev_missing" });
    await settleUntil(() => r.children[0]?.writes.length === 1);
    r.children[0]?.printOut('{"event":"error","error":"not_found"}');
    expect(await revoking).toEqual({ ok: false, error: { kind: "not-found" } });
  });

  test("revoke all returns the count of the devices removed", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const revoking = r.supervisor.revoke({ all: true });
    await settleUntil(() => r.children[0]?.writes.length === 1);
    expect(r.children[0]?.writes).toEqual(['{"cmd":"revoke-all"}']);
    r.children[0]?.printOut('{"event":"revoked","count":3}');
    expect(await revoking).toEqual({ ok: true, value: { revoked: 3 } });
  });

  test("a store failure while revoking is store-failed", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const revoking = r.supervisor.revoke({ all: true });
    await settleUntil(() => r.children[0]?.writes.length === 1);
    r.children[0]?.printOut('{"event":"error","error":"store_failed"}');
    expect(await revoking).toEqual({ ok: false, error: { kind: "store-failed" } });
  });
});

describe("gateway supervisor: stop and dispose", () => {
  test("stop sends the stop line, the child exits 0, and the state becomes off without a restart", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const stopping = r.supervisor.stop();
    await settleUntil(() => r.children[0]?.writes.length === 1);
    expect(r.children[0]?.writes).toEqual(['{"cmd":"stop"}']);
    r.children[0]?.exit(0);
    expect(await stopping).toEqual({
      enabled: false,
      state: "off",
      loopbackPort: null,
      tlsPort: null,
      hosts: [],
      fingerprint: null,
      certSource: null,
      pushAvailable: false,
      error: null,
    });
    expect(r.children[0]?.signals).toEqual([]);
    r.advance(60_000);
    expect(r.children.length).toBe(1);
  });

  test("a child that ignores stop gets SIGTERM after the grace time and SIGKILL after another", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const child = r.children[0];
    const stopping = r.supervisor.stop();
    await settleUntil(() => child?.writes.length === 1);
    r.advance(2_999);
    await settleUntil(() => false, 10);
    expect(child?.signals).toEqual([]);
    r.advance(1);
    await settleUntil(() => child?.signals.length === 1);
    expect(child?.signals).toEqual(["SIGTERM"]);
    r.advance(2_999);
    await settleUntil(() => false, 10);
    expect(child?.signals).toEqual(["SIGTERM"]);
    r.advance(1);
    expect(await stopping).toMatchObject({ state: "off", enabled: false });
    expect(child?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    r.advance(60_000);
    expect(r.children.length).toBe(1);
  });

  test("dispose stops a running gateway and does not restart it afterwards", async () => {
    const r = rig();
    await bringUp(r, PLAIN);
    const disposing = r.supervisor.dispose();
    await settleUntil(() => r.children[0]?.writes.length === 1);
    r.children[0]?.exit(0);
    await disposing;
    expect(r.supervisor.status()).toMatchObject({ enabled: false, state: "off" });
    r.advance(60_000);
    expect(r.children.length).toBe(1);
  });

  test("dispose while off does nothing", async () => {
    const r = rig();
    await r.supervisor.dispose();
    expect(r.supervisor.status()).toMatchObject({ enabled: false, state: "off" });
    expect(r.children.length).toBe(0);
  });
});

describe("gateway launcher line handling", () => {
  test("the default launcher starts the resolved program with the gateway arguments and a filtered environment, and reads lines", async () => {
    const spawned: PipedSpawnInput[] = [];
    const written: string[] = [];
    const signals: TreeSignal[] = [];
    const stdin = new PassThrough();
    stdin.on("data", (chunk: unknown) => {
      written.push(String(chunk));
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const exit = Promise.withResolvers<PipedExit>();
    const spawn: PipedSpawnFn = (input) => {
      spawned.push(input);
      return Promise.resolve(
        ok({
          pid: 4321,
          stdin,
          stdout,
          stderr,
          exited: exit.promise,
          signalTree: (signal) => {
            signals.push(signal);
          },
        }),
      );
    };
    const launch = bunGatewayLauncher({
      env: {
        FRESNEL_WEB_BIN: "/opt/web/fresnel-web",
        FRESNEL_WEB_UI: "/opt/web/ui",
        FRESNEL_REMOTE_TOKEN: "must-not-leak",
        PATH: "/usr/bin:/bin",
        SECRET_THING: "nope",
      },
      execPath: "/opt/bun/bin/bun",
      serviceDir: "/repo/apps/host/src/service",
      exists: () => true,
      home: "/home/user",
      scheduler: createManualScheduler(),
      logger: recordingLog([]),
      drainMs: 100,
      spawn,
    });
    const launched = await launch({ args: ["--socket", SOCKET, "--state-dir", STATE] });
    expect(launched.ok).toBe(true);
    expect(spawned[0]?.command).toBe("/opt/web/fresnel-web");
    expect(spawned[0]?.args).toEqual([
      "--socket",
      SOCKET,
      "--state-dir",
      STATE,
      "--ui",
      "/opt/web/ui",
    ]);
    expect(spawned[0]?.env).toEqual({
      HOME: "/home/user",
      PATH: "/usr/bin:/bin",
      FRESNEL_WEB_BIN: "/opt/web/fresnel-web",
      FRESNEL_WEB_UI: "/opt/web/ui",
    });
    expect(spawned[0]?.cwd).toBe("/home/user");
    const child = launched.ok ? launched.value : null;
    child?.write('{"cmd":"pair"}');
    await settleUntil(() => written.length === 1);
    expect(written).toEqual(['{"cmd":"pair"}\n']);
    stdout.write("first line\n");
    const first = await child?.stdout[Symbol.asyncIterator]().next();
    expect(first).toEqual({ done: false, value: "first line" });
    child?.kill("SIGTERM");
    child?.kill("SIGKILL");
    expect(signals).toEqual(["graceful", "force"]);
    exit.resolve({ code: 0, signal: null });
    expect(await child?.exited).toEqual({ code: 0, signal: null });
  });

  test("a spawn that fails is a spawn-failed launch error with the errno code", async () => {
    const launch = bunGatewayLauncher({
      env: { FRESNEL_WEB_BIN: "/opt/web/fresnel-web" },
      execPath: "/opt/bun/bin/bun",
      serviceDir: "/repo/apps/host/src/service",
      exists: () => true,
      home: "/home/user",
      scheduler: createManualScheduler(),
      logger: recordingLog([]),
      drainMs: 100,
      spawn: failingSpawn,
    });
    const launched = await launch({ args: [] });
    expect(launched.ok).toBe(false);
    expect(launched.ok ? null : launched.error).toEqual({
      kind: "spawn-failed",
      message: "the web gateway could not be started (ENOENT)",
    });
  });
});
