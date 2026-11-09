import { describe, expect, test } from "bun:test";
import {
  clearDeviceCookie,
  deviceTokenOf,
  isTokenShape,
  parseCookies,
  PLAIN_COOKIE_NAME,
  SECURE_COOKIE_NAME,
  serializeDeviceCookie,
} from "../../src/web/auth/cookies.ts";
import { securityHeaders } from "../../src/web/auth/headers.ts";
import { checkHost, checkOrigin, splitHost } from "../../src/web/auth/origin.ts";

const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);

describe("cookies", () => {
  test("the HTTPS cookie is __Host- prefixed, HttpOnly, Secure and SameSite=Strict", () => {
    expect(serializeDeviceCookie(TOKEN, { secure: true, maxAgeSeconds: 43_200 })).toBe(
      `__Host-fresnel-device=${TOKEN}; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure`,
    );
    expect(SECURE_COOKIE_NAME).toBe("__Host-fresnel-device");
  });

  test("the loopback HTTP cookie drops Secure and the prefix", () => {
    expect(serializeDeviceCookie(TOKEN, { secure: false, maxAgeSeconds: 100.9 })).toBe(
      `fresnel-device=${TOKEN}; Path=/; Max-Age=100; HttpOnly; SameSite=Strict`,
    );
    expect(PLAIN_COOKIE_NAME).toBe("fresnel-device");
  });

  test("a negative lifetime is clamped to zero and clearing expires the cookie", () => {
    expect(serializeDeviceCookie(TOKEN, { secure: true, maxAgeSeconds: -5 })).toContain(
      "Max-Age=0;",
    );
    expect(clearDeviceCookie(true)).toBe(
      "__Host-fresnel-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure",
    );
    expect(clearDeviceCookie(false)).toBe(
      "fresnel-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict",
    );
  });

  test("parseCookies keeps repeated names", () => {
    const parsed = parseCookies("a=1; b=2;c=3; a=4; =x; novalue");
    expect([...parsed.entries()]).toEqual([
      ["a", ["1", "4"]],
      ["b", ["2"]],
      ["c", ["3"]],
    ]);
    expect(parseCookies(null).size).toBe(0);
  });

  test("the token comes from the cookie of this listener's name only", () => {
    const secureHeader = { cookie: `${SECURE_COOKIE_NAME}=${TOKEN}`, authorization: null };
    expect(deviceTokenOf(secureHeader, true)).toBe(TOKEN);
    expect(deviceTokenOf(secureHeader, false)).toBeNull();
    const plainHeader = { cookie: `${PLAIN_COOKIE_NAME}=${TOKEN}`, authorization: null };
    expect(deviceTokenOf(plainHeader, false)).toBe(TOKEN);
    // HTTPS 리스너는 평문 이름의 쿠키를 받지 않는다(다른 HTTP 출처가 심을 수 있다)
    expect(deviceTokenOf(plainHeader, true)).toBeNull();
  });

  test("two cookies of the same name are refused", () => {
    const header = {
      cookie: `${SECURE_COOKIE_NAME}=${TOKEN}; ${SECURE_COOKIE_NAME}=${OTHER}`,
      authorization: null,
    };
    expect(deviceTokenOf(header, true)).toBeNull();
  });

  test("Authorization Bearer wins over a cookie and a bad Bearer does not fall back to it", () => {
    expect(
      deviceTokenOf(
        { cookie: `${SECURE_COOKIE_NAME}=${TOKEN}`, authorization: `Bearer ${OTHER}` },
        true,
      ),
    ).toBe(OTHER);
    expect(
      deviceTokenOf(
        { cookie: `${SECURE_COOKIE_NAME}=${TOKEN}`, authorization: "Bearer nope" },
        true,
      ),
    ).toBeNull();
    expect(deviceTokenOf({ cookie: null, authorization: `Basic ${TOKEN}` }, true)).toBeNull();
    expect(deviceTokenOf({ cookie: null, authorization: null }, true)).toBeNull();
  });

  test("token shape is 43 base64url characters", () => {
    expect(isTokenShape(TOKEN)).toBe(true);
    expect(isTokenShape(`${"A".repeat(42)}-`)).toBe(true);
    expect(isTokenShape("A".repeat(42))).toBe(false);
    expect(isTokenShape("A".repeat(44))).toBe(false);
    expect(isTokenShape(`${"A".repeat(42)}=`)).toBe(false);
    expect(isTokenShape(`${"A".repeat(42)};`)).toBe(false);
  });
});

describe("Host header", () => {
  const external = {
    loopback: false,
    allowedHosts: ["Fresnel.Example.com", "192.168.1.5", "[fe80::1]"],
  };

  test("splits names, ports and bracketed IPv6", () => {
    expect(splitHost("example.com")).toEqual({ hostname: "example.com", port: null });
    expect(splitHost("Example.com:8443")).toEqual({ hostname: "example.com", port: "8443" });
    expect(splitHost("[::1]:8480")).toEqual({ hostname: "::1", port: "8480" });
    expect(splitHost("[::1]")).toEqual({ hostname: "::1", port: null });
    for (const bad of ["", "a b", "a/b", "a@b", "a:b", "a:123456", "[::1", "a?b", ":80"]) {
      expect(splitHost(bad)).toBeNull();
    }
  });

  test("an external listener allows only the configured names (case-insensitive)", () => {
    expect(checkHost({ ...external, host: "fresnel.example.com:8443" }).ok).toBe(true);
    expect(checkHost({ ...external, host: "FRESNEL.EXAMPLE.COM" }).ok).toBe(true);
    expect(checkHost({ ...external, host: "192.168.1.5:8443" }).ok).toBe(true);
    expect(checkHost({ ...external, host: "[fe80::1]:8443" }).ok).toBe(true);
    for (const host of [
      "evil.example.com",
      "fresnel.example.com.evil.com",
      "localhost",
      "192.168.1.6",
      null,
    ]) {
      expect(checkHost({ ...external, host })).toEqual({
        ok: false,
        error: { kind: "host_not_allowed", status: 421 },
      });
    }
  });

  test("a loopback listener allows only localhost, 127.0.0.1 and [::1]", () => {
    const loopback = { loopback: true, allowedHosts: ["fresnel.example.com"] };
    for (const host of ["localhost:8480", "127.0.0.1:8480", "[::1]:8480", "LOCALHOST"]) {
      expect(checkHost({ ...loopback, host }).ok).toBe(true);
    }
    // DNS rebinding: 공격자 이름이 127.0.0.1로 풀려도 Host가 달라 421이다
    for (const host of [
      "evil.example.com:8480",
      "fresnel.example.com",
      "127.0.0.2:8480",
      "0.0.0.0:8480",
    ]) {
      expect(checkHost({ ...loopback, host }).ok).toBe(false);
    }
  });

  test("the port must match the listener when the header carries one", () => {
    const loopback = { loopback: true, allowedHosts: [], port: 8480 };
    expect(checkHost({ ...loopback, host: "localhost:8480" }).ok).toBe(true);
    expect(checkHost({ ...loopback, host: "localhost" }).ok).toBe(true);
    expect(checkHost({ ...loopback, host: "localhost:9999" }).ok).toBe(false);
  });
});

describe("Origin header", () => {
  const https = { host: "fresnel.example.com:8443", scheme: "https" } as const;

  test("same scheme, host and port passes", () => {
    expect(
      checkOrigin({ ...https, origin: "https://fresnel.example.com:8443", stateChanging: true }),
    ).toEqual({
      ok: true,
      value: null,
    });
    expect(
      checkOrigin({ ...https, origin: "https://FRESNEL.example.com:8443", stateChanging: true }).ok,
    ).toBe(true);
  });

  test("a different host, port or scheme is origin_mismatch", () => {
    for (const origin of [
      "https://evil.example.com:8443",
      "https://fresnel.example.com:8444",
      "https://fresnel.example.com",
      "http://fresnel.example.com:8443",
      "https://fresnel.example.com:8443.evil.com",
      "https://fresnel.example.com:8443/path",
      "https://user@fresnel.example.com:8443",
      "null",
      "",
      "chrome-extension://abc",
    ]) {
      expect(checkOrigin({ ...https, origin, stateChanging: true })).toEqual({
        ok: false,
        error: { kind: "origin_mismatch", status: 403 },
      });
    }
  });

  test("default ports match when one side omits them", () => {
    expect(
      checkOrigin({
        host: "a.example.com",
        scheme: "https",
        origin: "https://a.example.com:443",
        stateChanging: true,
      }).ok,
    ).toBe(true);
    expect(
      checkOrigin({
        host: "localhost:80",
        scheme: "http",
        origin: "http://localhost",
        stateChanging: true,
      }).ok,
    ).toBe(true);
  });

  test("a missing Origin is refused for state-changing requests and allowed for a plain GET", () => {
    expect(checkOrigin({ ...https, origin: null, stateChanging: true })).toEqual({
      ok: false,
      error: { kind: "origin_missing", status: 403 },
    });
    expect(checkOrigin({ ...https, origin: null, stateChanging: false })).toEqual({
      ok: true,
      value: null,
    });
  });

  test("a loopback HTTP listener compares the http scheme", () => {
    const http = { host: "localhost:8480", scheme: "http" } as const;
    expect(checkOrigin({ ...http, origin: "http://localhost:8480", stateChanging: true }).ok).toBe(
      true,
    );
    expect(checkOrigin({ ...http, origin: "https://localhost:8480", stateChanging: true }).ok).toBe(
      false,
    );
    expect(checkOrigin({ ...http, origin: "http://127.0.0.1:8480", stateChanging: true }).ok).toBe(
      false,
    );
  });

  test("an unparseable Host header never matches", () => {
    expect(
      checkOrigin({ host: "a b", scheme: "https", origin: "https://a", stateChanging: true }).ok,
    ).toBe(false);
  });
});

describe("security headers", () => {
  test("HTTPS adds HSTS to the common set and sends no CORS header", () => {
    const common = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    expect(securityHeaders({ tls: false })).toEqual(common);
    expect(securityHeaders({ tls: true })).toEqual({
      ...common,
      "Strict-Transport-Security": "max-age=31536000",
    });
  });
});
