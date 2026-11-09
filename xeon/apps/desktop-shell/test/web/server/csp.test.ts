import { describe, expect, test } from "bun:test";
import { appCsp, loginCsp } from "../../../src/web/server/csp.ts";
import { injectShim, SHIM_TAG } from "../../../src/web/server/routes.ts";

describe("CSP strings (spec §8.7)", () => {
  test("the app document policy over HTTPS is exactly the spec string with the request host", () => {
    expect(appCsp({ tls: true, host: "fresnel.example.com:8443" })).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self' wss://fresnel.example.com:8443; " +
        "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; " +
        "object-src 'none'",
    );
  });

  test("the loopback policy uses ws:// with the host and keeps every other directive", () => {
    expect(appCsp({ tls: false, host: "localhost:8480" })).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self' ws://localhost:8480; " +
        "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; " +
        "object-src 'none'",
    );
  });

  test("the login page policy is the app policy without frame-src", () => {
    const app = appCsp({ tls: true, host: "fresnel.example.com:8443" });
    const login = loginCsp({ tls: true, host: "fresnel.example.com:8443" });
    expect(login).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; connect-src 'self' wss://fresnel.example.com:8443; " +
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
    );
    expect(app.replace("frame-src 'self'; ", "")).toBe(login);
  });

  test("neither policy allows inline scripts", () => {
    for (const csp of [
      appCsp({ tls: true, host: "a.example" }),
      loginCsp({ tls: false, host: "localhost" }),
    ]) {
      expect(csp).toContain("script-src 'self';");
      // style-src의 'unsafe-inline'은 스펙이 허용한 것이고, 스크립트 쪽에는 없어야 한다
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).not.toContain("script-src 'unsafe-inline'");
      expect(csp).not.toContain("nonce-");
    }
  });
});

describe("shim tag injection", () => {
  test("the tag becomes the first element inside <head>", () => {
    expect(injectShim('<!doctype html><html><head><meta charset="utf-8"></head></html>')).toBe(
      `<!doctype html><html><head>${SHIM_TAG}<meta charset="utf-8"></head></html>`,
    );
  });

  test("a head tag with attributes is matched, a header element is not", () => {
    expect(injectShim('<html><head lang="en">x</head>')).toBe(
      `<html><head lang="en">${SHIM_TAG}x</head>`,
    );
    expect(injectShim("<html><header>x</header></html>")).toBeNull();
  });

  test("a document without a head element is refused", () => {
    expect(injectShim("<html><body></body></html>")).toBeNull();
  });

  test("the tag references a file and carries no inline code", () => {
    expect(SHIM_TAG).toBe('<script src="/shell/shim.js"></script>');
  });
});
