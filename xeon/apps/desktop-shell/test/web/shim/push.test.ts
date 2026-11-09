import { describe, expect, test } from "bun:test";
import {
  createPushRunner,
  enablePush,
  PUSH_SUBSCRIBE_PATH,
  SERVICE_WORKER_PATH,
  VAPID_KEY_PATH,
} from "../../../src/web/shim/push.ts";
import type {
  ShimPushManager,
  ShimPushSubscription,
  ShimServiceWorkers,
} from "../../../src/web/shim/env.ts";
import { deferred, fakeFetch, settled } from "./support.ts";

type SubscribeOptions = Parameters<ShimPushManager["subscribe"]>[0];

/** P-256 비압축 점 모양의 공개 키(0x04로 시작하고 65바이트)를 base64url로 */
function publicKeyText(length = 65): string {
  const key = new Uint8Array(length);
  key[0] = 4;
  return Buffer.from(key).toString("base64url");
}

const SUBSCRIPTION_JSON = {
  endpoint: "https://push.example.net/abc",
  keys: { p256dh: "AAAA", auth: "BBBB" },
};

function fakeWorkers(options: { readonly registerFails?: boolean } = {}): {
  readonly workers: ShimServiceWorkers;
  readonly registered: string[];
  readonly subscribed: SubscribeOptions[];
} {
  const registered: string[] = [];
  const subscribed: SubscribeOptions[] = [];
  const subscription: ShimPushSubscription = {
    toJSON: () => SUBSCRIPTION_JSON,
  };
  const manager: ShimPushManager = {
    subscribe: (subscribeOptions) => {
      subscribed.push(subscribeOptions);
      return Promise.resolve(subscription);
    },
  };
  const workers: ShimServiceWorkers = {
    register: (url) => {
      registered.push(url);
      return options.registerFails === true
        ? Promise.reject(new Error("refused"))
        : Promise.resolve();
    },
    activePushManager: () => Promise.resolve(manager),
  };
  return { workers, registered, subscribed };
}

describe("web push registration", () => {
  test("an insecure context registers nothing and fetches nothing", async () => {
    const { workers, registered } = fakeWorkers();
    const http = fakeFetch();
    expect(
      await settled(
        enablePush({ isSecureContext: false, serviceWorkers: workers, fetch: http.fetch }),
      ),
    ).toEqual({ ok: false, error: { kind: "insecure" } });
    expect(registered).toEqual([]);
    expect(http.calls).toEqual([]);
  });

  test("without service workers the push is unsupported", async () => {
    const http = fakeFetch();
    expect(
      await settled(
        enablePush({ isSecureContext: true, serviceWorkers: undefined, fetch: http.fetch }),
      ),
    ).toEqual({ ok: false, error: { kind: "unsupported" } });
    expect(http.calls).toEqual([]);
  });

  test("registers /sw.js, subscribes with the server key, and posts the subscription", async () => {
    const { workers, registered, subscribed } = fakeWorkers();
    const http = fakeFetch({
      [VAPID_KEY_PATH]: { ok: true, body: { publicKey: publicKeyText() } },
      [PUSH_SUBSCRIBE_PATH]: { ok: true, body: null },
    });
    expect(
      await settled(
        enablePush({ isSecureContext: true, serviceWorkers: workers, fetch: http.fetch }),
      ),
    ).toEqual({ ok: true, value: null });
    expect(registered).toEqual([SERVICE_WORKER_PATH]);
    expect(subscribed.length).toBe(1);
    expect(subscribed[0]?.userVisibleOnly).toBe(true);
    expect(subscribed[0]?.applicationServerKey.byteLength).toBe(65);
    expect(subscribed[0]?.applicationServerKey[0]).toBe(4);
    expect(http.calls).toEqual([
      { url: VAPID_KEY_PATH, init: { credentials: "include" } },
      {
        url: PUSH_SUBSCRIBE_PATH,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(SUBSCRIPTION_JSON),
          credentials: "include",
        },
      },
    ]);
  });

  test("a public key of the wrong length is refused as vapid-key, and nothing is posted", async () => {
    const { workers } = fakeWorkers();
    const http = fakeFetch({
      [VAPID_KEY_PATH]: { ok: true, body: { publicKey: publicKeyText(64) } },
    });
    expect(
      await settled(
        enablePush({ isSecureContext: true, serviceWorkers: workers, fetch: http.fetch }),
      ),
    ).toEqual({ ok: false, error: { kind: "vapid-key" } });
    expect(http.calls.map((call) => call.url)).toEqual([VAPID_KEY_PATH]);
  });

  test("a refused registration is reported as register", async () => {
    const { workers } = fakeWorkers({ registerFails: true });
    const http = fakeFetch();
    expect(
      await settled(
        enablePush({ isSecureContext: true, serviceWorkers: workers, fetch: http.fetch }),
      ),
    ).toEqual({ ok: false, error: { kind: "register" } });
    expect(http.calls).toEqual([]);
  });

  test("a subscription the server does not accept is reported as store", async () => {
    const { workers } = fakeWorkers();
    const http = fakeFetch({
      [VAPID_KEY_PATH]: { ok: true, body: { publicKey: publicKeyText() } },
      [PUSH_SUBSCRIBE_PATH]: { ok: false, body: null },
    });
    expect(
      await settled(
        enablePush({ isSecureContext: true, serviceWorkers: workers, fetch: http.fetch }),
      ),
    ).toEqual({ ok: false, error: { kind: "store" } });
  });

  test("the runner starts once per page and reports a failure without throwing", async () => {
    const { workers, registered } = fakeWorkers();
    const http = fakeFetch({ [VAPID_KEY_PATH]: { ok: false, body: null } });
    const reported = deferred<string>();
    const run = createPushRunner({
      isSecureContext: true,
      serviceWorkers: workers,
      fetch: http.fetch,
      report: (code) => {
        reported.resolve(code);
      },
    });
    run();
    run();
    expect(await reported.promise).toBe("push-failed");
    expect(registered).toEqual([SERVICE_WORKER_PATH]);
    expect(http.calls.map((call) => call.url)).toEqual([VAPID_KEY_PATH]);
  });

  test("the runner does nothing without a secure context or service workers", () => {
    const { workers } = fakeWorkers();
    const reports: string[] = [];
    const http = fakeFetch();
    const report = (code: string): void => {
      reports.push(code);
    };
    createPushRunner({
      isSecureContext: false,
      serviceWorkers: workers,
      fetch: http.fetch,
      report,
    })();
    createPushRunner({
      isSecureContext: true,
      serviceWorkers: undefined,
      fetch: http.fetch,
      report,
    })();
    expect(http.calls).toEqual([]);
    expect(reports).toEqual([]);
  });
});
