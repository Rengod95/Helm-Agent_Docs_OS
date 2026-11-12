// 원격 연결 명령 모듈 시험(remote.ts). 가짜 ssh(exec 대역), 가짜 launcher(엔진 자식의 출력과 stdin 기록), 가짜 vault,
// 가짜 pair와 지문 재기로 돌린다. 실제 ssh, 실제 엔진, 실제 보안 저장소, 실제 홈은 쓰지 않는다(ssh_hosts만 임시 홈을 쓴다).
// 토큰 값이 반환 JSON에 없음을 값으로 본다. 결과는 값으로 비교한다.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { err, ok, type Result, type Scheduler } from "@fresnel/contracts";
import { WIRE_PROTOCOL_VERSION } from "@fresnel/contracts/wire";
import type {
  ExecFn,
  ExecResult,
  PairError,
  PairGrant,
  PairOptions,
  TlsProbe,
  WsError,
} from "@fresnel/platform-process";
import type { TokenVault, VaultError } from "@fresnel/platform-secrets/vault";
import type { EngineTarget } from "../src/main/engine/state.ts";
import type { EngineEvent, Launched, Launcher } from "../src/main/engine/launcher.ts";
import type { SafeMode } from "../src/main/engine/policy.ts";
import type { EngineClock } from "../src/main/engine/wait.ts";
import { createRemoteModule } from "../src/main/remote.ts";
import { ownField } from "../src/main/lib/narrow.ts";
import { fakeCtx, type FakeCtx } from "./support/fake-ctx.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const SOCKET = "/run/user/1000/fresnel/fresnel.sock";
const LOCAL = { cli: "0.4.0", contract: WIRE_PROTOCOL_VERSION };
const TOKEN = "TOKEN-SECRET-value_123456";
const FINGERPRINT = "a".repeat(64);
const ADDRESS = "ssh://me@box.example/run/user/1000/fresnel/fresnel.sock";

const RESOLVE_OUT = "hostname box.example\nport 22\nuser me\nproxyjump none\nproxycommand none\n";
const VERSION_OUT = `{"cli":"0.4.0","contract":"${WIRE_PROTOCOL_VERSION}","bun":"1.3.0"}\n`;
const STATUS_RUNNING = `{"running":true,"registration":{"socket":"${SOCKET}","version":"0.4.0"}}\n`;
const STATUS_STOPPED = '{"running":false,"reason":"no_registration"}\n';
const ENSURE_SPAWNED = `{"ok":true,"socket":"${SOCKET}","version":"0.4.0","action":"spawned"}\n`;

const HELLO_RESULT = JSON.stringify({
  jsonrpc: "2.0",
  id: "r1",
  result: {
    protocolVersion: WIRE_PROTOCOL_VERSION,
    server: { name: "fresnel", version: "0.4.0" },
    storeId: "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    transport: "stdio",
    features: [],
    experimental: [],
  },
});
const HELLO_AUTH = JSON.stringify({
  jsonrpc: "2.0",
  id: "r1",
  error: {
    code: 1004,
    message: "auth",
    data: { kind: "host.authFailed", retryable: false, details: { reason: "invalid" } },
  },
});
const HELLO_PROTOCOL = JSON.stringify({
  jsonrpc: "2.0",
  id: "r1",
  error: {
    code: 1003,
    message: "protocol",
    data: {
      kind: "protocol.unsupported",
      retryable: false,
      details: { serverVersion: "0.2.0", clientVersion: WIRE_PROTOCOL_VERSION },
    },
  },
});
const HELLO_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: "r1",
  method: "host.hello",
  params: {
    protocolVersion: WIRE_PROTOCOL_VERSION,
    client: { name: "fresnel-desktop-preflight", version: "0.4.0", kind: "desktop" },
  },
});

const INVALID_CODE: PairError = { kind: "invalid_code" };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// 가짜 시계: 시한 타이머는 다음 과제(0ms) 뒤에 불린다. 정상 흐름은 전부 마이크로 과제로 끝나므로 시한에 걸리지 않는다

function quickScheduler(): Scheduler {
  let next = 1;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    setTimeout(fn) {
      const handle = next;
      next += 1;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          fn();
        }, 0),
      );
      return handle;
    },
    clearTimeout(handle) {
      const timer = timers.get(handle);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

function clockFake(): EngineClock {
  return { now: () => 1_000, scheduler: quickScheduler() };
}

// ---------------------------------------------------------------------------------------------
// 가짜 ssh (`ExecFn`)

function done(stdout = "", code = 0, stderr = ""): ExecResult {
  return { code, signal: null, stdout, stderr, spawnError: null, timedOut: false };
}

interface SshReplies {
  readonly connect?: ExecResult;
  readonly version?: ExecResult;
  readonly status?: ExecResult;
  readonly ensure?: ExecResult;
}

function sshFake(replies: SshReplies = {}): { readonly exec: ExecFn; readonly calls: string[] } {
  const calls: string[] = [];
  const exec: ExecFn = (command, args) => {
    calls.push([command, ...args].join(" "));
    if (args.includes("-G")) return Promise.resolve(done(RESOLVE_OUT));
    // 인자는 `... -- <대상> <원격 명령…>` 꼴이다
    const remote = args.slice(args.indexOf("--") + 2).join(" ");
    const answers: Readonly<Record<string, ExecResult>> = {
      true: replies.connect ?? done(),
      "fresnel version --json": replies.version ?? done(VERSION_OUT),
      "fresnel service status --json": replies.status ?? done(STATUS_RUNNING),
      "fresnel service ensure --json": replies.ensure ?? done(ENSURE_SPAWNED),
    };
    return Promise.resolve(answers[remote] ?? done("", 127, "command not found"));
  };
  return { exec, calls };
}

// ---------------------------------------------------------------------------------------------
// 가짜 launcher: 띄운 자식의 이벤트를 미리 정한다. stdin 쓰기와 그룹 종료를 기록한다

interface Spawn {
  /** 자식이 낼 이벤트. 다 나가면 자식은 끝난 것으로 본다 */
  readonly events: readonly EngineEvent[];
  /** 참이면 이벤트가 다 나간 뒤에도 끝나지 않는다(시한 시험) */
  readonly hang?: boolean;
}

interface Launch {
  readonly target: EngineTarget;
  readonly safeMode: SafeMode;
}

function eventsOf(
  list: readonly EngineEvent[],
  hang: boolean,
): { next(): Promise<EngineEvent | null> } {
  const items = [...list];
  return {
    next: () => {
      const head = items.shift();
      if (head !== undefined) return Promise.resolve(head);
      if (hang) return new Promise<EngineEvent | null>(() => undefined);
      return Promise.resolve(null);
    },
  };
}

const stdoutLine = (text: string): EngineEvent => ({
  kind: "stdout",
  bytes: ENCODER.encode(`${text}\n`),
});
const stderrLine = (text: string): EngineEvent => ({
  kind: "stderr",
  bytes: ENCODER.encode(`${text}\n`),
});
const exitWith = (code: number): EngineEvent => ({ kind: "terminated", code, signal: null });

function fakeLauncher(spawn: Spawn | "fail"): {
  readonly launcher: Launcher;
  readonly launches: Launch[];
  readonly writes: string[];
  readonly state: { killed: number };
} {
  const launches: Launch[] = [];
  const writes: string[] = [];
  const state = { killed: 0 };
  const launcher: Launcher = {
    launch(target, safeMode) {
      launches.push({ target, safeMode });
      if (spawn === "fail") return Promise.resolve(err({ message: "spawn failed: ENOENT" }));
      const launched: Launched = {
        pid: 4242,
        events: eventsOf(spawn.events, spawn.hang === true),
        stdin: {
          write: (bytes) => {
            writes.push(DECODER.decode(bytes));
            return Promise.resolve();
          },
          close: () => undefined,
        },
        killGroup: () => {
          state.killed += 1;
        },
      };
      return Promise.resolve(ok(launched));
    },
    runOnce() {
      return Promise.resolve(err({ message: "not used in this test" }));
    },
  };
  return { launcher, launches, writes, state };
}

// ---------------------------------------------------------------------------------------------
// 가짜 vault, pair, 지문 재기

function vaultFake(setResult: Result<void, VaultError> = ok(undefined)): {
  readonly vault: TokenVault;
  readonly sets: { account: string; value: string }[];
} {
  const sets: { account: string; value: string }[] = [];
  const vault: TokenVault = {
    get: () => Promise.resolve(err({ kind: "not_found" })),
    set: (account, value) => {
      sets.push({ account, value });
      return Promise.resolve(setResult);
    },
    remove: () => Promise.resolve(ok(undefined)),
  };
  return { vault, sets };
}

function pairFake(reply: Result<PairGrant, PairError>): {
  readonly pair: (options: PairOptions) => Promise<Result<PairGrant, PairError>>;
  readonly calls: PairOptions[];
} {
  const calls: PairOptions[] = [];
  const pair = (options: PairOptions): Promise<Result<PairGrant, PairError>> => {
    calls.push(options);
    return Promise.resolve(reply);
  };
  return { pair, calls };
}

function probeFake(reply: Result<TlsProbe, WsError>): {
  readonly probeFingerprint: (options: {
    readonly host: string;
    readonly port: number;
    readonly timeoutMs?: number;
  }) => Promise<Result<TlsProbe, WsError>>;
  readonly calls: { host: string; port: number }[];
} {
  const calls: { host: string; port: number }[] = [];
  const probeFingerprint = (options: {
    readonly host: string;
    readonly port: number;
    readonly timeoutMs?: number;
  }): Promise<Result<TlsProbe, WsError>> => {
    calls.push({ host: options.host, port: options.port });
    return Promise.resolve(reply);
  };
  return { probeFingerprint, calls };
}

// ---------------------------------------------------------------------------------------------
// 시험 장치

interface RigOptions {
  readonly ssh?: SshReplies;
  readonly spawn?: Spawn | "fail";
  readonly vaultSet?: Result<void, VaultError>;
  readonly pair?: Result<PairGrant, PairError>;
  readonly probe?: Result<TlsProbe, WsError>;
}

interface Rig {
  readonly fake: FakeCtx;
  readonly launcher: ReturnType<typeof fakeLauncher>;
  readonly ssh: ReturnType<typeof sshFake>;
  readonly vault: ReturnType<typeof vaultFake>;
  readonly pair: ReturnType<typeof pairFake>;
  readonly probe: ReturnType<typeof probeFake>;
}

function rig(options: RigOptions = {}): Rig {
  const fake = fakeCtx();
  dirs.push(fake.dir);
  const launcher = fakeLauncher(options.spawn ?? { events: [stdoutLine(HELLO_RESULT)] });
  const ssh = sshFake(options.ssh);
  const vault = vaultFake(options.vaultSet);
  const pair = pairFake(options.pair ?? err(INVALID_CODE));
  const probe = probeFake(options.probe ?? ok({ fingerprint: FINGERPRINT, pem: "PEM" }));
  createRemoteModule({
    home: fake.dir,
    clock: clockFake(),
    launcherOf: () => launcher.launcher,
    vaultOf: () => vault.vault,
    ssh: { exec: ssh.exec },
    pair: pair.pair,
    probeFingerprint: probe.probeFingerprint,
    appVersion: () => Promise.resolve(LOCAL),
  }).register(fake.ctx);
  return { fake, launcher, ssh, vault, pair, probe };
}

/** 채널로 간 단계 이벤트를 `단계:상태:코드` 줄로 줄인다 */
function stepsOf(sent: readonly { readonly message: unknown }[]): string[] {
  return sent.map(({ message }) => {
    const event = ownField(message, "event");
    return `${String(ownField(event, "step"))}:${String(ownField(event, "status"))}:${String(ownField(event, "code"))}`;
  });
}

// ---------------------------------------------------------------------------------------------

describe("ssh_hosts", () => {
  test("lists the concrete Host entries of the temporary home's config and leaves out wildcards", async () => {
    const r = rig();
    mkdirSync(path.join(r.fake.dir, ".ssh"));
    writeFileSync(
      path.join(r.fake.dir, ".ssh", "config"),
      [
        "Host box",
        "  HostName box.example",
        "  User me",
        "  Port 2222",
        "",
        "Host *",
        "  User ignored",
        "",
        "Host dev-*",
        "Host ci",
        "  HostName ci.example",
        "",
      ].join("\n"),
    );
    expect(await r.fake.call("ssh_hosts")).toEqual({
      ok: true,
      value: {
        hosts: [
          { name: "box", hostName: "box.example", user: "me", port: 2222, proxyJump: false },
          { name: "ci", hostName: "ci.example", user: null, port: null, proxyJump: false },
        ],
        unreadable: null,
      },
    });
  });

  test("no config file is an empty list with missing, and a config that cannot be read is unreadable", async () => {
    const missing = rig();
    expect(await missing.fake.call("ssh_hosts")).toEqual({
      ok: true,
      value: { hosts: [], unreadable: "missing" },
    });
    const broken = rig();
    mkdirSync(path.join(broken.fake.dir, ".ssh", "config"), { recursive: true });
    expect(await broken.fake.call("ssh_hosts")).toEqual({
      ok: true,
      value: { hosts: [], unreadable: "unreadable" },
    });
  });
});

describe("ssh_preflight", () => {
  test("a reachable host passes every step, then the tunnel's hello answers; the result is the address and the tunnel time", async () => {
    const r = rig();
    const reply = await r.fake.call("ssh_preflight", {
      target: "me@box.example",
      events: { $channel: 7 },
    });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: true,
        address: ADDRESS,
        socket: SOCKET,
        remoteVersion: { cli: "0.4.0", contract: WIRE_PROTOCOL_VERSION },
        serviceVersion: "0.4.0",
        tunnelMs: expect.any(Number),
      },
    });
    expect(stepsOf(r.fake.sent)).toEqual([
      "resolve:running:running",
      "resolve:pass:ok",
      "connect:running:running",
      "connect:pass:ok",
      "install:running:running",
      "install:pass:ok",
      "service:running:running",
      "service:pass:ok",
      "socket:running:running",
      "socket:pass:ok",
      "tunnel:running:running",
      "tunnel:pass:ok",
    ]);
    expect(r.fake.sent.every((entry) => entry.id === 7)).toBe(true);
    expect(r.launcher.launches).toEqual([
      { target: { kind: "remote", address: ADDRESS }, safeMode: "default" },
    ]);
    expect(r.launcher.writes).toEqual([`${HELLO_REQUEST}\n`]);
    expect(r.launcher.state.killed).toBe(1);
    expect(r.fake.sent.at(-1)?.message).toEqual({
      type: "step",
      event: {
        step: "tunnel",
        status: "pass",
        code: "ok",
        durationMs: expect.any(Number),
        actions: [],
        detail: { serverVersion: "0.4.0" },
      },
    });
  });

  test("without an events channel the result is still returned and nothing is sent", async () => {
    const r = rig();
    const reply = await r.fake.call("ssh_preflight", { target: "me@box.example" });
    expect(reply).toMatchObject({ ok: true, value: { ok: true, address: ADDRESS } });
    expect(r.fake.sent).toEqual([]);
  });

  test("a preflight that stops early (version unreadable) returns the stop and never opens the tunnel", async () => {
    const r = rig({ ssh: { version: done("not json\n") } });
    const reply = await r.fake.call("ssh_preflight", {
      target: "me@box.example",
      events: { $channel: 7 },
    });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: false,
        step: "install",
        status: "fail",
        code: "version_unreadable",
        actions: ["retry"],
      },
    });
    expect(r.launcher.launches).toEqual([]);
    expect(stepsOf(r.fake.sent).at(-1)).toBe("install:fail:version_unreadable");
  });

  test("a hello that the server refuses for auth is auth_failed at tunnel, with no actions", async () => {
    const r = rig({ spawn: { events: [stdoutLine(HELLO_AUTH), exitWith(0)] } });
    const reply = await r.fake.call("ssh_preflight", {
      target: "me@box.example",
      events: { $channel: 7 },
    });
    expect(reply).toEqual({
      ok: true,
      value: { ok: false, step: "tunnel", status: "fail", code: "auth_failed", actions: [] },
    });
    expect(stepsOf(r.fake.sent).slice(-2)).toEqual([
      "tunnel:running:running",
      "tunnel:fail:auth_failed",
    ]);
    expect(r.launcher.state.killed).toBe(1);
  });

  test("a protocol mismatch names both contract versions and says the lower side (local) to upgrade", async () => {
    const r = rig({ spawn: { events: [stdoutLine(HELLO_PROTOCOL)] } });
    const reply = await r.fake.call("ssh_preflight", { target: "me@box.example" });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: false,
        step: "tunnel",
        status: "fail",
        code: "protocol_mismatch",
        actions: ["upgrade_local"],
        detail: { local: WIRE_PROTOCOL_VERSION, remote: "0.2.0" },
      },
    });
  });

  test("a child that exits before answering is tunnel_failed; the first stderr line gives the reason", async () => {
    const r = rig({
      spawn: { events: [stderrLine("Host key verification failed."), exitWith(255)] },
    });
    const reply = await r.fake.call("ssh_preflight", { target: "me@box.example" });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: false,
        step: "tunnel",
        status: "fail",
        code: "tunnel_failed",
        actions: ["retry"],
        detail: { reason: "host_key" },
      },
    });
  });

  test("a hello that never answers is timeout and the child group is still killed", async () => {
    const r = rig({ spawn: { events: [], hang: true } });
    const reply = await r.fake.call("ssh_preflight", { target: "me@box.example" });
    expect(reply).toEqual({
      ok: true,
      value: { ok: false, step: "tunnel", status: "fail", code: "timeout", actions: ["retry"] },
    });
    expect(r.launcher.state.killed).toBe(1);
  });

  test("a launch that fails is tunnel_failed with reason unknown", async () => {
    const r = rig({ spawn: "fail" });
    const reply = await r.fake.call("ssh_preflight", { target: "me@box.example" });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: false,
        step: "tunnel",
        status: "fail",
        code: "tunnel_failed",
        actions: ["retry"],
        detail: { reason: "unknown" },
      },
    });
  });

  test("a stdout line that is not a JSON-RPC answer is hello_failed with reason unreadable", async () => {
    const r = rig({ spawn: { events: [stdoutLine("garbage")] } });
    const reply = await r.fake.call("ssh_preflight", { target: "me@box.example" });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: false,
        step: "tunnel",
        status: "fail",
        code: "hello_failed",
        actions: ["retry"],
        detail: { reason: "unreadable" },
      },
    });
  });

  test("bad arguments are bad-request and ssh is never called", async () => {
    const r = rig();
    expect(await r.fake.call("ssh_preflight", { target: "x".repeat(257) })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("ssh_preflight", { target: "me@box.example\n" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(
      await r.fake.call("ssh_preflight", { target: "me@box.example", trustHostKey: "SHA256:x" }),
    ).toEqual({ ok: false, error: "bad-request" });
    expect(
      await r.fake.call("ssh_preflight", {
        target: "me@box.example",
        replaceChangedHostKey: "yes",
      }),
    ).toEqual({ ok: false, error: "bad-request" });
    expect(await r.fake.call("ssh_preflight")).toEqual({ ok: false, error: "bad-request" });
    expect(r.ssh.calls).toEqual([]);
  });
});

describe("remote_test", () => {
  test("the tunnel step alone runs against the saved address and answers ok with the server version", async () => {
    const r = rig();
    const address = "wss://box.example:8443/pin/aaaa";
    const reply = await r.fake.call("remote_test", { address });
    expect(reply).toEqual({
      ok: true,
      value: {
        ok: true,
        code: "ok",
        durationMs: expect.any(Number),
        detail: { serverVersion: "0.4.0" },
      },
    });
    expect(r.launcher.launches).toEqual([
      { target: { kind: "remote", address }, safeMode: "default" },
    ]);
    expect(r.ssh.calls).toEqual([]);
    expect(r.launcher.state.killed).toBe(1);
  });

  test("a child whose stderr says connection refused is tunnel_failed with reason refused", async () => {
    const r = rig({
      spawn: { events: [stderrLine("dial tcp: connection refused"), exitWith(1)] },
    });
    expect(await r.fake.call("remote_test", { address: "tcp://box.example:9000" })).toEqual({
      ok: true,
      value: {
        ok: false,
        code: "tunnel_failed",
        durationMs: expect.any(Number),
        detail: { reason: "refused" },
      },
    });
  });

  test("the socket-missing and unknown stderr lines are classified by their first line only", async () => {
    const socketMissing = rig({
      spawn: { events: [stderrLine("fresnel: socket does not exist"), exitWith(1)] },
    });
    expect(await socketMissing.fake.call("remote_test", { address: ADDRESS })).toMatchObject({
      ok: true,
      value: { code: "tunnel_failed", detail: { reason: "socket_missing" } },
    });
    const unknown = rig({
      spawn: { events: [stderrLine("something odd happened"), exitWith(1)] },
    });
    expect(await unknown.fake.call("remote_test", { address: ADDRESS })).toMatchObject({
      ok: true,
      value: { code: "tunnel_failed", detail: { reason: "unknown" } },
    });
  });

  test("an address that is empty, too long, or has a control character is bad-request", async () => {
    const r = rig();
    expect(await r.fake.call("remote_test", { address: "" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("remote_test", { address: "x".repeat(257) })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("remote_test", { address: "wss://a\u0001" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(r.launcher.launches).toEqual([]);
  });
});

describe("remote_fingerprint", () => {
  test("answers the 64-digit fingerprint of the probe, and the host and port went to the probe", async () => {
    const r = rig();
    expect(await r.fake.call("remote_fingerprint", { host: "box.example", port: 8443 })).toEqual({
      ok: true,
      value: { ok: true, fingerprint: FINGERPRINT },
    });
    expect(r.probe.calls).toEqual([{ host: "box.example", port: 8443 }]);
  });

  test("a probe failure answers its kind as the code", async () => {
    const refused: WsError = { kind: "refused", host: "box.example", port: 8443 };
    const r = rig({ probe: err(refused) });
    expect(await r.fake.call("remote_fingerprint", { host: "box.example", port: 8443 })).toEqual({
      ok: true,
      value: { ok: false, code: "refused" },
    });
    const timed: WsError = { kind: "timeout" };
    const slow = rig({ probe: err(timed) });
    expect(await slow.fake.call("remote_fingerprint", { host: "box.example", port: 8443 })).toEqual(
      {
        ok: true,
        value: { ok: false, code: "timeout" },
      },
    );
  });

  test("bad host text (space, slash, control) or port (0, 65536, fraction) is bad-request and nothing is probed", async () => {
    const r = rig();
    const bad: unknown[] = [
      { host: "box example", port: 8443 },
      { host: "box/example", port: 8443 },
      { host: "box\u0007", port: 8443 },
      { host: "", port: 8443 },
      { host: "box.example", port: 0 },
      { host: "box.example", port: 65536 },
      { host: "box.example", port: 1.5 },
      { host: "box.example" },
    ];
    const replies = await Promise.all(bad.map((args) => r.fake.call("remote_fingerprint", args)));
    expect(replies).toEqual(bad.map(() => ({ ok: false, error: "bad-request" })));
    expect(r.probe.calls).toEqual([]);
  });
});

describe("remote_pair", () => {
  const GRANT: PairGrant = { token: TOKEN, deviceId: "dev_1", deviceName: "laptop" };
  const ARGS = {
    host: "box.example",
    port: 8443,
    pin: FINGERPRINT,
    code: "123456",
    deviceName: "laptop",
  };

  test("a grant is stored under the wss account and the answer carries no token", async () => {
    const r = rig({ pair: ok(GRANT) });
    const reply = await r.fake.call("remote_pair", ARGS);
    expect(reply).toEqual({ ok: true, value: { ok: true, deviceName: "laptop" } });
    expect(r.vault.sets).toEqual([{ account: "box.example:8443", value: TOKEN }]);
    expect(r.pair.calls).toEqual([{ ...ARGS }]);
    expect(JSON.stringify(reply)).not.toContain(TOKEN);
  });

  test("the pairing errors map to their kind, and locked keeps retryAfterSeconds", async () => {
    const cases: [PairError, unknown][] = [
      [INVALID_CODE, { ok: false, code: "invalid_code" }],
      [
        { kind: "locked", retryAfterSeconds: 30 },
        { ok: false, code: "locked", retryAfterSeconds: 30 },
      ],
      [
        { kind: "fingerprint_changed", expected: FINGERPRINT, actual: "b".repeat(64) },
        { ok: false, code: "fingerprint_changed" },
      ],
      [
        { kind: "rejected", status: 403 },
        { ok: false, code: "rejected" },
      ],
    ];
    const runs = cases.map(([error]) => {
      const r = rig({ pair: err(error) });
      return { r, reply: r.fake.call("remote_pair", ARGS) };
    });
    const replies = await Promise.all(runs.map((run) => run.reply));
    expect(replies).toEqual(cases.map(([, expected]) => ({ ok: true, value: expected })));
    for (const run of runs) expect(run.r.vault.sets).toEqual([]);
  });

  test("a vault write failure is vault_failed and the token is not in the answer", async () => {
    const r = rig({ pair: ok(GRANT), vaultSet: err({ kind: "failed", code: "add_failed" }) });
    const reply = await r.fake.call("remote_pair", ARGS);
    expect(reply).toEqual({ ok: true, value: { ok: false, code: "vault_failed" } });
    expect(JSON.stringify(reply)).not.toContain(TOKEN);
  });

  test("an IPv6 host is stored under the bracketed account", async () => {
    const r = rig({ pair: ok(GRANT) });
    await r.fake.call("remote_pair", { ...ARGS, host: "::1" });
    expect(r.vault.sets.map((set) => set.account)).toEqual(["[::1]:8443"]);
  });

  test("bad input is bad-request, and an account that cannot be formed never reaches the gateway", async () => {
    const r = rig({ pair: ok(GRANT) });
    expect(await r.fake.call("remote_pair", { ...ARGS, pin: "p".repeat(129) })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("remote_pair", { ...ARGS, code: "" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("remote_pair", { ...ARGS, deviceName: "n".repeat(65) })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("remote_pair", { ...ARGS, port: 0 })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(await r.fake.call("remote_pair", { ...ARGS, host: "a@b" })).toEqual({
      ok: false,
      error: "bad-request",
    });
    expect(r.pair.calls).toEqual([]);
    expect(r.vault.sets).toEqual([]);
  });
});

describe("ssh_service_alive", () => {
  test("a connected host with a running service is alive with its version and code ok, and ensure is never called", async () => {
    const r = rig();
    expect(await r.fake.call("ssh_service_alive", { target: "me@box.example" })).toEqual({
      ok: true,
      value: { alive: true, version: "0.4.0", code: "ok" },
    });
    expect(r.ssh.calls.some((line) => line.includes("service ensure"))).toBe(false);
    expect(r.ssh.calls.some((line) => line.includes("fresnel service status --json"))).toBe(true);
  });

  test("a service that is not running is not alive, with code service_not_running", async () => {
    const r = rig({ ssh: { status: done(STATUS_STOPPED, 1) } });
    expect(await r.fake.call("ssh_service_alive", { target: "me@box.example" })).toEqual({
      ok: true,
      value: { alive: false, code: "service_not_running" },
    });
    expect(r.ssh.calls.some((line) => line.includes("service ensure"))).toBe(false);
  });

  test("a host that refuses the key is not alive, with the connect code", async () => {
    const r = rig({
      ssh: { connect: done("", 255, "Permission denied (publickey).\n") },
    });
    expect(await r.fake.call("ssh_service_alive", { target: "me@box.example" })).toEqual({
      ok: true,
      value: { alive: false, code: "auth_denied" },
    });
  });
});
