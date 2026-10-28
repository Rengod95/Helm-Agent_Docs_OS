import { describe, expect, test } from "bun:test";
import type { WebFetchOutput, WebSearchOutput } from "@xeon/contracts/capabilities";
import { redactForPersistence } from "../src/contract/redact.ts";
import { metaOf, pageOf, sourceOf } from "./support/builders.ts";

describe("redactForPersistence", () => {
  test("redact none passages", () => {
    const output: WebSearchOutput = {
      results: [
        {
          rank: 1,
          sourceId: "s1",
          url: "https://a.example/",
          title: "A",
          passages: [{ sourceId: "s1", text: "secret excerpt", kind: "snippet" }],
        },
        {
          rank: 2,
          sourceId: "s2",
          url: "https://b.example/",
          passages: [{ sourceId: "s2", text: "kept excerpt", kind: "snippet" }],
        },
      ],
      sources: [
        sourceOf("s1", "https://a.example/", "none"),
        sourceOf("s2", "https://b.example/", "session"),
      ],
      answer: { text: "answer text", citations: [{ sourceId: "s1", citedText: "quote" }] },
      meta: metaOf({ provider: "plugin:web-brave" }),
    };
    const redacted = redactForPersistence(output);
    expect(redacted.results[0]?.passages[0]?.text).toBe("");
    expect(redacted.results[0]?.url).toBe("https://a.example/");
    expect(redacted.results[0]?.title).toBe("A");
    expect(redacted.results[1]?.passages[0]?.text).toBe("kept excerpt");
    expect(redacted.answer?.text).toBe("");
    expect(redacted.answer?.citations).toEqual([{ sourceId: "s1" }]);
    expect(redacted.sources).toEqual(output.sources);
    // 원본은 바뀌지 않는다
    expect(output.results[0]?.passages[0]?.text).toBe("secret excerpt");
  });

  test("a search without none sources is returned as is", () => {
    const output: WebSearchOutput = {
      results: [],
      sources: [sourceOf("s1", "https://a.example/", "persist")],
      answer: { text: "kept", citations: [{ sourceId: "s1" }] },
      meta: metaOf(),
    };
    expect(redactForPersistence(output)).toBe(output);
  });

  test("an answer citing only other sources stays", () => {
    const output: WebSearchOutput = {
      results: [],
      sources: [
        sourceOf("s1", "https://a.example/", "none"),
        sourceOf("s2", "https://b.example/", "session"),
      ],
      answer: { text: "from b", citations: [{ sourceId: "s2" }] },
      meta: metaOf(),
    };
    expect(redactForPersistence(output).answer?.text).toBe("from b");
  });

  test("fetch pages from a none provider lose their body", () => {
    const none = sourceOf("s1", "https://a.example/", "none");
    const persisted = sourceOf("s2", "https://b.example/", "persist");
    const output: WebFetchOutput = {
      pages: [pageOf(none, "private body"), pageOf(persisted, "public body")],
      meta: metaOf(),
    };
    const redacted = redactForPersistence(output);
    expect(redacted.pages[0]?.content).toBe("");
    expect(redacted.pages[0]?.source.url).toBe("https://a.example/");
    expect(redacted.pages[0]?.truncated.shown).toBe(0);
    expect(redacted.pages[1]?.content).toBe("public body");
  });
});
