import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { runServiceCommand, pairTextOf } from "../../src/service/commands.ts";
import type { CommandIo } from "../../src/host-command.ts";
import { startService, type ServiceHandle, type ServiceOptions } from "../../src/index.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import {
  fakeGateway,
  FAKE_PAIR_CODE,
  FAKE_PAIR_EXPIRES_AT,
  OFF_VIEW,
  RUNNING_VIEW,
} from "../fixtures/fake-gateway.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { connectedClient, manualTime, scratchRuntimeDir } from "../fixtures/service-harness.ts";
import { writeUserSettings } from "../fixtures/user-settings.ts";

// 서비스의 원격 접속 연결(L4.remote §5.1, §8.3, §10): 설정이 켜져 있으면 시작 때 감독자를 띄우고, `host.remote.*`에 답하고,
// 끌 때 감독자를 세우고, 종료할 때 감독자를 정리한다. 실제 엔진과 Unix 소켓, 가짜 감독자(자식 프로세스 없음), 임시 홈.

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
  if (!result.started) throw new Error(`the service did not start: ${result.reason}`);
  return result.handle;
}

function captureIo(): { readonly io: CommandIo; stdout(): string; stderr(): string } {
  const decoder = new TextDecoder();
  const out: string[] = [];
  const err: string[] = [];
  const sink = (target: string[]): WritableStream<Uint8Array> =>
    new WritableStream<Uint8Array>({
      write(chunk) {
        target.push(decoder.decode(chunk));
      },
    });
  return {
    io: { stdin: new ReadableStream<Uint8Array>(), stdout: sink(out), stderr: sink(err) },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

/** 던져진 값에서 WireError를 꺼낸다. 아니면 시험이 실패한다 */
async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the call to fail with a WireError");
}

describe("gateway supervisor and the service", () => {
  realTest(
    "enabled in the settings: the gateway starts with the settings, host.remote answers, and shutdown disposes it",
    async () => {
      writeUserSettings(home, { "l4.remote.web.enabled": true });
      const gateway = fakeGateway();
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir, { gateway: gateway.supervisor }));
      try {
        // 기다리지 않고 띄운다. 시작이 불린 것은 서비스가 답하기 전이다
        expect(gateway.starts).toEqual([
          { listen: "127.0.0.1:8480", listenTls: null, hosts: [], tlsCert: null, tlsKey: null },
        ]);
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        try {
          expect(await client.request("host.remote.status", {})).toMatchObject({
            enabled: true,
            state: "running",
            loopbackPort: 8480,
          });
          expect(await client.request("host.remote.pair", {})).toEqual({
            code: FAKE_PAIR_CODE,
            expiresAt: FAKE_PAIR_EXPIRES_AT,
          });
          expect(await client.request("host.remote.devices", {})).toMatchObject({
            devices: [{ id: "dev_0123456789abcdef", kind: "web" }],
          });
        } finally {
          await client.close();
        }
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
      expect(gateway.counts.disposes).toBe(1);
    },
    60_000,
  );

  realTest(
    "disabled in the settings: the gateway is not started, the status is off, and pair answers remote.off (5008)",
    async () => {
      writeUserSettings(home, {});
      const gateway = fakeGateway();
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir, { gateway: gateway.supervisor }));
      try {
        expect(gateway.starts).toEqual([]);
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        try {
          expect(await client.request("host.remote.status", {})).toMatchObject({
            enabled: false,
            state: "off",
          });
          const failure = await wireErrorOf(client.request("host.remote.pair", {}));
          expect(failure.code).toBe(5008);
          expect(failure.data.kind).toBe("remote.off");
        } finally {
          await client.close();
        }
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
      expect(gateway.counts.disposes).toBe(1);
    },
    60_000,
  );

  realTest(
    "host.remote.setEnabled stores the user setting and starts or stops the gateway",
    async () => {
      writeUserSettings(home, {});
      const gateway = fakeGateway();
      const runtime = scratchRuntimeDir();
      const handle = await started(optionsFor(runtime.dir, { gateway: gateway.supervisor }));
      try {
        const client = await connectedClient({ kind: "unix", path: handle.registration.socket });
        try {
          const on = await client.request("host.remote.setEnabled", { enabled: true });
          expect(on).toMatchObject({ enabled: true, state: "running" });
          expect(gateway.starts).toHaveLength(1);
          expect(
            await client.request("settings.get", { keys: ["l4.remote.web.enabled"] }),
          ).toMatchObject({ settings: [{ key: "l4.remote.web.enabled", value: true }] });
          const stored: unknown = JSON.parse(
            readFileSync(join(home.root, "config", "settings.json"), "utf8"),
          );
          expect(stored).toMatchObject({ "l4.remote.web.enabled": true });

          const off = await client.request("host.remote.setEnabled", { enabled: false });
          expect(off).toMatchObject({ enabled: false, state: "off" });
          expect(gateway.counts.stops).toBe(1);
          expect(
            await client.request("settings.get", { keys: ["l4.remote.web.enabled"] }),
          ).toMatchObject({ settings: [{ key: "l4.remote.web.enabled", value: false }] });
        } finally {
          await client.close();
        }
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
      expect(gateway.counts.disposes).toBe(1);
    },
    60_000,
  );
});

describe("service remote commands over the registration file", () => {
  realTest(
    "service pair prints the grouped code line, and --json prints the code and expiry; status shows the remote lines",
    async () => {
      writeUserSettings(home, {});
      const runtime = scratchRuntimeDir();
      const handle = await started(
        optionsFor(runtime.dir, { gateway: fakeGateway(RUNNING_VIEW).supervisor }),
      );
      try {
        const text = captureIo();
        const textCode = await runServiceCommand({ kind: "service-pair", json: false }, text.io, {
          runtimeDir: runtime.dir,
          time: manualTime(),
        });
        expect(textCode).toBe(0);
        expect(text.stdout()).toBe(
          pairTextOf(FAKE_PAIR_CODE, FAKE_PAIR_EXPIRES_AT, manualTime().clock.now()),
        );
        expect(text.stdout()).toBe("pairing code ABCDE-12345 (expires in 5 min)\n");
        expect(text.stderr()).toBe("");

        const json = captureIo();
        const jsonCode = await runServiceCommand({ kind: "service-pair", json: true }, json.io, {
          runtimeDir: runtime.dir,
        });
        expect(jsonCode).toBe(0);
        expect(JSON.parse(json.stdout())).toEqual({
          code: FAKE_PAIR_CODE,
          expiresAt: FAKE_PAIR_EXPIRES_AT,
        });

        const status = captureIo();
        expect(
          await runServiceCommand({ kind: "service-status", json: false }, status.io, {
            runtimeDir: runtime.dir,
          }),
        ).toBe(0);
        expect(status.stdout()).toContain("remote running\n");
        expect(status.stdout()).toContain("ports loopback 8480\n");

        const statusJson = captureIo();
        expect(
          await runServiceCommand({ kind: "service-status", json: true }, statusJson.io, {
            runtimeDir: runtime.dir,
          }),
        ).toBe(0);
        expect(JSON.parse(statusJson.stdout())).toMatchObject({
          running: true,
          remote: { enabled: true, state: "running", loopbackPort: 8480 },
        });
      } finally {
        await handle.shutdown("stop");
        runtime.dispose();
      }
    },
    60_000,
  );

  realTest(
    "service pair exits 1 with the remote-off line when remote access is off, and 2 with the message when the gateway binary is missing",
    async () => {
      writeUserSettings(home, {});
      const off = scratchRuntimeDir();
      const offHandle = await started(
        optionsFor(off.dir, { gateway: fakeGateway(OFF_VIEW).supervisor }),
      );
      try {
        const captured = captureIo();
        const code = await runServiceCommand({ kind: "service-pair", json: false }, captured.io, {
          runtimeDir: off.dir,
        });
        expect(code).toBe(1);
        expect(captured.stdout()).toBe("");
        expect(captured.stderr()).toBe(
          'remote access is off; run "fresnel config set l4.remote.web.enabled true --scope user" and restart the service\n',
        );
      } finally {
        await offHandle.shutdown("stop");
        off.dispose();
      }

      const missing = scratchRuntimeDir();
      const missingHandle = await started(
        optionsFor(missing.dir, {
          gateway: fakeGateway({
            ...OFF_VIEW,
            state: "failed",
            error: { kind: "gateway-binary-missing", message: "fresnel-web was not found" },
          }).supervisor,
        }),
      );
      try {
        const captured = captureIo();
        const code = await runServiceCommand({ kind: "service-pair", json: true }, captured.io, {
          runtimeDir: missing.dir,
        });
        expect(code).toBe(2);
        expect(captured.stdout()).toBe("");
        expect(captured.stderr()).toBe("remote access cannot start: fresnel-web was not found\n");
      } finally {
        await missingHandle.shutdown("stop");
        missing.dispose();
      }
    },
    60_000,
  );

  realTest(
    "service pair exits 1 (not 2) with the restart hint when the gateway stopped repeatedly",
    async () => {
      writeUserSettings(home, {});
      const down = scratchRuntimeDir();
      const downHandle = await started(
        optionsFor(down.dir, {
          gateway: fakeGateway({
            ...OFF_VIEW,
            state: "failed",
            error: { kind: "gateway-down", message: "stopped repeatedly" },
          }).supervisor,
        }),
      );
      try {
        const captured = captureIo();
        const code = await runServiceCommand({ kind: "service-pair", json: false }, captured.io, {
          runtimeDir: down.dir,
        });
        expect(code).toBe(1);
        expect(captured.stdout()).toBe("");
        expect(captured.stderr()).toBe(
          "remote access failed (gateway-down); restart the service to try again\n",
        );
      } finally {
        await downHandle.shutdown("stop");
        down.dispose();
      }
    },
    60_000,
  );
});
