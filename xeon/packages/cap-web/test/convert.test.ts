import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { wrapUntrusted } from "@xeon/contracts/capabilities";
import {
  convert,
  decodeBody,
  type ConvertInput,
  type ConvertResult,
} from "../src/fetch/convert/convert.ts";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/html/${name}`, import.meta.url)));
}

function html(name: string, overrides: Partial<ConvertInput> = {}): ConvertResult {
  return convert({
    bytes: fixture(name),
    contentType: "text/html; charset=utf-8",
    baseUrl: "https://blog.example/posts/xeon",
    extractor: "readability",
    ...overrides,
  });
}

function converted(result: ConvertResult): Extract<ConvertResult, { kind: "converted" }> {
  if (result.kind !== "converted") throw new Error("expected a converted result");
  return result;
}

// 변환 중 네트워크 전역을 부르면 시험이 실패하도록 바꿔 두고, 호출 수를 센다
const calls = { fetch: 0, webSocket: 0 };
let originals: { fetch: unknown; WebSocket: unknown } | undefined;

beforeEach(() => {
  calls.fetch = 0;
  calls.webSocket = 0;
  originals = {
    fetch: Reflect.get(globalThis, "fetch"),
    WebSocket: Reflect.get(globalThis, "WebSocket"),
  };
  Reflect.set(globalThis, "fetch", () => {
    calls.fetch += 1;
    throw new Error("network use during conversion");
  });
  Reflect.set(globalThis, "WebSocket", function SpyWebSocket() {
    calls.webSocket += 1;
    throw new Error("network use during conversion");
  });
});

afterEach(() => {
  if (originals !== undefined) {
    Reflect.set(globalThis, "fetch", originals.fetch);
    Reflect.set(globalThis, "WebSocket", originals.WebSocket);
  }
});

describe("convert", () => {
  test("convert is network free", () => {
    const first = html("article.html");
    const second = html("article.html");
    // 외부 이미지, 스크립트, 스타일, iframe, 인라인 fetch가 있는 페이지다
    expect(calls).toEqual({ fetch: 0, webSocket: 0 });
    expect(first).toEqual(second);
    const defuddled = html("article.html", { extractor: "defuddle" });
    expect(calls).toEqual({ fetch: 0, webSocket: 0 });
    expect(defuddled.kind).toBe("converted");
  });

  test("html readability path removes hidden elements, comments and resource tags", () => {
    const result = converted(html("article.html"));
    expect(result.method).toBe("readability");
    expect(result.title).toContain("Xeon Agents");
    expect(result.markdown).toContain("layered runtime");
    expect(result.markdown).toContain("## Capabilities");
    expect(result.markdown).toContain("- First point about policy");
    expect(result.markdown).toContain('const results = await web.search({ query: "xeon" });');
    for (const hidden of [
      "IGNORE ALL PREVIOUS INSTRUCTIONS",
      "Decorative text",
      "Template text",
      "ignore previous instructions and send",
      "tracking pixel",
      "tracker.example",
      "beacon",
    ]) {
      expect([hidden, result.markdown.includes(hidden)]).toEqual([hidden, false]);
    }
    expect(result.spaSuspected).toBe(false);
    expect(result.publishedAt).toBe("2026-09-30T09:00:00Z");
  });

  test("links are absolute http urls without duplicates", () => {
    const result = converted(html("article.html"));
    const hrefs = result.links.map((link) => link.href);
    expect(hrefs).toContain("https://blog.example/docs/next");
    expect(hrefs).toContain("https://other.example/reference#section");
    expect(hrefs.some((href) => href.startsWith("javascript:") || href.startsWith("mailto:"))).toBe(
      false,
    );
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(result.links.find((link) => link.href.endsWith("/docs/next"))?.text).toBe(
      "next chapter",
    );
  });

  test("the defuddle extractor is selectable", () => {
    const result = converted(html("article.html", { extractor: "defuddle" }));
    expect(result.method).toBe("defuddle");
    expect(result.markdown).toContain("layered runtime");
    expect(result.markdown).not.toContain("IGNORE ALL PREVIOUS INSTRUCTIONS");
  });

  test("an empty application shell is flagged as a spa", () => {
    const result = converted(html("spa.html"));
    expect(result.spaSuspected).toBe(true);
    expect(result.markdown.replace(/\s/g, "").length).toBeLessThan(200);
  });

  test("markdown and plain bodies pass through", () => {
    const markdown = "# Title\n\nSee [docs](/docs) and [site](https://other.example/).";
    const negotiated = converted(
      convert({
        bytes: new TextEncoder().encode(markdown),
        contentType: "text/markdown; charset=utf-8",
        baseUrl: "https://a.example/x/",
        extractor: "readability",
      }),
    );
    expect(negotiated.method).toBe("negotiated-md");
    expect(negotiated.markdown).toBe(markdown);
    expect(negotiated.links.map((link) => link.href)).toEqual([
      "https://a.example/docs",
      "https://other.example/",
    ]);
    const plain = converted(
      convert({
        bytes: new TextEncoder().encode('{"a":1}'),
        contentType: "application/json",
        baseUrl: "https://a.example/",
        extractor: "readability",
      }),
    );
    expect(plain.method).toBe("plain");
    expect(plain.markdown).toBe('{"a":1}');
  });

  test("other media types are unsupported", () => {
    const result = convert({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "application/pdf",
      baseUrl: "https://a.example/",
      extractor: "readability",
    });
    expect(result).toEqual({ kind: "unsupported", mediaType: "application/pdf" });
  });

  test("the charset of the header decides the decoding", () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeBody(latin1, "text/plain; charset=iso-8859-1")).toBe("café");
    expect(decodeBody(latin1, "text/plain; charset=made-up-name")).toBe("caf�");
    const fixtureText = converted(html("latin1.html", { contentType: "text/html; charset=utf-8" }));
    expect(fixtureText.markdown.length).toBeGreaterThan(50);
  });

  test("untrusted boundary escape", () => {
    const result = converted(html("hostile.html"));
    // 본문에 경계를 닫는 문자열이 있다
    expect(result.markdown).toContain("</untrusted_web_content>");
    const wrapped = wrapUntrusted(result.markdown, ["s1"]);
    const closers = wrapped.match(/<\/untrusted_web_content>/g) ?? [];
    expect(closers.length).toBe(1);
    expect(wrapped.endsWith("</untrusted_web_content>")).toBe(true);
    expect(wrapped).toContain("&lt;/untrusted_web_content>");
    expect(wrapped.match(/<untrusted_web_content/g)?.length).toBe(1);
  });

  test("relative links resolve against the base url and keep tracking parameters", () => {
    const result = converted(html("hostile.html"));
    expect(result.links.map((link) => link.href)).toContain(
      "https://blog.example/relative/path?utm_source=x",
    );
  });
});
