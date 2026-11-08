import { afterEach, describe, expect, test } from "bun:test";
import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseJson } from "@fresnel/contracts";
import { createAuthPort } from "../../src/web/auth/auth-port.ts";
import {
  MAX_ENDPOINT_LENGTH,
  MAX_SUBSCRIPTIONS_PER_DEVICE,
  openPushSubscriptions,
  parsePushSubscription,
  PUSH_FILE,
  removePushOnRevoke,
  type PushSubscriptionRecord,
  type PushSubscriptions,
} from "../../src/web/auth/push.ts";
import {
  openVapid,
  VAPID_FILE,
  VAPID_MAX_TTL_SECONDS,
  type VapidKeyring,
  type VapidSignError,
} from "../../src/web/auth/vapid.ts";
import { cleanupTempDirs, manualClock, sequenceBytes, tempDir } from "./support/fixtures.ts";
import { recordingLogger } from "./support/logger.ts";

afterEach(cleanupTempDirs);

function jsonOf(text: string): unknown {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error("not JSON");
  return parsed.value;
}

function fields(text: string): Record<string, unknown> {
  const value = jsonOf(text);
  if (typeof value !== "object" || value === null) throw new Error("not an object");
  return Object.fromEntries(Object.entries(value));
}

function openKeyring(dir: string, clock = manualClock()): VapidKeyring {
  const opened = openVapid({ dir, clock });
  if (!opened.ok) throw new Error(`vapid did not open: ${opened.error.kind}`);
  return opened.value;
}

describe("VAPID keys", () => {
  test("the first open writes a 0600 file with an uncompressed P-256 public key", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const keyring = openKeyring(dir, clock);
    const point = Buffer.from(keyring.publicKey, "base64url");
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(0x04);
    expect(keyring.publicKey).toHaveLength(87);
    expect(keyring.createdAt).toBe(clock.now());

    const file = path.join(dir, VAPID_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const stored = fields(readFileSync(file, "utf8"));
    expect(stored["version"]).toBe(1);
    expect(stored["publicKey"]).toBe(keyring.publicKey);
    expect(stored["createdAt"]).toBe(clock.now());
    expect(typeof stored["privateKey"]).toBe("string");
  });

  test("reopening gives the same key and a different folder gives a different one", () => {
    const dir = path.join(tempDir(), "remote");
    const first = openKeyring(dir);
    const later = manualClock(Date.UTC(2027, 0, 1));
    const second = openKeyring(dir, later);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.createdAt).toBe(first.createdAt);
    expect(openKeyring(path.join(tempDir(), "remote")).publicKey).not.toBe(first.publicKey);
  });

  test("the JWT carries the endpoint origin, expiry and subject and verifies with the public key", () => {
    const clock = manualClock();
    const keyring = openKeyring(path.join(tempDir(), "remote"), clock);
    const jwt = keyring.signJwt({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc?x=1",
      subject: "mailto:admin@example.com",
      ttlSeconds: 43_200,
    });
    if (!jwt.ok) throw new Error("sign failed");
    const [header, claims, signature, ...rest] = jwt.value.split(".");
    expect(rest).toEqual([]);
    if (header === undefined || claims === undefined || signature === undefined) {
      throw new Error("not three parts");
    }
    expect(jsonOf(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    expect(jsonOf(Buffer.from(claims, "base64url").toString("utf8"))).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Math.floor(clock.now() / 1000) + 43_200,
      sub: "mailto:admin@example.com",
    });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);

    const point = Buffer.from(keyring.publicKey, "base64url");
    const publicKey = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(valid).toBe(true);
    const tampered = verify(
      "sha256",
      Buffer.from(`${header}.${claims}x`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(tampered).toBe(false);
  });

  test("the Authorization header is `vapid t=<jwt>, k=<public key>`", () => {
    const keyring = openKeyring(path.join(tempDir(), "remote"));
    const header = keyring.authorizationHeader({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc",
      subject: "https://example.com/contact",
      ttlSeconds: 3600,
    });
    if (!header.ok) throw new Error("header failed");
    expect(header.value).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/u);
    expect(header.value.endsWith(`, k=${keyring.publicKey}`)).toBe(true);
  });

  test("bad endpoint, subject or lifetime is refused; 24 hours is the maximum", () => {
    const keyring = openKeyring(path.join(tempDir(), "remote"));
    const good = {
      endpoint: "https://push.example.com/x",
      subject: "mailto:a@b.co",
      ttlSeconds: 60,
    };
    const kind = (input: Parameters<VapidKeyring["signJwt"]>[0]): string => {
      const result = keyring.signJwt(input);
      return result.ok ? "ok" : result.error.kind;
    };
    expect(kind(good)).toBe("ok");
    const refused: VapidSignError = { kind: "invalid_endpoint" };
    expect(keyring.signJwt({ ...good, endpoint: "http://push.example.com/x" })).toEqual({
      ok: false,
      error: refused,
    });
    expect(kind({ ...good, endpoint: "http://push.example.com/x" })).toBe("invalid_endpoint");
    expect(kind({ ...good, endpoint: "not a url" })).toBe("invalid_endpoint");
    expect(kind({ ...good, subject: "admin@example.com" })).toBe("invalid_subject");
    expect(kind({ ...good, subject: "http://example.com" })).toBe("invalid_subject");
    expect(kind({ ...good, ttlSeconds: 0 })).toBe("invalid_ttl");
    expect(kind({ ...good, ttlSeconds: 1.5 })).toBe("invalid_ttl");
    expect(kind({ ...good, ttlSeconds: VAPID_MAX_TTL_SECONDS })).toBe("ok");
    expect(kind({ ...good, ttlSeconds: VAPID_MAX_TTL_SECONDS + 1 })).toBe("invalid_ttl");
    expect(VAPID_MAX_TTL_SECONDS).toBe(86_400);
  });

  test("a damaged file is reported and not replaced, because new keys would drop every subscription", () => {
    const dir = path.join(tempDir(), "remote");
    openKeyring(dir);
    const file = path.join(dir, VAPID_FILE);
    const original = readFileSync(file, "utf8");
    const stored = fields(original);
    const donor = fields(readFileSync(openVapidDir(), "utf8"));
    const cases: Array<[string, string]> = [
      ["{ nope", "shape"],
      [JSON.stringify({ ...stored, version: 2 }), "shape"],
      [JSON.stringify({ ...stored, privateKey: 5 }), "fields"],
      [JSON.stringify({ ...stored, publicKey: "AAAA" }), "public_key"],
      [JSON.stringify({ ...stored, privateKey: "AAAA" }), "private_key"],
      [JSON.stringify({ ...stored, publicKey: donor["publicKey"] }), "key_mismatch"],
    ];
    for (const [text, reason] of cases) {
      writeFileSync(file, text);
      expect(openVapid({ dir, clock: manualClock() })).toEqual({
        ok: false,
        error: { kind: "corrupt", path: file, reason },
      });
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });
});

function openVapidDir(): string {
  const dir = path.join(tempDir(), "remote");
  openKeyring(dir);
  return path.join(dir, VAPID_FILE);
}

function browserSubscription(endpoint = "https://fcm.googleapis.com/fcm/send/abc"): {
  readonly endpoint: string;
  readonly expirationTime: null;
  readonly keys: { readonly p256dh: string; readonly auth: string };
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

describe("push subscription parsing", () => {
  test("accepts what PushSubscription.toJSON() produces", () => {
    const sub = browserSubscription();
    expect(parsePushSubscription(sub)).toEqual({
      ok: true,
      value: { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  });

  test("refuses endpoints that are not public https URLs", () => {
    const sub = browserSubscription();
    for (const endpoint of [
      "http://fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://192.168.1.5/x",
      "https://localhost/x",
      "https://app.localhost/x",
      "https://printer.local/x",
      "https://db.internal/x",
      "https://intranet/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://user@fcm.googleapis.com/x",
      "ftp://fcm.googleapis.com/x",
      "not a url",
      "",
      `https://fcm.googleapis.com/${"a".repeat(MAX_ENDPOINT_LENGTH)}`,
    ]) {
      expect(parsePushSubscription({ ...sub, endpoint })).toEqual({
        ok: false,
        error: { kind: "invalid_endpoint" },
      });
    }
    expect(parsePushSubscription({ keys: sub.keys })).toEqual({
      ok: false,
      error: { kind: "invalid_endpoint" },
    });
    expect(parsePushSubscription("x")).toEqual({ ok: false, error: { kind: "invalid_endpoint" } });
    expect(parsePushSubscription(null)).toEqual({ ok: false, error: { kind: "invalid_endpoint" } });
  });

  test("refuses keys of the wrong size, prefix or alphabet", () => {
    const sub = browserSubscription();
    const point = Buffer.from(sub.keys.p256dh, "base64url");
    const compressed = Buffer.concat([Buffer.of(0x02), point.subarray(1, 33)]).toString(
      "base64url",
    );
    const wrongPrefix = Buffer.concat([Buffer.of(0x05), point.subarray(1)]).toString("base64url");
    const invalid = { ok: false, error: { kind: "invalid_keys" } } as const;
    for (const keys of [
      { ...sub.keys, p256dh: compressed },
      { ...sub.keys, p256dh: wrongPrefix },
      { ...sub.keys, p256dh: `${sub.keys.p256dh}+` },
      { ...sub.keys, p256dh: 5 },
      { ...sub.keys, auth: randomBytes(15).toString("base64url") },
      { ...sub.keys, auth: randomBytes(17).toString("base64url") },
      { ...sub.keys, auth: "====" },
      { p256dh: sub.keys.p256dh },
      {},
      null,
    ]) {
      expect(parsePushSubscription({ endpoint: sub.endpoint, keys })).toEqual(invalid);
    }
    expect(parsePushSubscription({ endpoint: sub.endpoint })).toEqual(invalid);
  });
});

function openStore(dir: string, clock = manualClock()): PushSubscriptions {
  const opened = openPushSubscriptions({ dir, clock });
  if (!opened.ok) throw new Error(`push store did not open: ${opened.error.kind}`);
  return opened.value;
}

function input(endpoint: string): { endpoint: string; p256dh: string; auth: string } {
  const parsed = parsePushSubscription(browserSubscription(endpoint));
  if (!parsed.ok) throw new Error("subscription did not parse");
  return { ...parsed.value };
}

describe("push subscription store", () => {
  test("stores subscriptions per device in a 0600 file and survives reopening", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const store = openStore(dir, clock);
    const a = input("https://push.example.com/a");
    const expected: PushSubscriptionRecord = { ...a, deviceId: "dev_a", createdAt: clock.now() };
    expect(store.upsert("dev_a", a)).toEqual({ ok: true, value: expected });
    expect(statSync(path.join(dir, PUSH_FILE)).mode & 0o777).toBe(0o600);

    const reopened = openStore(dir, clock);
    expect(reopened.list()).toEqual([{ ...a, deviceId: "dev_a", createdAt: clock.now() }]);
    expect(reopened.listForDevice("dev_a")).toHaveLength(1);
    expect(reopened.listForDevice("dev_b")).toEqual([]);
  });

  test("the same endpoint is replaced and belongs to the newest device", () => {
    const store = openStore(path.join(tempDir(), "remote"));
    const first = input("https://push.example.com/a");
    store.upsert("dev_a", first);
    const again = { ...first, auth: input("https://push.example.com/x").auth };
    store.upsert("dev_b", again);
    expect(store.list().map((item) => [item.endpoint, item.deviceId, item.auth])).toEqual([
      [first.endpoint, "dev_b", again.auth],
    ]);
  });

  test("a device keeps at most ten subscriptions and the oldest go first", () => {
    const store = openStore(path.join(tempDir(), "remote"));
    const clock = manualClock();
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_DEVICE + 2; i += 1) {
      store.upsert("dev_a", input(`https://push.example.com/${i}`));
      clock.advance(1);
    }
    store.upsert("dev_b", input("https://push.example.com/other"));
    expect(store.listForDevice("dev_a").map((item) => item.endpoint)).toEqual(
      Array.from(
        { length: MAX_SUBSCRIPTIONS_PER_DEVICE },
        (_, i) => `https://push.example.com/${i + 2}`,
      ),
    );
    expect(store.listForDevice("dev_b")).toHaveLength(1);
    expect(MAX_SUBSCRIPTIONS_PER_DEVICE).toBe(10);
  });

  test("removeEndpoint and removeDevice report what they removed", () => {
    const store = openStore(path.join(tempDir(), "remote"));
    store.upsert("dev_a", input("https://push.example.com/1"));
    store.upsert("dev_a", input("https://push.example.com/2"));
    store.upsert("dev_b", input("https://push.example.com/3"));
    expect(store.removeEndpoint("https://push.example.com/nope")).toEqual({
      ok: true,
      value: false,
    });
    expect(store.removeEndpoint("https://push.example.com/1")).toEqual({ ok: true, value: true });
    expect(store.removeDevice("dev_a")).toEqual({ ok: true, value: 1 });
    expect(store.removeDevice("dev_a")).toEqual({ ok: true, value: 0 });
    expect(store.list().map((item) => item.deviceId)).toEqual(["dev_b"]);
  });

  test("a corrupt file is refused and left untouched", () => {
    const dir = path.join(tempDir(), "remote");
    const store = openStore(dir);
    store.upsert("dev_a", input("https://push.example.com/1"));
    const file = path.join(dir, PUSH_FILE);
    const good = readFileSync(file, "utf8");
    const record = fields(good);
    const list = record["subscriptions"];
    if (!Array.isArray(list)) throw new Error("no list");
    const withBad = JSON.stringify({
      version: 1,
      subscriptions: [{ ...fields(JSON.stringify(list[0])), endpoint: "http://x.example.com" }],
    });
    const cases: Array<[string, string]> = [
      ["nope", "shape"],
      ['{"version":2,"subscriptions":[]}', "shape"],
      ['{"version":1}', "shape"],
      [withBad, "subscription"],
    ];
    for (const [text, reason] of cases) {
      writeFileSync(file, text);
      expect(openPushSubscriptions({ dir, clock: manualClock() })).toEqual({
        ok: false,
        error: { kind: "corrupt", path: file, reason },
      });
      expect(readFileSync(file, "utf8")).toBe(text);
    }
  });

  test("revoking a device removes its subscriptions", () => {
    const dir = path.join(tempDir(), "remote");
    const clock = manualClock();
    const created = createAuthPort({
      dir,
      clock,
      logger: recordingLogger(),
      randomBytes: sequenceBytes(4),
    });
    if (!created.ok) throw new Error("auth did not open");
    const auth = created.value;
    const pair = (name: string): string => {
      const issued = auth.createPairingCode();
      const result = auth.redeemPairingCode({
        code: issued.code,
        deviceName: name,
        kind: "web",
        address: "a",
      });
      if (!result.ok) throw new Error("pair failed");
      return result.value.device.id;
    };
    const keep = pair("Keep");
    const drop = pair("Drop");
    const store = openStore(dir, clock);
    store.upsert(keep, input("https://push.example.com/keep"));
    store.upsert(drop, input("https://push.example.com/drop1"));
    store.upsert(drop, input("https://push.example.com/drop2"));

    const errors: string[] = [];
    const unbind = removePushOnRevoke(auth, store, (error) => errors.push(error.kind));
    auth.revokeDevice(drop);
    expect(store.list().map((item) => item.deviceId)).toEqual([keep]);
    expect(
      openStore(dir, clock)
        .list()
        .map((item) => item.deviceId),
    ).toEqual([keep]);

    unbind();
    auth.revokeAllDevices();
    expect(store.list().map((item) => item.deviceId)).toEqual([keep]);
    expect(errors).toEqual([]);
  });
});
