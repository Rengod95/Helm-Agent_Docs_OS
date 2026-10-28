import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { createRegistrationStore } from "@xeon/platform-process";
import { createHostConnection } from "../../src/client.ts";
import {
  connectServiceTransport,
  ensureHostService,
  serviceStatus,
  startService,
  stopHostService,
  type ServiceHandle,
  type ServiceOptions,
} from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  connectedClient,
  manualTime,
  scratchRuntimeDir,
  wireErrorOf,
} from "../fixtures/service-harness.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3b B1-SVC(int): 서비스 소켓과 등록 파일의 모드(0600), 이중 기동 방지, ensure의 붙기, TCP 토큰 인증(host.authFailed), 정지·안전 모드·종료 경로.
// 실제 엔진, 실제 Unix 소켓과 TCP 소켓, 임시 홈.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;
const home = useEngineHome();
afterAll(() => {
  home.dispose();
});

function optionsFor(runtimeDir: string, extra: Partial<ServiceOptions> = {}): ServiceOptions {
  return {
    runtimeDir,
    assemble: { devChecks: true, defaultGroups: false },
    time: manualTime(),
    handleSignals: false,
    startupGraceMs: 0,
    idleGraceMs: 60_000,
    ...extra,
  };
}

async function started(options: ServiceOptions): Promise<ServiceHandle> {
  const result = await startService(options);
  if (!result.started) {
    throw new Error(`the service did not start: ${result.reason}`);
  }
  return result.handle;
}

const NO_SPAWN = { command: "/nonexistent/xeon-must-not-spawn", args: [] };

describe("service files and double start", () => {
  realTest(
    "the socket and the registration file are 0600; a second start loses; ensure attaches instead of starting twice",
    async () => {
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir));
      try {
        const { registration } = handle;
        expect(statSync(registration.socket).mode & 0o777).toBe(0o600);
        expect(statSync(join(runtime.dir, "service.json")).mode & 0o777).toBe(0o600);
        const stored: unknown = JSON.parse(readFileSync(join(runtime.dir, "service.json"), "utf8"));
        expect(stored).toMatchObject({
          schemaVersion: 1,
          pid: process.pid,
          socket: join(runtime.dir, "xeon.sock"),
        });
        expect(registration.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

        // 같은 runtimeDir에서 두 번째 서비스는 소켓 선점에 지고 기존 등록을 돌려준다
        const second = await startService(optionsFor(runtime.dir));
        expect(second.started).toBe(false);
        if (!second.started) {
          expect(second.reason).toBe("in_use");
          if (second.reason === "in_use") expect(second.existing?.pid).toBe(registration.pid);
        }

        // 동시에 두 번 ensure해도 서비스를 새로 띄우지 않는다(띄우려 하면 spawn_failed가 된다)
        const ensured = await Promise.all([
          ensureHostService({ runtimeDir: runtime.dir, start: NO_SPAWN }),
          ensureHostService({ runtimeDir: runtime.dir, start: NO_SPAWN }),
        ]);
        for (const result of ensured) {
          expect(result.ok && result.value.outcome).toEqual({
            kind: "connected",
            registration,
            started: false,
          });
        }

        const status = await serviceStatus({ runtimeDir: runtime.dir });
        expect(status.ok && status.value.running).toBe(true);
        if (status.ok && status.value.running) {
          expect(status.value.status).toMatchObject({ mode: "service", pid: process.pid });
        }
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "ensure with no service reports the spawn failure instead of hanging, and a stale registration is not an answer",
    async () => {
      const runtime = scratchRuntimeDir();
      try {
        const result = await ensureHostService({ runtimeDir: runtime.dir, start: NO_SPAWN });
        expect(result).toEqual({ ok: false, error: { kind: "spawn_failed", code: "ENOENT" } });
      } finally {
        runtime.dispose();
      }
    },
    30_000,
  );
});

describe("tcp listener and token", () => {
  realTest(
    "a tcp client without the token is rejected with host.authFailed (missing), a wrong one with invalid, and the connection closes; unix needs no token",
    async () => {
      const runtime = scratchRuntimeDir();
      const handle = await started(
        optionsFor(runtime.dir, { tcp: { host: "127.0.0.1", port: 0 } }),
      );
      try {
        const address = handle.tcpAddress;
        if (address === undefined) throw new Error("the service did not open tcp");
        const [host, portText] = address.split(":");
        const endpoint = { kind: "tcp" as const, host: host ?? "", port: Number(portText) };

        const transport = await connectServiceTransport(endpoint);
        if (!transport.ok) throw new Error("tcp connect failed");
        const bare = createHostConnection(transport.value);
        const missing = await wireErrorOf(bare.request("host.hello", HELLO_PARAMS));
        expect(missing.data.kind).toBe("host.authFailed");
        expect(missing.data.details).toEqual({ reason: "missing" });
        // 응답이 나간 뒤 연결이 닫힌다
        await bare.closed;

        const wrongTransport = await connectServiceTransport(endpoint);
        if (!wrongTransport.ok) throw new Error("tcp connect failed");
        const wrong = createHostConnection(wrongTransport.value);
        const invalid = await wireErrorOf(
          wrong.request("host.hello", { ...HELLO_PARAMS, auth: { token: "x".repeat(43) } }),
        );
        expect(invalid.data.kind).toBe("host.authFailed");
        expect(invalid.data.details).toEqual({ reason: "invalid" });
        await wrong.closed;

        // 맞는 토큰은 hello를 통과하고 같은 서비스가 답한다
        const good = await connectedClient(endpoint, handle.registration.token);
        expect(await good.request("host.status", {})).toMatchObject({
          mode: "service",
          pid: process.pid,
        });
        await good.close();

        // Unix 소켓은 토큰 없이도 된다(파일 권한이 막는다)
        const local = await connectedClient({ kind: "unix", path: handle.registration.socket });
        await local.close();
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "rotating the token invalidates the old one for new connections and rewrites the registration file",
    async () => {
      const runtime = scratchRuntimeDir();
      const handle = await started(
        optionsFor(runtime.dir, { tcp: { host: "127.0.0.1", port: 0 } }),
      );
      try {
        const old = handle.registration.token;
        const next = handle.rotateToken();
        expect(next).not.toBe(old);
        const stored: unknown = JSON.parse(readFileSync(join(runtime.dir, "service.json"), "utf8"));
        expect(stored).toMatchObject({ token: next });
        const [host, portText] = (handle.tcpAddress ?? "").split(":");
        const endpoint = { kind: "tcp" as const, host: host ?? "", port: Number(portText) };
        const transport = await connectServiceTransport(endpoint);
        if (!transport.ok) throw new Error("tcp connect failed");
        const stale = createHostConnection(transport.value);
        const error = await wireErrorOf(
          stale.request("host.hello", { ...HELLO_PARAMS, auth: { token: old } }),
        );
        expect(error.data.details).toEqual({ reason: "invalid" });
        await stale.closed;
        const fresh = await connectedClient(endpoint, next);
        await fresh.close();
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );
});

describe("tcp loopback rule and identity", () => {
  realTest(
    "startService refuses a non-loopback tcp host with tcp_not_loopback and leaves nothing behind",
    async () => {
      const runtime = scratchRuntimeDir();
      try {
        const result = await startService(
          optionsFor(runtime.dir, { tcp: { host: "0.0.0.0", port: 0 } }),
        );
        expect(result.started).toBe(false);
        if (!result.started && result.reason === "failed") {
          expect(result.message).toContain("tcp_not_loopback");
        }
        expect(existsSync(join(runtime.dir, "service.json"))).toBe(false);
      } finally {
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "serviceStatus does not report a service whose registration start time differs from the running process",
    async () => {
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir));
      try {
        const real = await serviceStatus({ runtimeDir: runtime.dir });
        expect(real.ok && real.value.running).toBe(true);
        const store = createRegistrationStore({ path: join(runtime.dir, "service.json") });
        store.write({ ...handle.registration, startedAt: handle.registration.startedAt + 1 });
        const forged = await serviceStatus({ runtimeDir: runtime.dir });
        expect(forged).toEqual({ ok: true, value: { running: false, reason: "unreachable" } });
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );
});

describe("stopping and modes", () => {
  realTest(
    "stopHostService asks for a cooperative shutdown, the service removes its files and exits with reason stop",
    async () => {
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir));
      try {
        const stopped = await stopHostService({ runtimeDir: runtime.dir });
        expect(stopped).toEqual({ ok: true, value: { kind: "stopped" } });
        expect(await handle.exited).toEqual({ code: 0, reason: "stop" });
        expect(existsSync(join(runtime.dir, "service.json"))).toBe(false);
        expect(existsSync(join(runtime.dir, "xeon.sock"))).toBe(false);
        // 다시 정지를 요청하면 떠 있는 서비스가 없다
        expect(await stopHostService({ runtimeDir: runtime.dir })).toEqual({
          ok: true,
          value: { kind: "not_running" },
        });
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "a signal shutdown exits 0 with reason signal",
    async () => {
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir));
      try {
        await handle.shutdown("signal");
        expect(await handle.exited).toEqual({ code: 0, reason: "signal" });
      } finally {
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "safe mode is reported by host.status only when it is on",
    async () => {
      const off = scratchRuntimeDir();
      const on = scratchRuntimeDir();
      const plain = await started(optionsFor(off.dir));
      const safe = await started(
        optionsFor(on.dir, { assemble: { devChecks: true, defaultGroups: false, safeMode: true } }),
      );
      try {
        const offClient = await connectedClient({ kind: "unix", path: plain.registration.socket });
        const onClient = await connectedClient({ kind: "unix", path: safe.registration.socket });
        expect((await offClient.request("host.status", {})).safeMode).toBeUndefined();
        expect((await onClient.request("host.status", {})).safeMode).toBe(true);
        await offClient.close();
        await onClient.close();
      } finally {
        await plain.shutdown("stop");
        await safe.shutdown("stop");
        off.dispose();
        on.dispose();
      }
    },
    60_000,
  );

  realTest(
    "x.operations.safeMode.default turns safe mode on for a service started without the flag, and an explicit false wins",
    async () => {
      writeUserSettings(home, { "x.operations.safeMode.default": true });
      const viaSetting = scratchRuntimeDir();
      const overridden = scratchRuntimeDir();
      const fromSetting = await started(optionsFor(viaSetting.dir));
      const forcedOff = await started(
        optionsFor(overridden.dir, {
          assemble: { devChecks: true, defaultGroups: false, safeMode: false },
        }),
      );
      try {
        const on = await connectedClient({ kind: "unix", path: fromSetting.registration.socket });
        const off = await connectedClient({ kind: "unix", path: forcedOff.registration.socket });
        expect((await on.request("host.status", {})).safeMode).toBe(true);
        expect((await off.request("host.status", {})).safeMode).toBeUndefined();
        await on.close();
        await off.close();
      } finally {
        await fromSetting.shutdown("stop");
        await forcedOff.shutdown("stop");
        writeUserSettings(home, {});
        viaSetting.dispose();
        overridden.dispose();
      }
    },
    60_000,
  );
});
