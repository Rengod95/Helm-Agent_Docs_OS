import { afterEach, describe, expect, test } from "bun:test";
import { err } from "@fresnel/contracts";
import { appCsp, loginCsp } from "../../../src/web/server/csp.ts";
import {
  cleanupTempDirs,
  deviceNamed,
  type Harness,
  INDEX_WITH_SHIM,
  inOrder,
  jsonOf,
  LOGIN_HTML,
  LOGIN_TEXT,
  PUSH_KEY,
  pairWeb,
  rawHttp,
  type RawResponse,
  SHIM_TEXT,
  settle,
  startHarness,
  SW_TEXT,
} from "./support.ts";

const harnesses: Harness[] = [];

async function harness(options: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  const started = await startHarness(options);
  harnesses.push(started);
  return started;
}

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((item) => item.stop()));
  cleanupTempDirs();
});

const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
} as const;

function expectSecurityHeaders(res: RawResponse): void {
  for (const [name, value] of Object.entries(SECURITY)) {
    expect(res.headers[name]).toBe(value);
  }
  expect(Object.keys(res.headers).filter((key) => key.startsWith("access-control-"))).toEqual([]);
}

function hostOf(h: Harness): string {
  return `127.0.0.1:${String(h.loopbackPort ?? 0)}`;
}

function portOf(h: Harness): number {
  return h.loopbackPort ?? 0;
}

describe("login page and generated assets", () => {
  test("GET /login is the static page with the login policy and no authentication", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), path: "/login" });
    expect(res.status).toBe(200);
    expect(res.body).toBe(LOGIN_HTML);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-security-policy"]).toBe(loginCsp({ tls: false, host: hostOf(h) }));
    expect(res.headers["cache-control"]).toBe("no-cache");
    expectSecurityHeaders(res);
  });

  test("login.css comes from the static folder; login.js is the bundle built at start", async () => {
    const h = await harness();
    const css = await rawHttp({ port: portOf(h), path: "/login.css" });
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    const js = await rawHttp({ port: portOf(h), path: "/login.js" });
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(js.body).toBe(LOGIN_TEXT);
  });

  test("the real login.ts bundle is an iife that names the pairing route", async () => {
    const h = await harness({ realLogin: true });
    const js = await rawHttp({ port: portOf(h), path: "/login.js" });
    expect(js.status).toBe(200);
    expect(js.body).toContain("/pair");
    expect(js.body).toContain("pair-form");
    expect(js.body).not.toContain("import ");
    expect(js.body).not.toContain("<script");
  });

  test("a login script that fails to build stops the start with source_unavailable", async () => {
    const h = await harness({
      expectStartError: true,
      loginSource: () => Promise.resolve(err({ kind: "build_failed", messages: ["boom"] })),
    });
    expect(h.startError).toEqual({
      kind: "source_unavailable",
      source: "login",
      cause: { kind: "build_failed", messages: ["boom"] },
    });
    expect(h.loopbackPort).toBeNull();
  });

  test("/sw.js is the injected source with the service worker scope header, never read from disk", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), path: "/sw.js" });
    expect(res.status).toBe(200);
    expect(res.body).toBe(SW_TEXT);
    expect(res.headers["service-worker-allowed"]).toBe("/");
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  });

  test("/shell/shim.js is the shim source without authentication", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), path: "/shell/shim.js" });
    expect(res.status).toBe(200);
    expect(res.body).toBe(SHIM_TEXT);
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });
});

describe("pairing (POST /pair)", () => {
  test("a web pairing sets the device cookie and never puts the token in the body", async () => {
    const h = await harness();
    const issued = h.auth.createPairingCode();
    const res = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin, "content-type": "application/json" },
      body: JSON.stringify({ code: issued.code, deviceName: "Tablet", kind: "web" }),
    });
    expect(res.status).toBe(200);
    const device = deviceNamed(h, "Tablet");
    expect(device?.kind).toBe("web");
    expect(jsonOf(res.body)).toEqual({ ok: true, device: { id: device?.id, name: "Tablet" } });
    const setCookie = res.headers["set-cookie"];
    const line = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(line).toMatch(
      /^fresnel-device=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/u,
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    expectSecurityHeaders(res);
  });

  test("the cookie lifetime is the 12-hour sliding session", async () => {
    const h = await harness();
    const issued = h.auth.createPairingCode();
    const res = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: issued.code, deviceName: "Lifetime", kind: "web" }),
    });
    const line = res.headers["set-cookie"];
    const first = Array.isArray(line) ? line[0] : line;
    expect(first).toContain(`Max-Age=${String(12 * 3600)}`);
  });

  test("a desktop pairing returns the token in the body and sets no cookie", async () => {
    const h = await harness();
    const issued = h.auth.createPairingCode();
    const res = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: issued.code, deviceName: "Workstation", kind: "desktop" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const body = jsonOf(res.body);
    const token = typeof body === "object" && body !== null && "token" in body ? body.token : null;
    expect(typeof token === "string" && token.length === 43).toBe(true);
    expect(deviceNamed(h, "Workstation")?.kind).toBe("desktop");
  });

  test("a wrong code is invalid_code and the fifth failure locks with Retry-After", async () => {
    const h = await harness();
    h.auth.createPairingCode();
    const attempt = () =>
      rawHttp({
        port: portOf(h),
        method: "POST",
        path: "/pair",
        headers: { host: hostOf(h), origin: h.origin },
        body: JSON.stringify({ code: "ZZZZZZZZZZ", deviceName: "Nope", kind: "web" }),
      });
    // 실패는 순서대로 센다: 앞의 넷은 401, 다섯째에서 잠긴다
    const failures = await inOrder([1, 2, 3, 4], () => attempt());
    for (const res of failures) {
      expect(res.status).toBe(401);
      expect(jsonOf(res.body)).toEqual({ error: "invalid_code" });
    }
    const locked = await attempt();
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBe("900");
    expect(jsonOf(locked.body)).toEqual({ error: "locked" });
    // 잠금 중에는 맞는 코드도 거절된다
    const issued = h.auth.createPairingCode();
    const during = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: issued.code, deviceName: "Late", kind: "web" }),
    });
    expect(during.status).toBe(429);
  });

  test("a device name the auth port refuses is 400 and does not use up the code", async () => {
    const h = await harness();
    const issued = h.auth.createPairingCode();
    const bad = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: issued.code, deviceName: "   ", kind: "web" }),
    });
    expect(bad.status).toBe(400);
    expect(jsonOf(bad.body)).toEqual({ error: "invalid_device_name" });
    const good = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: issued.code, deviceName: "Fine", kind: "web" }),
    });
    expect(good.status).toBe(200);
  });

  test("a body with an extra key, a wrong type or invalid JSON is 400 invalid_body", async () => {
    const h = await harness();
    const bodies = [
      '{"code":"A","deviceName":"B","kind":"web","extra":true}',
      '{"code":7,"deviceName":"B","kind":"web"}',
      "{not json",
    ];
    const results = await Promise.all(
      bodies.map((body) =>
        rawHttp({
          port: portOf(h),
          method: "POST",
          path: "/pair",
          headers: { host: hostOf(h), origin: h.origin },
          body,
        }),
      ),
    );
    for (const res of results) {
      expect(res.status).toBe(400);
      expect(jsonOf(res.body)).toEqual({ error: "invalid_body" });
    }
  });

  test("a body over 4 KiB is 413 and is not parsed", async () => {
    const h = await harness();
    const res = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: "A".repeat(5000), deviceName: "B", kind: "web" }),
    });
    expect(res.status).toBe(413);
    expect(jsonOf(res.body)).toEqual({ error: "body_too_large" });
  });

  test("a missing Origin is 403, a foreign Origin is 403", async () => {
    const h = await harness();
    const issued = h.auth.createPairingCode();
    const body = JSON.stringify({ code: issued.code, deviceName: "X", kind: "web" });
    const none = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h) },
      body,
    });
    expect(none.status).toBe(403);
    expect(jsonOf(none.body)).toEqual({ error: "origin_missing" });
    const foreign = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: "http://evil.example.com" },
      body,
    });
    expect(foreign.status).toBe(403);
    expect(jsonOf(foreign.body)).toEqual({ error: "origin_mismatch" });
    // 코드는 쓰이지 않았다
    expect(h.auth.pairingStatus().active).toBe(true);
  });

  test("a Host outside the loopback names is 421 before anything else", async () => {
    const h = await harness();
    const res = await rawHttp({
      port: portOf(h),
      path: "/login",
      headers: { host: "evil.example.com" },
    });
    expect(res.status).toBe(421);
    expect(jsonOf(res.body)).toEqual({ error: "host_not_allowed" });
  });

  test("a storage failure is 500 store_failed with no details", async () => {
    const h = await harness({
      auth: (real) => ({
        ...real,
        redeemPairingCode: () =>
          err({ kind: "io", op: "write", path: "/secret/devices.json", cause: new Error("disk") }),
      }),
    });
    const issued = h.auth.createPairingCode();
    const res = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify({ code: issued.code, deviceName: "X", kind: "web" }),
    });
    expect(res.status).toBe(500);
    expect(res.body).toBe('{"error":"store_failed"}');
    expect(res.body).not.toContain("secret");
  });
});

describe("app document (/, /index.html)", () => {
  test("without a cookie the document redirects to /login", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), path: "/" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
    expect(res.body).toBe("");
    expectSecurityHeaders(res);
  });

  test("a garbage or doubled cookie does not count as signed in", async () => {
    const h = await harness();
    const garbage = await rawHttp({
      port: portOf(h),
      path: "/",
      headers: { cookie: `fresnel-device=${"A".repeat(43)}` },
    });
    expect(garbage.status).toBe(302);
    const paired = await pairWeb(h, h.origin, "Doubled");
    const doubled = await rawHttp({
      port: portOf(h),
      path: "/",
      headers: { cookie: `${paired.cookie}; ${paired.cookie}` },
    });
    expect(doubled.status).toBe(302);
  });

  test("with the cookie the document is the bundle with the shim tag as the first head element", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Browser");
    const res = await rawHttp({ port: portOf(h), path: "/", headers: { cookie: paired.cookie } });
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX_WITH_SHIM);
    expect(res.body.split('<script src="/shell/shim.js"></script>').length - 1).toBe(1);
    expect(res.headers["content-security-policy"]).toBe(appCsp({ tls: false, host: hostOf(h) }));
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expectSecurityHeaders(res);
  });

  test("/index.html and HEAD / behave like / (HEAD sends no body)", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Browser2");
    const page = await rawHttp({
      port: portOf(h),
      path: "/index.html",
      headers: { cookie: paired.cookie },
    });
    expect(page.body).toBe(INDEX_WITH_SHIM);
    const head = await rawHttp({
      port: portOf(h),
      method: "HEAD",
      path: "/",
      headers: { cookie: paired.cookie },
    });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });
});

describe("session, logout", () => {
  test("GET /api/session is 401 without a cookie and the device with one", async () => {
    const h = await harness();
    const anonymous = await rawHttp({ port: portOf(h), path: "/api/session" });
    expect(anonymous.status).toBe(401);
    expect(jsonOf(anonymous.body)).toEqual({ error: "unauthenticated" });
    const paired = await pairWeb(h, h.origin, "Session");
    const res = await rawHttp({
      port: portOf(h),
      path: "/api/session",
      headers: { cookie: paired.cookie },
    });
    expect(res.status).toBe(200);
    expect(jsonOf(res.body)).toEqual({
      device: { id: paired.deviceId, name: "Session", kind: "web" },
    });
  });

  test("logout clears the cookie and does not revoke: the old cookie still works server-side", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Logout");
    const anonymous = await rawHttp({ port: portOf(h), method: "POST", path: "/logout" });
    expect(anonymous.status).toBe(403);
    const res = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/logout",
      headers: { origin: h.origin, cookie: paired.cookie },
    });
    expect(res.status).toBe(200);
    const cleared = res.headers["set-cookie"];
    const line = Array.isArray(cleared) ? cleared[0] : cleared;
    expect(line).toBe("fresnel-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
    expect(deviceNamed(h, "Logout")?.id).toBe(paired.deviceId);
    const stillValid = await rawHttp({
      port: portOf(h),
      path: "/api/session",
      headers: { cookie: paired.cookie },
    });
    expect(stillValid.status).toBe(200);
  });
});

describe("push endpoints", () => {
  test("the VAPID key needs authentication and is 404 when push is off", async () => {
    const h = await harness();
    const anonymous = await rawHttp({ port: portOf(h), path: "/push/vapid-key" });
    expect(anonymous.status).toBe(401);
    const paired = await pairWeb(h, h.origin, "Push");
    const res = await rawHttp({
      port: portOf(h),
      path: "/push/vapid-key",
      headers: { cookie: paired.cookie },
    });
    expect(res.status).toBe(200);
    expect(jsonOf(res.body)).toEqual({ publicKey: PUSH_KEY });

    const off = await harness({ push: false });
    const offPaired = await pairWeb(off, off.origin, "PushOff");
    const none = await rawHttp({
      port: portOf(off),
      path: "/push/vapid-key",
      headers: { cookie: offPaired.cookie },
    });
    expect(none.status).toBe(404);
    const subscribe = await rawHttp({
      port: portOf(off),
      method: "POST",
      path: "/push/subscribe",
      headers: { host: hostOf(off), origin: off.origin, cookie: offPaired.cookie },
      body: "{}",
    });
    expect(subscribe.status).toBe(404);
  });

  test("subscribe is authenticated, Origin-checked, bounded and hands the body to the push port", async () => {
    const h = await harness();
    const subscription = {
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "x", auth: "y" },
    };
    const anonymous = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/push/subscribe",
      headers: { host: hostOf(h), origin: h.origin },
      body: JSON.stringify(subscription),
    });
    expect(anonymous.status).toBe(401);
    expect(h.push.calls).toEqual([]);

    const paired = await pairWeb(h, h.origin, "Subscriber");
    const noOrigin = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/push/subscribe",
      headers: { host: hostOf(h), cookie: paired.cookie },
      body: JSON.stringify(subscription),
    });
    expect(noOrigin.status).toBe(403);

    const ok = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/push/subscribe",
      headers: { host: hostOf(h), origin: h.origin, cookie: paired.cookie },
      body: JSON.stringify(subscription),
    });
    expect(ok.status).toBe(200);
    expect(h.push.calls).toEqual([{ deviceId: paired.deviceId, body: subscription }]);

    const huge = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/push/subscribe",
      headers: { host: hostOf(h), origin: h.origin, cookie: paired.cookie },
      body: JSON.stringify({ endpoint: "https://x.example.com/" + "a".repeat(9000) }),
    });
    expect(huge.status).toBe(413);
    expect(h.push.calls.length).toBe(1);
  });

  test("the push port's refusals map to 400 with the kind and a storage failure to 500", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Refused");
    const post = (body: string) =>
      rawHttp({
        port: portOf(h),
        method: "POST",
        path: "/push/subscribe",
        headers: { host: hostOf(h), origin: h.origin, cookie: paired.cookie },
        body,
      });
    h.push.state.failWith = { kind: "invalid_endpoint" };
    const endpoint = await post("{}");
    expect(endpoint.status).toBe(400);
    expect(jsonOf(endpoint.body)).toEqual({ error: "invalid_endpoint" });
    h.push.state.failWith = { kind: "store_failed" };
    const store = await post("{}");
    expect(store.status).toBe(500);
    expect(jsonOf(store.body)).toEqual({ error: "store_failed" });
    h.push.state.failWith = null;
    const notJson = await post("{nope");
    expect(notJson.status).toBe(400);
    expect(jsonOf(notJson.body)).toEqual({ error: "invalid_body" });
  });
});

describe("routing and static files", () => {
  test("a UI file is served with its type, an ETag and no-cache, and a repeat with the ETag is 304", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), path: "/assets/app.js" });
    expect(res.status).toBe(200);
    expect(res.body).toBe('export const app = "fresnel";\n');
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache");
    const etag = res.headers.etag;
    expect(typeof etag === "string" && etag.startsWith('W/"')).toBe(true);
    const again = await rawHttp({
      port: portOf(h),
      path: "/assets/app.js",
      headers: { "if-none-match": String(etag) },
    });
    expect(again.status).toBe(304);
    expect(again.body).toBe("");
    const css = await rawHttp({ port: portOf(h), path: "/assets/app.css" });
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
  });

  test("HEAD on a UI file returns the length and no body", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), method: "HEAD", path: "/assets/app.js" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
    expect(res.headers["content-length"]).toBe(
      String(Buffer.byteLength('export const app = "fresnel";\n')),
    );
  });

  test("traversal, dotfiles, symlinks out of the root, empty segments and NUL are 404", async () => {
    const h = await harness();
    const paths = [
      "/../../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2f..%2fetc%2fpasswd",
      "/assets/../../outside.txt",
      "//",
      "//assets/app.js",
      "/assets//app.js",
      "/.hidden",
      "/assets/.env",
      "/leak.txt",
      "/assets/%00",
      "/assets/app.js%00",
      "/assets/",
      "/%E0%A4%A",
      "/view/abc/ext/1/index.html",
      "/nope",
    ];
    const results = await Promise.all(
      paths.map(async (requestPath) => ({
        requestPath,
        res: await rawHttp({ port: portOf(h), path: requestPath }),
      })),
    );
    for (const { requestPath, res } of results) {
      expect({ path: requestPath, status: res.status }).toEqual({ path: requestPath, status: 404 });
      expect(res.body).not.toContain("secret");
      expect(res.body).not.toContain("outside the ui");
      expect(res.body).not.toContain("TOKEN=");
    }
  });

  test("a /view path is 404 for every method (W7 adds the frame route)", async () => {
    const h = await harness();
    const get = await rawHttp({ port: portOf(h), path: "/view/tok/ext/1/a.js" });
    expect(get.status).toBe(404);
    const post = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/view/tok/ext/1/a.js",
      headers: { origin: h.origin },
    });
    expect(post.status).toBe(404);
  });

  test("unsupported methods are 405 with an Allow header", async () => {
    const h = await harness();
    // PUT은 상태를 바꾸는 방법이라 Origin 검사를 먼저 받는다(없으면 403)
    const bare = await rawHttp({ port: portOf(h), method: "PUT", path: "/login" });
    expect(bare.status).toBe(403);
    const put = await rawHttp({
      port: portOf(h),
      method: "PUT",
      path: "/login",
      headers: { origin: h.origin },
    });
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET, HEAD");
    const postStatic = await rawHttp({
      port: portOf(h),
      method: "POST",
      path: "/login.css",
      headers: { origin: h.origin },
    });
    expect(postStatic.status).toBe(405);
    const getPair = await rawHttp({ port: portOf(h), path: "/pair" });
    expect(getPair.status).toBe(405);
    expect(getPair.headers.allow).toBe("POST");
  });

  test("a GET on a socket route without an upgrade is 426", async () => {
    const h = await harness();
    const res = await rawHttp({ port: portOf(h), path: "/wire" });
    expect(res.status).toBe(426);
    expect(res.headers.upgrade).toBe("websocket");
  });
});

describe("headers on every response", () => {
  test("the security headers are present and no CORS header is ever sent (loopback)", async () => {
    const h = await harness();
    const paired = await pairWeb(h, h.origin, "Headers");
    const cases: {
      readonly path: string;
      readonly method?: string;
      readonly headers?: Record<string, string>;
    }[] = [
      { path: "/login" },
      { path: "/login.css" },
      { path: "/login.js" },
      { path: "/sw.js" },
      { path: "/shell/shim.js" },
      { path: "/" },
      { path: "/", headers: { cookie: paired.cookie } },
      { path: "/api/session" },
      { path: "/push/vapid-key" },
      { path: "/nope" },
      { path: "/pair", method: "POST" },
    ];
    const results = await Promise.all(
      cases.map(async (item) => ({
        item,
        res: await rawHttp({
          port: portOf(h),
          path: item.path,
          method: item.method ?? "GET",
          headers: { host: hostOf(h), origin: h.origin, ...item.headers },
        }),
      })),
    );
    for (const { item, res } of results) {
      expect({ path: item.path, status: res.status > 0 }).toEqual({
        path: item.path,
        status: true,
      });
      expectSecurityHeaders(res);
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    }
  });
});

describe("gateway lifecycle", () => {
  test("a second start is refused and stop is idempotent", async () => {
    const h = await harness();
    const again = await h.gateway.start();
    expect(again).toEqual({ ok: false, error: { kind: "already_started" } });
    await h.gateway.stop();
    await h.gateway.stop();
  });

  test("HTTP-only requests never open a service connection", async () => {
    const h = await harness();
    await rawHttp({ port: portOf(h), path: "/login" });
    await rawHttp({ port: portOf(h), path: "/api/session" });
    await settle();
    expect(h.service.sides.length).toBe(0);
  });
});
