import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createAuthPort,
  type AuthPort,
  type AuthVerifyError,
  type PairedDevice,
  type RedeemError,
  type RevokeError,
} from "../../src/web/auth/auth-port.ts";
import { DEVICES_FILE, hashToken } from "../../src/web/auth/devices.ts";
import type { DeviceInfo } from "../../src/web/auth/devices.ts";
import { cleanupTempDirs, manualClock, sequenceBytes, tempDir } from "./support/fixtures.ts";
import { recordingLogger, type RecordingLogger } from "./support/logger.ts";

afterEach(cleanupTempDirs);

const HOUR = 3_600_000;

function setup(dir = path.join(tempDir(), "remote")): {
  readonly auth: AuthPort;
  readonly clock: ReturnType<typeof manualClock>;
  readonly logger: RecordingLogger;
  readonly dir: string;
} {
  const clock = manualClock();
  const logger = recordingLogger();
  const created = createAuthPort({ dir, clock, logger, randomBytes: sequenceBytes(2) });
  if (!created.ok) throw new Error(`auth port did not open: ${created.error.kind}`);
  return { auth: created.value, clock, logger, dir };
}

function pair(auth: AuthPort, name = "Tab", kind: "web" | "desktop" = "web"): string {
  const issued = auth.createPairingCode();
  const result = auth.redeemPairingCode({
    code: issued.code,
    deviceName: name,
    kind,
    address: "10.0.0.5",
  });
  if (!result.ok) throw new Error(`pairing failed: ${result.error.kind}`);
  return result.value.token;
}

describe("AuthPort result shapes", () => {
  test("each failure carries a kind from the declared unions", () => {
    const { auth } = setup();
    const bad: RedeemError = { kind: "invalid_device_name" };
    const unknown: AuthVerifyError = { kind: "unknown_token" };
    const missing: RevokeError = { kind: "not_found" };
    expect(
      auth.redeemPairingCode({ code: "x", deviceName: " ", kind: "web", address: "a" }),
    ).toEqual({
      ok: false,
      error: bad,
    });
    expect(auth.verifyToken(null, "a")).toEqual({ ok: false, error: unknown });
    expect(auth.revokeDevice("dev_0000000000000000")).toEqual({ ok: false, error: missing });
    const issued = auth.createPairingCode();
    const paired: PairedDevice | null = (() => {
      const result = auth.redeemPairingCode({
        code: issued.code,
        deviceName: "Shape",
        kind: "desktop",
        address: "a",
      });
      return result.ok ? result.value : null;
    })();
    expect(paired?.device.kind).toBe("desktop");
    expect(paired?.token).toHaveLength(43);
  });
});

describe("AuthPort pairing and verification", () => {
  test("a code becomes a device token that verifies, and the code cannot be used twice", () => {
    const { auth } = setup();
    const issued = auth.createPairingCode();
    const redeemed = auth.redeemPairingCode({
      code: issued.display,
      deviceName: "  Pixel Tablet ",
      kind: "web",
      address: "10.0.0.5",
    });
    if (!redeemed.ok) throw new Error("pairing failed");
    expect(redeemed.value.device.name).toBe("Pixel Tablet");
    expect(redeemed.value.device.kind).toBe("web");

    const verified = auth.verifyToken(redeemed.value.token, "10.0.0.6");
    if (!verified.ok) throw new Error("verify failed");
    expect(verified.value.id).toBe(redeemed.value.device.id);
    expect(verified.value.lastAddress).toBe("10.0.0.6");

    expect(
      auth.redeemPairingCode({
        code: issued.code,
        deviceName: "Again",
        kind: "web",
        address: "10.0.0.5",
      }),
    ).toEqual({ ok: false, error: { kind: "invalid_code" } });
    expect(auth.listDevices().map((device) => device.name)).toEqual(["Pixel Tablet"]);
  });

  test("a bad device name is refused without using the code or counting a failure", () => {
    const { auth } = setup();
    const issued = auth.createPairingCode();
    for (let i = 0; i < 10; i += 1) {
      expect(
        auth.redeemPairingCode({
          code: issued.code,
          deviceName: "  ",
          kind: "web",
          address: "10.0.0.5",
        }),
      ).toEqual({ ok: false, error: { kind: "invalid_device_name" } });
    }
    expect(auth.pairingStatus().lockedUntil).toBeNull();
    const ok = auth.redeemPairingCode({
      code: issued.code,
      deviceName: "Fine",
      kind: "web",
      address: "10.0.0.5",
    });
    expect(ok.ok).toBe(true);
  });

  test("wrong codes lock pairing after five failures and the lock is visible in the status", () => {
    const { auth, clock } = setup();
    auth.createPairingCode();
    for (let i = 0; i < 4; i += 1) {
      auth.redeemPairingCode({
        code: "WRONGWRONG",
        deviceName: "X",
        kind: "web",
        address: "9.9.9.9",
      });
    }
    const fifth = auth.redeemPairingCode({
      code: "WRONGWRONG",
      deviceName: "X",
      kind: "web",
      address: "9.9.9.9",
    });
    expect(fifth).toEqual({
      ok: false,
      error: { kind: "locked", scope: "all", retryAfterMs: 15 * 60_000 },
    });
    expect(auth.pairingStatus()).toEqual({
      active: false,
      expiresAt: null,
      lockedUntil: clock.now() + 15 * 60_000,
    });
  });

  test("verifyToken refuses null, malformed and unknown tokens", () => {
    const { auth } = setup();
    const token = pair(auth);
    const wrong = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    for (const bad of [null, "", "short", wrong]) {
      expect(auth.verifyToken(bad, "10.0.0.5")).toEqual({
        ok: false,
        error: { kind: "unknown_token" },
      });
    }
  });

  test("a web token expires after 12 idle hours but a desktop token does not", () => {
    const { auth, clock } = setup();
    const web = pair(auth, "Browser", "web");
    const desktop = pair(auth, "Mac", "desktop");
    clock.advance(12 * HOUR);
    const expired = auth.verifyToken(web, "10.0.0.5");
    expect(expired.ok ? "ok" : expired.error.kind).toBe("expired");
    expect(auth.verifyToken(desktop, "10.0.0.5").ok).toBe(true);
  });

  test("devices and tokens survive a restart with the file on disk", () => {
    const first = setup();
    const token = pair(first.auth, "Persisted");
    const second = setup(first.dir);
    expect(second.auth.listDevices().map((device) => device.name)).toEqual(["Persisted"]);
    expect(second.auth.verifyToken(token, "10.0.0.5").ok).toBe(true);
  });

  test("a corrupt device file stops the port from opening and is left untouched", () => {
    const first = setup();
    pair(first.auth);
    const file = path.join(first.dir, DEVICES_FILE);
    writeFileSync(file, "{ broken");
    const broken = createAuthPort({
      dir: first.dir,
      clock: manualClock(),
      logger: recordingLogger(),
    });
    expect(broken).toEqual({
      ok: false,
      error: { kind: "corrupt", path: file, reason: "not_json" },
    });
    expect(readFileSync(file, "utf8")).toBe("{ broken");
  });
});

describe("AuthPort revocation", () => {
  test("revoking a device kills its token, tells subscribers and reports unknown ids", () => {
    const { auth } = setup();
    const keep = pair(auth, "Keep");
    const drop = pair(auth, "Drop");
    const dropDevice = auth.listDevices().find((device) => device.name === "Drop");
    if (dropDevice === undefined) throw new Error("device missing");

    const seen: DeviceInfo[][] = [];
    const unsubscribe = auth.onRevoked((devices) => seen.push([...devices]));
    expect(auth.revokeDevice(dropDevice.id)).toEqual({ ok: true, value: dropDevice });
    expect(seen).toEqual([[dropDevice]]);
    expect(auth.verifyToken(drop, "10.0.0.5")).toEqual({
      ok: false,
      error: { kind: "unknown_token" },
    });
    expect(auth.verifyToken(keep, "10.0.0.5").ok).toBe(true);

    expect(auth.revokeDevice(dropDevice.id)).toEqual({ ok: false, error: { kind: "not_found" } });
    expect(seen).toHaveLength(1);

    unsubscribe();
    const keepDevice = auth.listDevices()[0];
    if (keepDevice === undefined) throw new Error("device missing");
    auth.revokeDevice(keepDevice.id);
    expect(seen).toHaveLength(1);
  });

  test("revokeAll closes every device and notifies once with all of them", () => {
    const { auth } = setup();
    const a = pair(auth, "A");
    const b = pair(auth, "B");
    const seen: string[][] = [];
    auth.onRevoked((devices) => seen.push(devices.map((device) => device.name)));
    const all = auth.revokeAllDevices();
    expect(all.ok ? all.value.map((device) => device.name) : "failed").toEqual(["A", "B"]);
    expect(seen).toEqual([["A", "B"]]);
    expect(auth.verifyToken(a, "x").ok).toBe(false);
    expect(auth.verifyToken(b, "x").ok).toBe(false);
    // 지울 것이 없으면 알리지 않는다
    auth.revokeAllDevices();
    expect(seen).toHaveLength(1);
  });
});

describe("AuthPort logging and secrets", () => {
  test("neither the token, the code nor the hash reaches a log line or any file but devices.json (as hash)", () => {
    const { auth, logger, dir } = setup();
    const issued = auth.createPairingCode();
    auth.redeemPairingCode({
      code: "WRONGWRONG",
      deviceName: "X",
      kind: "web",
      address: "9.9.9.9",
    });
    const redeemed = auth.redeemPairingCode({
      code: issued.code,
      deviceName: "Logged",
      kind: "web",
      address: "10.0.0.5",
    });
    if (!redeemed.ok) throw new Error("pairing failed");
    const { token } = redeemed.value;
    auth.verifyToken(token, "10.0.0.5");
    auth.verifyToken(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, "6.6.6.6");
    auth.revokeDevice(redeemed.value.device.id);

    const logged = JSON.stringify(logger.entries);
    for (const secret of [token, issued.code, issued.display, hashToken(token), "WRONGWRONG"]) {
      expect(logged).not.toContain(secret);
    }
    expect(logger.entries.map((entry) => [entry.level, entry.event])).toEqual([
      ["warn", "auth.pair_failed"],
      ["info", "auth.device_paired"],
      ["warn", "auth.token_rejected"],
      ["info", "auth.device_revoked"],
    ]);
    expect(logger.entries[0]?.fields).toEqual({ address: "9.9.9.9" });
    expect(logger.entries[1]?.fields).toEqual({
      deviceId: redeemed.value.device.id,
      name: "Logged",
      kind: "web",
      address: "10.0.0.5",
    });
    expect(logger.entries[2]?.fields).toEqual({ address: "6.6.6.6", reason: "unknown_token" });

    // 디스크에는 devices.json 하나뿐이고 토큰 원문이 없다
    for (const entry of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, entry), "utf8")).not.toContain(token);
    }
  });

  test("a lock and a refused token are logged with the reason", () => {
    const { auth, logger } = setup();
    auth.createPairingCode();
    for (let i = 0; i < 5; i += 1) {
      auth.redeemPairingCode({
        code: "WRONGWRONG",
        deviceName: "X",
        kind: "web",
        address: "9.9.9.9",
      });
    }
    auth.verifyToken(null, "9.9.9.9");
    const lock = logger.entries.find((entry) => entry.event === "auth.pair_locked");
    expect(lock?.fields).toEqual({
      address: "9.9.9.9",
      scope: "all",
      until: Date.UTC(2026, 10, 8) + 15 * 60_000,
    });
    const refused = logger.entries.find((entry) => entry.event === "auth.token_rejected");
    expect(refused?.fields).toEqual({ address: "9.9.9.9", reason: "missing_or_malformed" });
  });
});
