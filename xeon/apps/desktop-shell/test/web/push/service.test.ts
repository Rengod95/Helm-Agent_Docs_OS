import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { err, ok } from "@fresnel/contracts";
import {
  MAX_ENDPOINT_LENGTH,
  openPushSubscriptions,
  type PushSubscriptionRecord,
  type PushSubscriptions,
} from "../../../src/web/auth/push.ts";
import { openVapid } from "../../../src/web/auth/vapid.ts";
import { createPushService } from "../../../src/web/push/service.ts";
import { cleanupTempDirs, manualClock, tempDir } from "../support/fixtures.ts";
import { browserSubscription } from "./support/webpush.ts";

afterEach(cleanupTempDirs);

function setup() {
  const dir = path.join(tempDir(), "remote");
  const clock = manualClock();
  const keyring = openVapid({ dir, clock });
  if (!keyring.ok) throw new Error("vapid did not open");
  const store = openPushSubscriptions({ dir, clock });
  if (!store.ok) throw new Error("store did not open");
  const service = createPushService({ keyring: keyring.value, subscriptions: store.value });
  return { service, keyring: keyring.value, store: store.value };
}

describe("push service", () => {
  test("gives the VAPID public key as applicationServerKey", () => {
    const { service, keyring } = setup();
    expect(service.vapidPublicKey()).toBe(keyring.publicKey);
    expect(Buffer.from(service.vapidPublicKey(), "base64url")).toHaveLength(65);
  });

  test("a valid browser subscription is stored for the device", () => {
    const { service, store } = setup();
    const sub = browserSubscription("https://push.example.test/send/one");
    expect(service.subscribe("dev_a", sub.body)).toEqual({ ok: true, value: null });
    const stored: readonly PushSubscriptionRecord[] = store.listForDevice("dev_a");
    expect(stored.map((item) => [item.endpoint, item.p256dh, item.auth, item.deviceId])).toEqual([
      [sub.body.endpoint, sub.body.keys.p256dh, sub.body.keys.auth, "dev_a"],
    ]);
  });

  test("invalid endpoints are refused and nothing is stored", () => {
    const { service, store } = setup();
    const base = browserSubscription("https://push.example.test/send/one");
    const endpoints = [
      "http://push.example.test/send/one",
      "https://203.0.113.9/send/one",
      "https://[2001:db8::1]/send/one",
      "https://localhost/send/one",
      "https://relay.local/send/one",
      "https://user:pw@push.example.test/send/one",
      "https://intranet/send/one",
      `https://push.example.test/${"a".repeat(MAX_ENDPOINT_LENGTH)}`,
      "not a url",
    ];
    for (const endpoint of endpoints) {
      expect(service.subscribe("dev_a", { ...base.body, endpoint })).toEqual({
        ok: false,
        error: { kind: "invalid_endpoint" },
      });
    }
    expect(service.subscribe("dev_a", "not an object")).toEqual({
      ok: false,
      error: { kind: "invalid_endpoint" },
    });
    expect(store.list()).toEqual([]);
  });

  test("invalid keys are refused and nothing is stored", () => {
    const { service, store } = setup();
    const base = browserSubscription("https://push.example.test/send/one");
    const point = Buffer.from(base.body.keys.p256dh, "base64url");
    const compressed = Buffer.concat([Buffer.of(0x02), point.subarray(1, 33)]).toString(
      "base64url",
    );
    const bad = [
      { p256dh: compressed, auth: base.body.keys.auth },
      { p256dh: base.body.keys.p256dh, auth: "AAAA" },
      { p256dh: `${base.body.keys.p256dh}+`, auth: base.body.keys.auth },
      { p256dh: 5, auth: base.body.keys.auth },
    ];
    for (const keys of bad) {
      expect(service.subscribe("dev_a", { ...base.body, keys })).toEqual({
        ok: false,
        error: { kind: "invalid_keys" },
      });
    }
    expect(store.list()).toEqual([]);
  });

  test("a store that cannot write gives store_failed, not the file error", () => {
    const { keyring } = setup();
    const failing: PushSubscriptions = {
      upsert: () => err({ kind: "io", op: "write", path: "/x/push.json", cause: "EACCES" }),
      removeEndpoint: () => ok(false),
      removeDevice: () => ok(0),
      list: () => [],
      listForDevice: () => [],
    };
    const service = createPushService({ keyring, subscriptions: failing });
    const sub = browserSubscription("https://push.example.test/send/one");
    expect(service.subscribe("dev_a", sub.body)).toEqual({
      ok: false,
      error: { kind: "store_failed" },
    });
  });
});
