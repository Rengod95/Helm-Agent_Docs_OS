// 제어 명령 시험: 실제 `AuthPort`(임시 폴더)에 붙여 pair의 코드가 실제로 쓰이는지, revoke가 폐기 구독자를 부르는지,
// 모르는 명령과 깨진 줄이 `bad_command`로 답하고 계속 도는지 본다.
import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { createAuthPort, type AuthPort } from "../../../src/web/auth/auth-port.ts";
import type { DeviceInfo } from "../../../src/web/auth/devices.ts";
import type { GatewayInfo } from "../../../src/web/server/gateway.ts";
import { controlHandler, type ControlReply } from "../../../src/web/main/control.ts";
import { cleanupTempDirs, manualClock, sequenceBytes, tempDir } from "../support/fixtures.ts";
import { recordingLogger } from "../support/logger.ts";

afterEach(cleanupTempDirs);

const PORTS: GatewayInfo = { loopbackPort: 8480, tlsPort: null, fingerprint: null };

function authIn(dir: string): AuthPort {
  const made = createAuthPort({
    dir,
    clock: manualClock(),
    logger: recordingLogger(),
    randomBytes: sequenceBytes(5),
  });
  if (!made.ok) throw new Error(`auth port did not open: ${made.error.kind}`);
  return made.value;
}

function setup(): { readonly auth: AuthPort; readonly handle: (line: string) => ControlReply } {
  const auth = authIn(path.join(tempDir(), "remote"));
  return { auth, handle: controlHandler({ auth, ports: () => PORTS }) };
}

/** 명령 답의 첫 이벤트 */
function firstEvent(reply: ControlReply): unknown {
  return reply.events[0];
}

describe("pair", () => {
  test("answers one pairing code that POST /pair's redeemer accepts", () => {
    const { auth, handle } = setup();
    const reply = handle('{"cmd":"pair"}');
    expect(reply.stop).toBe(false);
    const shown = reply.events[0];
    if (shown?.event !== "pairing-code") throw new Error("no pairing code event");
    expect(shown.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/u);
    expect(shown.expiresAt).toBeGreaterThan(0);
    const redeemed = auth.redeemPairingCode({
      code: shown.code,
      deviceName: "Laptop browser",
      kind: "web",
      address: "127.0.0.1",
    });
    expect(redeemed.ok).toBe(true);
    expect(auth.listDevices().map((device) => device.name)).toEqual(["Laptop browser"]);
  });

  test("the code is printed only by pair, never by status or devices", () => {
    const { handle } = setup();
    const paired = handle('{"cmd":"pair"}');
    const shown = paired.events[0];
    if (shown?.event !== "pairing-code") throw new Error("no pairing code event");
    expect(JSON.stringify(handle('{"cmd":"status"}').events)).not.toContain(shown.code);
    expect(JSON.stringify(handle('{"cmd":"devices"}').events)).not.toContain(shown.code);
  });
});

describe("status and devices", () => {
  test("status reports pairing, the device list and the ports and fingerprint", () => {
    const { auth, handle } = setup();
    const issued = auth.createPairingCode();
    const redeemed = auth.redeemPairingCode({
      code: issued.code,
      deviceName: "Phone",
      kind: "web",
      address: "10.0.0.2",
    });
    if (!redeemed.ok) throw new Error("pairing failed");
    const reply = handle('{"cmd":"status"}');
    expect(firstEvent(reply)).toEqual({
      event: "status",
      pairing: { active: false, expiresAt: null, lockedUntil: null },
      devices: [
        {
          id: redeemed.value.device.id,
          name: "Phone",
          kind: "web",
          createdAt: redeemed.value.device.createdAt,
          lastSeenAt: redeemed.value.device.lastSeenAt,
          lastAddress: "10.0.0.2",
        },
      ],
      loopbackPort: 8480,
      tlsPort: null,
      fingerprint: null,
    });
  });

  test("devices lists the same summaries without the token hash", () => {
    const { auth, handle } = setup();
    const issued = auth.createPairingCode();
    auth.redeemPairingCode({
      code: issued.code,
      deviceName: "Desk",
      kind: "desktop",
      address: "127.0.0.1",
    });
    const reply = handle('{"cmd":"devices"}');
    const event = firstEvent(reply);
    expect(event).toMatchObject({ event: "devices", devices: [{ name: "Desk", kind: "desktop" }] });
    expect(JSON.stringify(event)).not.toMatch(/tokenHash|token/u);
  });
});

describe("revoke", () => {
  test("revoke by id answers revoked 1 and tells the onRevoked subscribers the device", () => {
    const { auth, handle } = setup();
    const issued = auth.createPairingCode();
    const paired = auth.redeemPairingCode({
      code: issued.code,
      deviceName: "Tablet",
      kind: "web",
      address: "127.0.0.1",
    });
    if (!paired.ok) throw new Error("pairing failed");
    const revokedIds: string[] = [];
    auth.onRevoked((devices: readonly DeviceInfo[]) => {
      for (const device of devices) revokedIds.push(device.id);
    });
    const reply = handle(JSON.stringify({ cmd: "revoke", id: paired.value.device.id }));
    expect(reply).toEqual({ events: [{ event: "revoked", count: 1 }], stop: false });
    expect(revokedIds).toEqual([paired.value.device.id]);
    expect(auth.listDevices()).toEqual([]);
  });

  test("an unknown id answers not_found and revokes nothing", () => {
    const { handle } = setup();
    expect(handle('{"cmd":"revoke","id":"dev_missing"}').events).toEqual([
      { event: "error", error: "not_found" },
    ]);
  });

  test("revoke-all answers the count of devices it revoked", () => {
    const { auth, handle } = setup();
    for (const name of ["A", "B"]) {
      const issued = auth.createPairingCode();
      auth.redeemPairingCode({
        code: issued.code,
        deviceName: name,
        kind: "web",
        address: "127.0.0.1",
      });
    }
    expect(handle('{"cmd":"revoke-all"}').events).toEqual([{ event: "revoked", count: 2 }]);
    expect(auth.listDevices()).toEqual([]);
  });
});

describe("stop and bad input", () => {
  test("stop asks the caller to stop and prints nothing itself", () => {
    const { handle } = setup();
    expect(handle('{"cmd":"stop"}')).toEqual({ events: [], stop: true });
  });

  const bad: readonly (readonly [string, string])[] = [
    ["not JSON", "not json"],
    ["a JSON array", "[]"],
    ["a command that is not a string", '{"cmd":1}'],
    ["an unknown command", '{"cmd":"explode"}'],
    ["revoke without an id", '{"cmd":"revoke"}'],
    ["revoke with an empty id", '{"cmd":"revoke","id":""}'],
    ["an empty line", ""],
  ];
  for (const [name, line] of bad) {
    test(`${name} answers bad_command and keeps running`, () => {
      const { handle } = setup();
      const reply = handle(line);
      expect(reply).toEqual({ events: [{ event: "error", error: "bad_command" }], stop: false });
      // 뒤따르는 명령은 그대로 받는다
      expect(handle('{"cmd":"devices"}').events[0]).toMatchObject({ event: "devices" });
    });
  }
});
