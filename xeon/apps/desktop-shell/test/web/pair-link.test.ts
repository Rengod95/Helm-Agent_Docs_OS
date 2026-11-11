import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pairLinkOf, pairingCodeFromHash } from "../../src/web/static/pair-link.ts";

describe("pair link", () => {
  test("the code travels in the URL fragment, not the query, and reads back", () => {
    const link = pairLinkOf("https://my-mac.tail1234.ts.net:8443", "ABCDE12345");
    expect(link).toBe("https://my-mac.tail1234.ts.net:8443/login#code=ABCDE12345");
    expect(new URL(link ?? "").search).toBe("");
    expect(pairingCodeFromHash(new URL(link ?? "").hash)).toBe("ABCDE12345");
  });

  test("a base that is not a URL gives no link", () => {
    expect(pairLinkOf("my-mac", "ABCDE12345")).toBeNull();
  });

  test("hash reading accepts a missing or empty code as null and trims spaces", () => {
    expect(pairingCodeFromHash("")).toBeNull();
    expect(pairingCodeFromHash("#other=1")).toBeNull();
    expect(pairingCodeFromHash("#code=")).toBeNull();
    expect(pairingCodeFromHash("#code=%20ABCDE12345%20")).toBe("ABCDE12345");
    expect(pairingCodeFromHash(`#code=${"A".repeat(65)}`)).toBeNull();
  });
});

describe("web manifest", () => {
  test("installs as a standalone app rooted at /", () => {
    const file = path.join(import.meta.dir, "../../../desktop/public/brand/site.webmanifest");
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    expect(manifest).toMatchObject({
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#101216",
      background_color: "#101216",
    });
  });
});
