import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseJson } from "@fresnel/contracts";
import { ownField } from "../../src/main/lib/narrow.ts";
import {
  cleanDeviceName,
  DEVICES_FILE,
  hashToken,
  LAST_SEEN_FLUSH_MS,
  openDeviceStore,
  SESSION_ABSOLUTE_MS,
  SESSION_SLIDING_MS,
  TOKEN_LENGTH,
  type DeviceStore,
} from "../../src/web/auth/devices.ts";
import type { FileError } from "../../src/web/auth/atomic-file.ts";
import { cleanupTempDirs, manualClock, sequenceBytes, tempDir } from "./support/fixtures.ts";

afterEach(cleanupTempDirs);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function jsonOf(text: string): unknown {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error("file is not JSON");
  return parsed.value;
}

function devicesOf(file: string): readonly unknown[] {
  const list = ownField(jsonOf(readFileSync(file, "utf8")), "devices");
  if (!Array.isArray(list)) throw new Error("devices is not a list");
  return list;
}

function numberField(value: unknown, name: string): number {
  const field = ownField(value, name);
  if (typeof field !== "number") throw new Error(`${name} is not a number`);
  return field;
}

function open(
  dir: string,
  clock: ReturnType<typeof manualClock>,
  background: FileError[] = [],
): DeviceStore {
  const opened = openDeviceStore({
    dir,
    clock,
    randomBytes: sequenceBytes(9),
    onBackgroundError: (error) => background.push(error),
  });
  if (!opened.ok) throw new Error(`store did not open: ${opened.error.kind}`);
  return opened.value;
}

function added(store: DeviceStore, name: string, kind: "web" | "desktop" = "web"): string {
  const result = store.add({ name, kind, address: "10.0.0.5" });
  if (!result.ok) throw new Error(`add failed: ${result.error.kind}`);
  return result.value.token;
}

describe("device names", () => {
  test("are trimmed and limited to 1 to 64 characters without control characters", () => {
    expect(cleanDeviceName("  iPad 방  ")).toEqual({ ok: true, value: "iPad 방" });
    expect(cleanDeviceName("a".repeat(64)).ok).toBe(true);
    for (const bad of ["", "   ", "a".repeat(65), "a\nb", "a\u0000b", "a‮b", "a b"]) {
      expect(cleanDeviceName(bad)).toEqual({ ok: false, error: { kind: "invalid_device_name" } });
    }
  });
});

describe("device store", () => {
  test("a new device gets a 256-bit token and only its hash is stored", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const store = open(dir, clock);
    const result = store.add({ name: "Galaxy Tab", kind: "web", address: "10.0.0.5" });
    if (!result.ok) throw new Error("add failed");
    const { token, device } = result.value;
    expect(token).toHaveLength(TOKEN_LENGTH);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(device).toEqual({
      id: expect.stringMatching(/^dev_[0-9a-f]{16}$/u),
      name: "Galaxy Tab",
      kind: "web",
      createdAt: clock.now(),
      lastSeenAt: clock.now(),
      lastAddress: "10.0.0.5",
      sessionExpiresAt: clock.now() + 12 * HOUR,
      expired: false,
    });

    const file = path.join(dir, DEVICES_FILE);
    const text = readFileSync(file, "utf8");
    expect(text).not.toContain(token);
    expect(text).toContain(hashToken(token));
    expect(jsonOf(text)).toEqual({
      version: 1,
      devices: [
        {
          id: device.id,
          name: "Galaxy Tab",
          kind: "web",
          tokenHash: hashToken(token),
          createdAt: clock.now(),
          lastSeenAt: clock.now(),
          lastAddress: "10.0.0.5",
        },
      ],
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual([DEVICES_FILE]);
  });

  test("tokens differ per device and verify returns the device", () => {
    const clock = manualClock();
    const store = open(path.join(tempDir(), "remote"), clock);
    const a = added(store, "A");
    const b = added(store, "B");
    expect(a).not.toBe(b);
    const verified = store.verify(b, "10.0.0.9");
    if (!verified.ok) throw new Error("verify failed");
    expect(verified.value.name).toBe("B");
    expect(verified.value.lastAddress).toBe("10.0.0.9");
  });

  test("an unknown or malformed token is unknown_token", () => {
    const store = open(path.join(tempDir(), "remote"), manualClock());
    const good = added(store, "A");
    const unknown = `${good.slice(0, -1)}${good.endsWith("A") ? "B" : "A"}`;
    expect(store.verify(unknown, "x")).toEqual({ ok: false, error: { kind: "unknown_token" } });
    expect(store.verify("short", "x")).toEqual({ ok: false, error: { kind: "unknown_token" } });
    expect(store.verify("", "x")).toEqual({ ok: false, error: { kind: "unknown_token" } });
  });

  test("devices survive reopening the file", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const token = added(open(dir, clock), "Phone");
    clock.advance(HOUR);
    const reopened = open(dir, clock);
    expect(reopened.list().map((device) => device.name)).toEqual(["Phone"]);
    expect(reopened.verify(token, "10.0.0.5").ok).toBe(true);
  });

  test("web login slides by 12 hours and ends at 30 days at the latest", () => {
    const clock = manualClock();
    const store = open(path.join(tempDir(), "remote"), clock);
    const token = added(store, "Laptop");
    expect(SESSION_SLIDING_MS).toBe(12 * HOUR);
    expect(SESSION_ABSOLUTE_MS).toBe(30 * DAY);

    // 11시간 59분 59.999초 뒤: 아직 유효하고 슬라이딩으로 연장된다
    clock.advance(12 * HOUR - 1);
    expect(store.verify(token, "10.0.0.5").ok).toBe(true);
    clock.advance(12 * HOUR - 1);
    expect(store.verify(token, "10.0.0.5").ok).toBe(true);

    // 12시간이 정확히 지나면 만료
    clock.advance(12 * HOUR);
    const late = store.verify(token, "10.0.0.5");
    expect(late.ok ? "ok" : late.error.kind).toBe("expired");
  });

  test("the absolute limit wins over the sliding window", () => {
    const clock = manualClock();
    const store = open(path.join(tempDir(), "remote"), clock);
    const token = added(store, "Laptop");
    const start = clock.now();
    // 11시간마다 접속해 30일 직전까지 이어 간다
    let result = store.verify(token, "10.0.0.5");
    while (clock.now() + 11 * HOUR < start + 30 * DAY) {
      clock.advance(11 * HOUR);
      result = store.verify(token, "10.0.0.5");
      expect(result.ok).toBe(true);
    }
    // 마지막 접속에서 11시간 안이어도 30일이 차면 끝이다
    clock.set(start + 30 * DAY - 1);
    expect(store.verify(token, "10.0.0.5").ok).toBe(true);
    clock.set(start + 30 * DAY);
    const ended = store.verify(token, "10.0.0.5");
    expect(ended.ok ? "ok" : ended.error.kind).toBe("expired");
    expect(store.list()[0]?.sessionExpiresAt).toBe(start + 30 * DAY);
    expect(store.list()[0]?.expired).toBe(true);
  });

  test("an expired device is not refreshed and stays listed until the next pairing prunes it", () => {
    const clock = manualClock();
    const store = open(path.join(tempDir(), "remote"), clock);
    const token = added(store, "Old");
    clock.advance(13 * HOUR);
    const first = store.verify(token, "10.0.0.5");
    const second = store.verify(token, "10.0.0.5");
    expect(first.ok ? "ok" : first.error.kind).toBe("expired");
    expect(second.ok ? "ok" : second.error.kind).toBe("expired");
    expect(store.list().map((device) => [device.name, device.expired])).toEqual([["Old", true]]);
    added(store, "New");
    expect(store.list().map((device) => device.name)).toEqual(["New"]);
  });

  test("desktop devices never expire", () => {
    const clock = manualClock();
    const store = open(path.join(tempDir(), "remote"), clock);
    const token = added(store, "Mac mini", "desktop");
    clock.advance(400 * DAY);
    const verified = store.verify(token, "10.0.0.7");
    if (!verified.ok) throw new Error("desktop token expired");
    expect(verified.value.sessionExpiresAt).toBeNull();
    expect(verified.value.expired).toBe(false);
  });

  test("revoking one device kills only its token and reports unknown ids as null", () => {
    const dir = path.join(tempDir(), "remote");
    const store = open(dir, manualClock());
    const a = added(store, "A");
    const b = added(store, "B");
    const [first] = store.list();
    if (first === undefined) throw new Error("no device");
    const revoked = store.revoke(first.id);
    expect(revoked).toEqual({ ok: true, value: first });
    expect(store.verify(a, "x")).toEqual({ ok: false, error: { kind: "unknown_token" } });
    expect(store.verify(b, "x").ok).toBe(true);
    expect(store.revoke("dev_0000000000000000")).toEqual({ ok: true, value: null });
    expect(devicesOf(path.join(dir, DEVICES_FILE))).toHaveLength(1);
  });

  test("revokeAll empties the table and the file", () => {
    const dir = path.join(tempDir(), "remote");
    const store = open(dir, manualClock());
    const a = added(store, "A");
    added(store, "B");
    const all = store.revokeAll();
    if (!all.ok) throw new Error("revokeAll failed");
    expect(all.value.map((device) => device.name)).toEqual(["A", "B"]);
    expect(store.list()).toEqual([]);
    expect(store.verify(a, "x").ok).toBe(false);
    expect(jsonOf(readFileSync(path.join(dir, DEVICES_FILE), "utf8"))).toEqual({
      version: 1,
      devices: [],
    });
  });

  test("last seen is written at most once a minute unless the address changes", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const store = open(dir, clock);
    const token = added(store, "A");
    const file = path.join(dir, DEVICES_FILE);
    const lastSeenOnDisk = (): number => numberField(devicesOf(file)[0], "lastSeenAt");
    const created = clock.now();

    clock.advance(LAST_SEEN_FLUSH_MS - 1);
    store.verify(token, "10.0.0.5");
    expect(lastSeenOnDisk()).toBe(created);

    clock.advance(1);
    store.verify(token, "10.0.0.5");
    expect(lastSeenOnDisk()).toBe(created + LAST_SEEN_FLUSH_MS);

    clock.advance(1000);
    store.verify(token, "192.168.0.2");
    expect(lastSeenOnDisk()).toBe(created + LAST_SEEN_FLUSH_MS + 1000);
    expect(ownField(devicesOf(file)[0], "lastAddress")).toBe("192.168.0.2");
  });

  test("a failed background write is reported, not thrown, and the verify still succeeds", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const background: FileError[] = [];
    const store = open(dir, clock, background);
    const token = added(store, "A");
    chmodSync(dir, 0o500);
    clock.advance(LAST_SEEN_FLUSH_MS);
    const verified = store.verify(token, "10.0.0.5");
    chmodSync(dir, 0o700);
    if (process.getuid?.() === 0) return;
    expect(verified.ok).toBe(true);
    expect(background.map((error) => [error.kind, error.op])).toEqual([["io", "write"]]);
  });

  test("a corrupt file is refused instead of being emptied", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    added(open(dir, clock), "A");
    const file = path.join(dir, DEVICES_FILE);
    const cases: Array<[string, string]> = [
      ["not json", "not_json"],
      ['{"version":2,"devices":[]}', "version"],
      ['{"version":1}', "devices"],
      ['{"version":1,"devices":[{"id":"dev_1"}]}', "device"],
    ];
    for (const [text, reason] of cases) {
      writeFileSync(file, text);
      const opened = openDeviceStore({ dir, clock, onBackgroundError: () => undefined });
      expect(opened).toEqual({ ok: false, error: { kind: "corrupt", path: file, reason } });
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });

  test("duplicate ids or hashes in the file are corrupt", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const store = open(dir, clock);
    added(store, "A");
    const file = path.join(dir, DEVICES_FILE);
    const first = devicesOf(file)[0];
    writeFileSync(file, JSON.stringify({ version: 1, devices: [first, first] }));
    const opened = openDeviceStore({ dir, clock, onBackgroundError: () => undefined });
    expect(opened.ok ? "ok" : opened.error.kind).toBe("corrupt");
  });
});
