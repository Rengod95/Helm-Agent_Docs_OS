import { afterEach, describe, expect, test } from "bun:test";
import { connect as tlsConnect } from "node:tls";
import { appCsp, loginCsp } from "../../../src/web/server/csp.ts";
import {
  cleanupTempDirs,
  type Harness,
  httpsRaw,
  INDEX_WITH_SHIM,
  jsonOf,
  LOGIN_HTML,
  settle,
  startHarness,
  tlsHandshake,
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

function tlsPortOf(h: Harness): number {
  return h.tlsPort ?? 0;
}

/** TLS 리스너에 붙는 Host(허용 목록은 `localhost`) */
function tlsHost(h: Harness): string {
  return `localhost:${String(tlsPortOf(h))}`;
}

function tlsOrigin(h: Harness): string {
  return `https://${tlsHost(h)}`;
}

/** TLS 위에서 WebSocket 업그레이드를 보내고 상태 줄만 받는다. 101이면 소켓을 닫는다 */
function tlsUpgradeStatus(
  port: number,
  headers: Readonly<Record<string, string>>,
  route: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: "127.0.0.1",
      port,
      servername: "localhost",
      rejectUnauthorized: false,
    });
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      const lines = [
        `GET ${route} HTTP/1.1`,
        `Host: localhost:${String(port)}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    let head = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n");
      if (end < 0) return;
      socket.destroy();
      resolve(head.subarray(0, end).toString("latin1"));
    });
  });
}

describe("TLS listener (spec §8.2)", () => {
  test("the listener negotiates TLS 1.3, presents the pinned fingerprint and serves the login page", async () => {
    const h = await harness({ tls: true });
    expect(h.tlsPort).toBeGreaterThan(0);
    const res = await httpsRaw({
      port: tlsPortOf(h),
      path: "/login",
      headers: { host: tlsHost(h) },
    });
    expect(res.status).toBe(200);
    expect(res.protocol).toBe("TLSv1.3");
    expect(res.fingerprint).toBe(h.tlsMaterial?.fingerprint ?? null);
    expect(res.body).toBe(LOGIN_HTML);
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(res.headers["content-security-policy"]).toBe(loginCsp({ tls: true, host: tlsHost(h) }));
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("a TLS 1.2-only client is refused by the protocol version alert, and a TLS 1.3 client connects", async () => {
    const h = await harness({ tls: true });
    const old = await tlsHandshake(tlsPortOf(h), { max: "TLSv1.2" });
    expect(old.protocol).toBeNull();
    expect(old.errorCode).toBe("ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION");
    const modern = await tlsHandshake(tlsPortOf(h), { min: "TLSv1.3" });
    expect(modern).toEqual({ protocol: "TLSv1.3", errorCode: null });
  });

  test("the TLS listener refuses Hosts outside its list, including the loopback address", async () => {
    const h = await harness({ tls: true });
    const hosts = [`127.0.0.1:${String(tlsPortOf(h))}`, "evil.example.com"];
    const results = await Promise.all(
      hosts.map((host) => httpsRaw({ port: tlsPortOf(h), path: "/login", headers: { host } })),
    );
    for (const res of results) {
      expect(res.status).toBe(421);
      expect(jsonOf(res.body)).toEqual({ error: "host_not_allowed" });
    }
  });

  test("pairing over TLS sets the __Host- cookie and the cookie without the prefix does not sign in", async () => {
    const h = await harness({ tls: true });
    const issued = h.auth.createPairingCode();
    const origin = tlsOrigin(h);
    const paired = await httpsRaw({
      port: tlsPortOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: tlsHost(h), origin, "content-type": "application/json" },
      body: JSON.stringify({ code: issued.code, deviceName: "Secure", kind: "web" }),
    });
    expect(paired.status).toBe(200);
    const setCookie = paired.headers["set-cookie"];
    const line = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(line).toMatch(
      /^__Host-fresnel-device=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict; Secure$/u,
    );
    const pair = line?.split(";")[0] ?? "";
    const value = pair.slice("__Host-fresnel-device=".length);

    const signedIn = await httpsRaw({
      port: tlsPortOf(h),
      path: "/",
      headers: { host: tlsHost(h), cookie: pair },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toBe(INDEX_WITH_SHIM);
    expect(signedIn.headers["content-security-policy"]).toBe(
      appCsp({ tls: true, host: tlsHost(h) }),
    );
    expect(signedIn.headers["content-security-policy"]).toContain(
      `connect-src 'self' wss://${tlsHost(h)}`,
    );

    const plainName = await httpsRaw({
      port: tlsPortOf(h),
      path: "/",
      headers: { host: tlsHost(h), cookie: `fresnel-device=${value}` },
    });
    expect(plainName.status).toBe(302);
    expect(plainName.headers.location).toBe("/login");
  });

  test("an Origin with the wrong scheme is refused on the TLS listener", async () => {
    const h = await harness({ tls: true });
    const issued = h.auth.createPairingCode();
    const res = await httpsRaw({
      port: tlsPortOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: tlsHost(h), origin: `http://${tlsHost(h)}` },
      body: JSON.stringify({ code: issued.code, deviceName: "Scheme", kind: "web" }),
    });
    expect(res.status).toBe(403);
    expect(jsonOf(res.body)).toEqual({ error: "origin_mismatch" });
  });

  test("a WebSocket upgrade over TLS with a desktop token opens the service connection", async () => {
    const h = await harness({ tls: true });
    const issued = h.auth.createPairingCode();
    const paired = await httpsRaw({
      port: tlsPortOf(h),
      method: "POST",
      path: "/pair",
      headers: { host: tlsHost(h), origin: tlsOrigin(h) },
      body: JSON.stringify({ code: issued.code, deviceName: "TlsDesktop", kind: "desktop" }),
    });
    const body = jsonOf(paired.body);
    const token = typeof body === "object" && body !== null && "token" in body ? body.token : null;
    if (typeof token !== "string") throw new Error("no token");

    const status = await tlsUpgradeStatus(
      tlsPortOf(h),
      { origin: tlsOrigin(h), authorization: `Bearer ${token}` },
      "/wire",
    );
    expect(status).toContain("101");
    await settle();
    expect(h.service.sides.length).toBe(1);

    const refused = await tlsUpgradeStatus(tlsPortOf(h), { origin: tlsOrigin(h) }, "/wire");
    expect(refused).toContain("401");
    expect(h.service.sides.length).toBe(1);
  });

  test("the TLS listener alone is a valid gateway: no loopback port is reported", async () => {
    const h = await harness({ tls: true, loopback: false });
    expect(h.loopbackPort).toBeNull();
    expect(h.tlsPort).toBeGreaterThan(0);
    expect(h.startError).toBeNull();
  });
});

describe("start failures", () => {
  test("with neither listener the start is refused", async () => {
    const h = await harness({ loopback: false, expectStartError: true });
    expect(h.startError).toEqual({ kind: "no_listener" });
  });
});
