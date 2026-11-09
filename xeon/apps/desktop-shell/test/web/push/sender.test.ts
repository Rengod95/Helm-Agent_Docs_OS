import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { parseJson } from "@fresnel/contracts";
import {
  openPushSubscriptions,
  parsePushSubscription,
  type PushSubscriptions,
} from "../../../src/web/auth/push.ts";
import { openVapid, type VapidKeyring } from "../../../src/web/auth/vapid.ts";
import {
  createPushSender,
  DEFAULT_RETRY_AFTER_MS,
  PUSH_TITLE_MAX_CHARS,
  retryDelayMs,
  RETRY_AFTER_CAP_MS,
  type PushFetch,
  type PushSender,
} from "../../../src/web/push/sender.ts";
import { cleanupTempDirs, manualClock, tempDir } from "../support/fixtures.ts";
import { recordingLogger, type LogEntry } from "../support/logger.ts";
import { browserSubscription, decryptBody, type BrowserSubscription } from "./support/webpush.ts";

afterEach(cleanupTempDirs);

const SUBJECT = "mailto:admin@example.test";
const FIRST = "https://push.example.test/send/SECRET-TOKEN-AAA";
const SECOND = "https://push.example.test/send/SECRET-TOKEN-BBB";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** 가짜 푸시 서비스: 호출마다 `respond`가 응답(또는 네트워크 오류)을 정한다 */
function fakeFetch(respond: (call: Call, index: number) => Response | Error): {
  readonly fetch: PushFetch;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: PushFetch = async (url, init) => {
    const call: Call = { url, init };
    const index = calls.length;
    calls.push(call);
    const answer = respond(call, index);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: code, headers });
}

interface Fixture {
  readonly keyring: VapidKeyring;
  readonly store: PushSubscriptions;
  readonly dir: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly logs: LogEntry[];
}

function fixture(): Fixture {
  const dir = path.join(tempDir(), "remote");
  const clock = manualClock();
  const keyring = openVapid({ dir, clock });
  if (!keyring.ok) throw new Error("vapid did not open");
  const store = openPushSubscriptions({ dir, clock });
  if (!store.ok) throw new Error("store did not open");
  return { keyring: keyring.value, store: store.value, dir, clock, logs: [] };
}

function addSubscription(
  store: PushSubscriptions,
  deviceId: string,
  subscription: BrowserSubscription,
): void {
  const parsed = parsePushSubscription(subscription.body);
  if (!parsed.ok) throw new Error("subscription did not parse");
  const saved = store.upsert(deviceId, parsed.value);
  if (!saved.ok) throw new Error("upsert failed");
}

function senderFor(fx: Fixture, fetch: PushFetch, waits: number[] = []): PushSender {
  return createPushSender({
    keyring: fx.keyring,
    subscriptions: fx.store,
    fetch,
    subject: SUBJECT,
    clock: fx.clock,
    logger: recordingLogger(fx.logs),
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
}

function jsonOf(bytes: Uint8Array): unknown {
  const parsed = parseJson(new TextDecoder().decode(bytes));
  if (!parsed.ok) throw new Error("not JSON");
  return parsed.value;
}

describe("push sender: request shape", () => {
  test("every stored subscription gets the exact headers, and its body decrypts to the payload", async () => {
    const fx = fixture();
    const a = browserSubscription(FIRST);
    const b = browserSubscription(SECOND);
    addSubscription(fx.store, "dev_a", a);
    addSubscription(fx.store, "dev_b", b);
    const { fetch, calls } = fakeFetch(() => status(201));

    const report = await senderFor(fx, fetch).send({
      title: "Approval needed",
      threadId: "thread-7",
    });

    expect(report.delivered).toBe(2);
    expect(report.removed).toBe(0);
    expect(report.failed).toBe(0);
    expect(calls.map((call) => call.url).toSorted()).toEqual([FIRST, SECOND]);
    const byUrl = new Map(calls.map((call) => [call.url, call.init]));
    for (const [url, subscription] of [
      [FIRST, a],
      [SECOND, b],
    ] as const) {
      const init = byUrl.get(url);
      if (init === undefined) throw new Error(`no call to ${url}`);
      expect(init.method).toBe("POST");
      const headers = new Headers(init.headers);
      expect(headers.get("Content-Encoding")).toBe("aes128gcm");
      expect(headers.get("Content-Type")).toBe("application/octet-stream");
      expect(headers.get("TTL")).toBe("86400");
      expect(headers.get("Urgency")).toBe("normal");
      const authorization = headers.get("Authorization");
      expect(authorization).not.toBeNull();
      expect(authorization?.startsWith("vapid t=")).toBe(true);
      expect(authorization?.endsWith(`, k=${fx.keyring.publicKey}`)).toBe(true);
      const token = authorization?.slice("vapid t=".length, authorization.indexOf(", k="));
      const [, claims] = (token ?? "").split(".");
      const decoded = jsonOf(Buffer.from(claims ?? "", "base64url"));
      expect(decoded).toEqual({
        aud: "https://push.example.test",
        exp: Math.floor(fx.clock.now() / 1000) + 43_200,
        sub: SUBJECT,
      });
      if (!(init.body instanceof Uint8Array)) throw new Error("body is not bytes");
      const plain = decryptBody(init.body, subscription.ua, subscription.auth);
      if (plain === null) throw new Error("body did not decrypt");
      expect(jsonOf(plain)).toEqual({ title: "Approval needed", threadId: "thread-7" });
    }
  });

  test("the plaintext is exactly the title and threadId JSON, with threadId null when there is no thread", async () => {
    const fx = fixture();
    const sub = browserSubscription(FIRST);
    addSubscription(fx.store, "dev_a", sub);
    const { fetch, calls } = fakeFetch(() => status(200));
    await senderFor(fx, fetch).send({ title: "Done", threadId: null });
    const init = calls[0]?.init;
    if (init === undefined || !(init.body instanceof Uint8Array)) throw new Error("no body");
    const plain = decryptBody(init.body, sub.ua, sub.auth);
    expect(plain?.toString("utf8")).toBe(`{"title":"Done","threadId":null}`);
  });

  test("a title longer than 120 characters is cut by characters before encryption", async () => {
    const fx = fixture();
    const sub = browserSubscription(FIRST);
    addSubscription(fx.store, "dev_a", sub);
    const { fetch, calls } = fakeFetch(() => status(201));
    const longTitle = "😀".repeat(PUSH_TITLE_MAX_CHARS + 1);
    await senderFor(fx, fetch).send({ title: longTitle, threadId: "t" });
    const init = calls[0]?.init;
    if (init === undefined || !(init.body instanceof Uint8Array)) throw new Error("no body");
    const plain = decryptBody(init.body, sub.ua, sub.auth);
    expect(jsonOf(plain ?? new Uint8Array())).toEqual({
      title: "😀".repeat(PUSH_TITLE_MAX_CHARS),
      threadId: "t",
    });
  });

  test("a device id limits the send to that device's subscriptions", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    addSubscription(fx.store, "dev_b", browserSubscription(SECOND));
    const { fetch, calls } = fakeFetch(() => status(201));
    const report = await senderFor(fx, fetch).send(
      { title: "x", threadId: null },
      { deviceId: "dev_b" },
    );
    expect(calls.map((call) => call.url)).toEqual([SECOND]);
    expect(report.attempts.map((item) => [item.deviceId, item.outcome])).toEqual([
      ["dev_b", "delivered"],
    ]);
  });
});

describe("push sender: responses", () => {
  test("410 deletes the subscription from the store file and reports it removed", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    addSubscription(fx.store, "dev_a", browserSubscription(SECOND));
    const { fetch } = fakeFetch((call) => (call.url === FIRST ? status(410) : status(201)));

    const report = await senderFor(fx, fetch).send({ title: "x", threadId: null });

    expect(report.removed).toBe(1);
    expect(report.delivered).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.attempts).toContainEqual({
      deviceId: "dev_a",
      host: "push.example.test",
      outcome: "removed",
      status: 410,
    });
    const reopened = openPushSubscriptions({ dir: fx.dir, clock: fx.clock });
    if (!reopened.ok) throw new Error("store did not reopen");
    expect(reopened.value.list().map((item) => item.endpoint)).toEqual([SECOND]);
    expect(readFileSync(path.join(fx.dir, "push-subscriptions.json"), "utf8")).not.toContain(
      "SECRET-TOKEN-AAA",
    );
  });

  test("404 also deletes the subscription", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    const { fetch } = fakeFetch(() => status(404));
    const report = await senderFor(fx, fetch).send({ title: "x", threadId: null });
    expect(report.removed).toBe(1);
    expect(fx.store.list()).toEqual([]);
  });

  test("429 waits for Retry-After, retries once with the same body, and then succeeds", async () => {
    const fx = fixture();
    const sub = browserSubscription(FIRST);
    addSubscription(fx.store, "dev_a", sub);
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch((_call, index) =>
      index === 0 ? status(429, { "Retry-After": "2" }) : status(201),
    );

    const report = await senderFor(fx, fetch, waits).send({ title: "x", threadId: null });

    expect(waits).toEqual([2000]);
    expect(calls).toHaveLength(2);
    expect(report.delivered).toBe(1);
    expect(report.failed).toBe(0);
    expect(fx.store.list()).toHaveLength(1);
    const [firstBody, secondBody] = calls.map((call) => call.init.body);
    if (!(firstBody instanceof Uint8Array) || !(secondBody instanceof Uint8Array)) {
      throw new Error("no body");
    }
    expect(Buffer.from(secondBody).equals(Buffer.from(firstBody))).toBe(true);
    expect(decryptBody(secondBody, sub.ua, sub.auth)?.toString("utf8")).toBe(
      `{"title":"x","threadId":null}`,
    );
  });

  test("500 twice gives up after one retry, reports the failure, and keeps the subscription", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch(() => status(500));

    const report = await senderFor(fx, fetch, waits).send({ title: "x", threadId: null });

    expect(calls).toHaveLength(2);
    expect(waits).toEqual([DEFAULT_RETRY_AFTER_MS]);
    expect(report.delivered).toBe(0);
    expect(report.removed).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.attempts).toEqual([
      { deviceId: "dev_a", host: "push.example.test", outcome: "gave_up", status: 500 },
    ]);
    expect(fx.store.list()).toHaveLength(1);
  });

  test("a Retry-After longer than 30 seconds is capped", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    const waits: number[] = [];
    const { fetch } = fakeFetch((_call, index) =>
      index === 0 ? status(503, { "Retry-After": "3600" }) : status(200),
    );
    await senderFor(fx, fetch, waits).send({ title: "x", threadId: null });
    expect(waits).toEqual([RETRY_AFTER_CAP_MS]);
  });

  test("other 4xx responses are reported as rejected, without a retry and without deleting anything", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    const waits: number[] = [];
    const { fetch, calls } = fakeFetch(() => status(400));
    const report = await senderFor(fx, fetch, waits).send({ title: "x", threadId: null });
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(report.attempts).toEqual([
      { deviceId: "dev_a", host: "push.example.test", outcome: "rejected", status: 400 },
    ]);
    expect(fx.store.list()).toHaveLength(1);
  });

  test("a network error is reported as network_failed and keeps the subscription", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    const { fetch, calls } = fakeFetch(() => new TypeError("socket hang up"));
    const report = await senderFor(fx, fetch).send({ title: "x", threadId: null });
    expect(calls).toHaveLength(1);
    expect(report.attempts).toEqual([
      { deviceId: "dev_a", host: "push.example.test", outcome: "network_failed", status: null },
    ]);
    expect(fx.store.list()).toHaveLength(1);
  });

  test("each request carries an abort signal for the 10 second timeout", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    const { fetch, calls } = fakeFetch(() => status(201));
    await senderFor(fx, fetch).send({ title: "x", threadId: null });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.signal?.aborted).toBe(false);
  });
});

describe("push sender: logging", () => {
  test("logs only the endpoint host and the status, never the token, the payload or the header", async () => {
    const fx = fixture();
    addSubscription(fx.store, "dev_a", browserSubscription(FIRST));
    addSubscription(fx.store, "dev_b", browserSubscription(SECOND));
    const { fetch } = fakeFetch((call) =>
      call.url === FIRST ? status(429, { "Retry-After": "1" }) : status(410),
    );

    await senderFor(fx, fetch).send({ title: "SECRET-TITLE-WORDS", threadId: "thread-secret" });

    const text = JSON.stringify(fx.logs);
    expect(text).not.toContain("SECRET-TOKEN");
    expect(text).not.toContain("SECRET-TITLE");
    expect(text).not.toContain("thread-secret");
    expect(text).not.toContain("vapid t=");
    expect(text).not.toContain("/send/");
    expect(fx.logs.length).toBeGreaterThan(0);
    for (const entry of fx.logs) {
      expect(Object.keys(entry.fields).every((key) => ["host", "status", "op"].includes(key))).toBe(
        true,
      );
      expect(entry.fields["host"]).toBe("push.example.test");
    }
    expect(fx.logs.map((entry) => entry.event).toSorted()).toEqual(
      ["push.gave_up", "push.removed", "push.retry_scheduled"].toSorted(),
    );
  });
});

describe("retryDelayMs", () => {
  test("seconds, HTTP dates, the cap, and the default for missing or unreadable values", () => {
    const now = Date.UTC(2026, 10, 8, 0, 0, 0);
    expect(retryDelayMs(null, now)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(retryDelayMs("5", now)).toBe(5000);
    expect(retryDelayMs(" 0 ", now)).toBe(0);
    expect(retryDelayMs("999999", now)).toBe(RETRY_AFTER_CAP_MS);
    expect(retryDelayMs(new Date(now + 7000).toUTCString(), now)).toBe(7000);
    expect(retryDelayMs(new Date(now - 7000).toUTCString(), now)).toBe(0);
    expect(retryDelayMs("soon", now)).toBe(DEFAULT_RETRY_AFTER_MS);
  });
});
