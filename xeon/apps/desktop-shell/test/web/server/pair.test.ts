import { describe, expect, test } from "bun:test";
import { parsePairRequest } from "../../../src/web/server/pair.ts";
import { contentTypeOf, pathSegments } from "../../../src/web/server/static.ts";

describe("POST /pair body (strict)", () => {
  test("the three fields of the right types are accepted as they are", () => {
    expect(
      parsePairRequest('{"code":"ABCDE-12345","deviceName":"Pixel","kind":"desktop"}'),
    ).toEqual({ ok: true, value: { code: "ABCDE-12345", deviceName: "Pixel", kind: "desktop" } });
  });

  test("an extra key, a missing key or a wrong type is invalid_body", () => {
    for (const body of [
      '{"code":"A","deviceName":"B","kind":"web","extra":1}',
      '{"code":"A","deviceName":"B"}',
      '{"code":1,"deviceName":"B","kind":"web"}',
      '{"code":"A","deviceName":null,"kind":"web"}',
      '{"code":"A","deviceName":"B","kind":"tablet"}',
      '{"code":"","deviceName":"B","kind":"web"}',
      '["code"]',
      "null",
      "not json",
    ]) {
      expect(parsePairRequest(body)).toEqual({ ok: false, error: { kind: "invalid_body" } });
    }
  });

  test("a code longer than 64 characters or a name longer than 256 is refused", () => {
    const longCode = JSON.stringify({ code: "A".repeat(65), deviceName: "B", kind: "web" });
    const longName = JSON.stringify({ code: "A", deviceName: "B".repeat(257), kind: "web" });
    expect(parsePairRequest(longCode)).toEqual({ ok: false, error: { kind: "invalid_body" } });
    expect(parsePairRequest(longName)).toEqual({ ok: false, error: { kind: "invalid_body" } });
  });
});

describe("request paths", () => {
  test("a plain path becomes its segments", () => {
    expect(pathSegments("/assets/app.js")).toEqual(["assets", "app.js"]);
  });

  test("traversal, dot segments, dotfiles, empty segments, backslashes and NUL are refused", () => {
    for (const path of [
      "/../etc/passwd",
      "/%2e%2e/%2e%2e/etc/passwd",
      "/..%2fsecret",
      "/assets/../x",
      "/.hidden",
      "/assets/.env",
      "//etc",
      "/assets//app.js",
      "/assets/",
      "/assets\\app.js",
      "/assets/%00",
      "/%E0%A4%A",
      "relative",
    ]) {
      expect(pathSegments(path)).toBeNull();
    }
  });

  test("the content type comes from the extension and defaults to octet-stream", () => {
    expect(contentTypeOf("/x/app.JS")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeOf("a.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeOf("a.wasm")).toBe("application/wasm");
    expect(contentTypeOf("a.unknownext")).toBe("application/octet-stream");
  });
});
