import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "../src/contract/url.ts";

function norm(raw: string): string {
  const result = normalizeUrl(raw);
  if (!result.ok) throw new Error(`unexpected invalid url ${raw}`);
  return result.value;
}

describe("normalizeUrl", () => {
  test("lowercases scheme and host, drops default port and fragment", () => {
    expect(norm("HTTPS://Example.COM:443/Path#frag")).toBe("https://example.com/Path");
    expect(norm("http://example.com:80/a")).toBe("http://example.com/a");
    expect(norm("http://example.com:8080/a")).toBe("http://example.com:8080/a");
    expect(norm("https://example.com")).toBe("https://example.com/");
  });

  test("converts IDN hosts to punycode and drops a trailing dot", () => {
    expect(norm("https://bücher.example/")).toBe("https://xn--bcher-kva.example/");
    expect(norm("https://example.com./a")).toBe("https://example.com/a");
    expect(norm("https://example.com.:8443/a")).toBe("https://example.com:8443/a");
  });

  test("removes tracking parameters and sorts the rest by name", () => {
    expect(
      norm("https://example.com/p?b=2&utm_source=x&a=1&gclid=9&UTM_Medium=m&fbclid=1&c=3"),
    ).toBe("https://example.com/p?a=1&b=2&c=3");
    expect(norm("https://example.com/p?utm_source=x")).toBe("https://example.com/p");
  });

  test("keeps the original order of a repeated name", () => {
    expect(norm("https://example.com/p?t=2&a=1&t=1")).toBe("https://example.com/p?a=1&t=2&t=1");
  });

  test("two spellings of one page share a key", () => {
    expect(norm("https://Example.com/a?x=1&y=2#top")).toBe(
      norm("https://example.com:443/a?y=2&x=1&utm_campaign=z"),
    );
  });

  test("rejects text that is not a URL", () => {
    const result = normalizeUrl("not a url");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_url");
  });
});
