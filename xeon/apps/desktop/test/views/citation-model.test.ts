import { describe, expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import type { ItemShape } from "../../src/state/engine/index.ts";
import {
  citationIdOfHref,
  citationNumberOf,
  citationSourcesOf,
  linkCitations,
  sourceNumberOf,
  webCallIdsOf,
} from "../../src/views/convo/citation-model.ts";
import type { WebSource } from "../../src/views/tool-extras-model.ts";
import { itm } from "../state/helpers.ts";

const S1: WebSource = {
  id: "s1",
  title: "Python Release Python 3.13.0",
  url: "https://www.python.org/downloads/release/python-3130/",
  domain: "python.org",
};
const S2: WebSource = {
  id: "s2",
  title: "What's New In Python 3.13",
  url: "https://docs.python.org/3/whatsnew/3.13.html",
  domain: "docs.python.org",
};
const KNOWN: ReadonlyMap<string, WebSource> = new Map([
  ["s1", S1],
  ["s2", S2],
]);

function webResult(n: number, callId: string, text: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "toolResult",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "web_search",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 0,
    },
    effectId: null,
  };
}

describe("linkCitations", () => {
  test("the parenthetical from the capture collapses to number chips in the order written", () => {
    const text =
      "Python 3.13은 2024년 10월 7일에 정식 출시되었습니다. (출처: [s2] What's New In Python 3.13 – https://docs.python.org/3/whatsnew/3.13.html / [s1] https://www.python.org/downloads/release/python-3130/)";
    expect(linkCitations(text, KNOWN)).toBe(
      "Python 3.13은 2024년 10월 7일에 정식 출시되었습니다. [2](#cite-s2)[1](#cite-s1)",
    );
  });
  test("single and adjacent markers become chips in place", () => {
    expect(linkCitations("출시일이에요 [s1]. 새 기능도 있어요[s1][s2].", KNOWN)).toBe(
      "출시일이에요 [1](#cite-s1). 새 기능도 있어요[1](#cite-s1)[2](#cite-s2).",
    );
  });
  test("a parenthetical holding only markers and their titles collapses", () => {
    expect(linkCitations("끝 ([s2] What's New In Python 3.13)", KNOWN)).toBe("끝 [2](#cite-s2)");
  });
  test("a parenthetical with other words keeps its words; only the marker becomes a chip", () => {
    expect(linkCitations("(자세한 건 [s1] 참고)", KNOWN)).toBe("(자세한 건 [1](#cite-s1) 참고)");
  });
  test("a bare URL right after a marker is dropped outside parentheses too", () => {
    expect(linkCitations("출처 [s1] https://www.python.org/x 를 봤어요", KNOWN)).toBe(
      "출처 [1](#cite-s1) 를 봤어요",
    );
  });
  test("a marker with no matching source stays plain text, and so does its parenthetical", () => {
    expect(linkCitations("답 [s9] (출처: [s9] https://x.dev)", KNOWN)).toBe(
      "답 [s9] (출처: [s9] https://x.dev)",
    );
  });
  test("fenced code blocks and inline code keep their markers", () => {
    const text = "앞 [s1]\n\n```\nlist[s1]\n```\n\n`a[s2]` 뒤 [s2]";
    expect(linkCitations(text, KNOWN)).toBe(
      "앞 [1](#cite-s1)\n\n```\nlist[s1]\n```\n\n`a[s2]` 뒤 [2](#cite-s2)",
    );
  });
  test("a marker already used as a link label and an escaped marker are left alone", () => {
    expect(linkCitations("[s1](https://a.dev) \\[s2]", KNOWN)).toBe("[s1](https://a.dev) \\[s2]");
  });
  test("without sources the text comes back unchanged", () => {
    expect(linkCitations("답 [s1]", new Map())).toBe("답 [s1]");
  });
});

describe("citation ids", () => {
  test("reads the number of an sN id and nothing else", () => {
    expect([citationNumberOf("s12"), citationNumberOf("c1"), citationNumberOf("s")]).toEqual([
      12,
      null,
      null,
    ]);
  });
  test("reads the source id back from a chip link only", () => {
    expect([
      citationIdOfHref("#cite-s3"),
      citationIdOfHref("#cite-x"),
      citationIdOfHref("https://a.dev"),
      citationIdOfHref(undefined),
    ]).toEqual(["s3", null, null, null]);
  });
});

describe("citationSourcesOf", () => {
  test("collects sources from web tool results by id, first one winning", () => {
    const first = webResult(
      1,
      "c1",
      "[s1] Python Release Python 3.13.0 https://www.python.org/downloads/release/python-3130/\n  passage",
    );
    const second = webResult(
      2,
      "c2",
      "[s1] Other https://other.dev/\n[s2] What's New In Python 3.13 (2024-10-07) https://docs.python.org/3/whatsnew/3.13.html",
    );
    expect([...citationSourcesOf([first, undefined, second])]).toEqual([
      ["s1", S1],
      ["s2", S2],
    ]);
  });
});

describe("sourceNumberOf", () => {
  test("a tool source uses its own number", () => {
    expect(sourceNumberOf(S2, KNOWN)).toBe(2);
  });
  test("a link cited in the answer takes the number of the source with the same URL", () => {
    const cited: WebSource = { id: "c1", title: "python.org", url: S1.url, domain: "python.org" };
    expect(sourceNumberOf(cited, KNOWN)).toBe(1);
  });
  test("a cited link that is no thread source has no number", () => {
    const cited: WebSource = { id: "c2", title: "a.dev", url: "https://a.dev/", domain: "a.dev" };
    expect(sourceNumberOf(cited, KNOWN)).toBeNull();
  });
});

describe("webCallIdsOf", () => {
  test("lists only web tool calls of assistant items in order", () => {
    const shapes: readonly ItemShape[] = [
      { kind: "user", id: itm(1) },
      {
        kind: "assistant",
        id: itm(2),
        blocks: [
          { kind: "text", index: 0 },
          { kind: "call", index: 1, callId: "c1", name: "web_search", args: {} },
          { kind: "call", index: 2, callId: "c2", name: "read", args: {} },
          { kind: "call", index: 3, callId: "c3", name: "web_fetch", args: {} },
        ],
      },
    ];
    expect(webCallIdsOf(shapes)).toEqual(["c1", "c3"]);
  });
});
