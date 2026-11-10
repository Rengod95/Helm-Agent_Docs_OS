import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { RemoteStatus } from "../../../src/app/remote/remote-types.ts";
import { engineFake, makeApp, until, type EngineExtra } from "../support.ts";

// 원격 어댑터를 실제 연결 경로(`commands.remote` → `withConnection` → wire 요청) 위에서 돌린다. 엔진은 가짜 ipc다.
// wire 오류 `remote.off`(5008)와 -32601이 어댑터의 `remote-off`·`unsupported`로 오는지, 요청 인자가 계약 모양인지 본다.

const STATUS: RemoteStatus = {
  enabled: true,
  state: "running",
  loopbackPort: 8480,
  tlsPort: 8443,
  hosts: ["localhost"],
  fingerprint: "ab".repeat(32),
  certSource: "self-signed",
  pushAvailable: true,
  error: null,
};

async function liveApp(extra: EngineExtra) {
  const engine = engineFake(undefined, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().link.phase === "live", "live link");
  return { app, ...engine };
}

describe("commands.remote over a real connection", () => {
  test("status, setEnabled, pair, devices and revoke send the contract params and read the replies", async () => {
    const { app, params } = await liveApp({
      results: {
        "host.remote.status": STATUS,
        "host.remote.setEnabled": STATUS,
        "host.remote.pair": { code: "7QX9M2KD4T", expiresAt: 1_800_000_300_000 },
        "host.remote.devices": { devices: [] },
        "host.remote.revoke": { revoked: 1 },
      },
    });
    expect(await app.commands.remote.status()).toEqual(ok(STATUS));
    expect(await app.commands.remote.setEnabled(true)).toEqual(ok(STATUS));
    expect(await app.commands.remote.pair()).toEqual(
      ok({ code: "7QX9M2KD4T", expiresAt: 1_800_000_300_000 }),
    );
    expect(await app.commands.remote.devices()).toEqual(ok([]));
    expect(await app.commands.remote.revoke({ id: "dev_1" })).toEqual(ok({ revoked: 1 }));
    expect(await app.commands.remote.revoke({ all: true })).toEqual(ok({ revoked: 1 }));
    const sent = params.filter((entry) => entry.method.startsWith("host.remote."));
    expect(sent.map((entry) => entry.method)).toEqual([
      "host.remote.status",
      "host.remote.setEnabled",
      "host.remote.pair",
      "host.remote.devices",
      "host.remote.revoke",
      "host.remote.revoke",
    ]);
    await app.stop();
  });

  test("remote.off (5008) arrives as remote-off", async () => {
    const { app } = await liveApp({
      errors: { "host.remote.pair": { code: 5008, kind: "remote.off" } },
    });
    expect(await app.commands.remote.pair()).toEqual(err({ kind: "remote-off" }));
    await app.stop();
  });

  test("a service without the method (-32601) arrives as unsupported", async () => {
    const { app } = await liveApp({
      errors: { "host.remote.status": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.remote.status()).toEqual(err({ kind: "unsupported" }));
    await app.stop();
  });
});
