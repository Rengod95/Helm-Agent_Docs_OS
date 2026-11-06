import { describe, expect, test } from "bun:test";
import { MAX_HREF_BYTES, isAllowedHref, openExternalModule } from "../src/main/open-external.ts";
import { fakeCtx } from "./support/fake-ctx.ts";

describe("href allow-list", () => {
  test("allows plain http and https", () => {
    expect(isAllowedHref("https://example.com/a?b=1#c")).toBe(true);
    expect(isAllowedHref("http://example.com")).toBe(true);
  });

  test("rejects other schemes, credentials and unsafe characters", () => {
    for (const bad of [
      "",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "mailto:a@b.c",
      "https://user:pw@example.com/",
      "https://user@example.com/",
      "https:///nohost",
      "https://example.com/a b",
      "https://example.com/\n",
      "ftp://example.com/",
      "HTTPS://example.com/",
      "https://example.com/ x",
      "https://example.com/\u0085x",
    ]) {
      expect(isAllowedHref(bad)).toBe(false);
    }
  });

  test("the length limit counts UTF-8 bytes and is inclusive", () => {
    const prefix = "https://e.com/";
    const atLimit = `${prefix}${"a".repeat(MAX_HREF_BYTES - prefix.length)}`;
    expect(new TextEncoder().encode(atLimit).byteLength).toBe(MAX_HREF_BYTES);
    expect(isAllowedHref(atLimit)).toBe(true);
    expect(isAllowedHref(`${atLimit}a`)).toBe(false);
    expect(isAllowedHref(`https://e.com/${"가".repeat(700)}`)).toBe(false);
  });
});

describe("open_external command", () => {
  test("opens an allowed link through ctx.openExternal", async () => {
    const fake = fakeCtx();
    openExternalModule.register(fake.ctx);
    expect(await fake.call("open_external", { href: "https://example.com/a?b=1#c" })).toEqual({
      ok: true,
      value: null,
    });
    expect(fake.opened).toEqual(["https://example.com/a?b=1#c"]);
  });

  test("rejects a disallowed link with href_not_allowed and opens nothing", async () => {
    const fake = fakeCtx();
    openExternalModule.register(fake.ctx);
    expect(await fake.call("open_external", { href: "mailto:a@b.c" })).toEqual({
      ok: false,
      error: "href_not_allowed",
    });
    expect(await fake.call("open_external", { href: 5 })).toEqual({
      ok: false,
      error: "href_not_allowed",
    });
    expect(await fake.call("open_external", null)).toEqual({
      ok: false,
      error: "href_not_allowed",
    });
    expect(fake.opened).toEqual([]);
  });

  test("an OS open failure gives open_failed", async () => {
    const fake = fakeCtx();
    const failing = {
      ...fake.ctx,
      openExternal: async (): Promise<void> => {
        throw new Error("no browser at /Applications/x");
      },
    };
    openExternalModule.register(failing);
    expect(await fake.call("open_external", { href: "https://example.com" })).toEqual({
      ok: false,
      error: "open_failed",
    });
  });
});
