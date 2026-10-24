import { describe, expect, test } from "bun:test";
import type { ProviderSearchItem } from "@xeon/contracts/capabilities";
import {
  applyPostFilters,
  mergeFilters,
  parseSearchQuery,
  recencyCutoff,
  type FilterContext,
} from "../src/search/query.ts";

function item(url: string, title: string, text: string, publishedAt?: string): ProviderSearchItem {
  return {
    url,
    title,
    ...(publishedAt === undefined ? {} : { publishedAt }),
    passages: [{ text, kind: "snippet" }],
  };
}

function context(
  query: string,
  options: { recency?: string; deny?: string[]; allow?: string[] } = {},
): FilterContext {
  return {
    merged: mergeFilters(
      parseSearchQuery(query),
      { allow: options.allow ?? [], deny: options.deny ?? [] },
      [],
    ),
    recencyAfter: options.recency,
  };
}

describe("query directives", () => {
  test("parse directives", () => {
    const parsed = parseSearchQuery(
      'agents site:Example.com -site:bad.example after:2026-01-01 before:2026-06-30 filetype:PDF intitle:guide intitle:"field notes" "exact phrase" -draft -"old news" OR planning',
    );
    expect(parsed.terms).toBe("agents OR planning");
    expect(parsed.directives).toEqual({
      site: ["example.com"],
      excludeSite: ["bad.example"],
      after: "2026-01-01",
      before: "2026-06-30",
      filetype: ["pdf"],
      intitle: ["guide", "field notes"],
      phrases: ["exact phrase"],
      exclude: ["draft", "old news"],
    });
  });

  test("a query without directives passes through unchanged", () => {
    const parsed = parseSearchQuery("how do layered agent runtimes work");
    expect(parsed.terms).toBe("how do layered agent runtimes work");
    expect(parsed.directives.site).toEqual([]);
    expect(parsed.directives.phrases).toEqual([]);
  });

  test("malformed directives stay in the terms", () => {
    const parsed = parseSearchQuery("news after:yesterday site: -site:");
    expect(parsed.terms).toBe("news after:yesterday");
    expect(parsed.directives.after).toBeUndefined();
    expect(parsed.directives.site).toEqual([]);
  });

  test("site accepts urls and wildcards", () => {
    const parsed = parseSearchQuery("x site:https://Docs.Example.com/path -site:*.ads.example");
    expect(parsed.directives.site).toEqual(["docs.example.com"]);
    expect(parsed.directives.excludeSite).toEqual(["ads.example"]);
  });

  test("an unterminated quote runs to the end", () => {
    const parsed = parseSearchQuery('find "unfinished phrase');
    expect(parsed.directives.phrases).toEqual(["unfinished phrase"]);
    expect(parsed.terms).toBe("find");
  });

  test("recency becomes a date floor", () => {
    const now = Date.UTC(2026, 9, 24, 12);
    expect(recencyCutoff("day", now)).toBe("2026-10-23");
    expect(recencyCutoff("week", now)).toBe("2026-10-17");
    expect(recencyCutoff("month", now)).toBe("2026-09-24");
    expect(recencyCutoff("year", now)).toBe("2025-10-24");
  });
});

describe("post filters", () => {
  const items = [
    item(
      "https://docs.example.com/guide.pdf",
      "Agent guide",
      "Covers planning and the exact phrase.",
      "2026-03-01",
    ),
    item(
      "https://blog.example.com/post",
      "Agent news",
      "A draft of the exact phrase.",
      "2026-05-01",
    ),
    item("https://other.test/page", "Other", "Nothing relevant here.", "2025-01-01"),
    item("https://docs.example.com/undated", "Undated guide", "exact phrase again"),
  ];

  test("native dimensions are not applied again", () => {
    const outcome = applyPostFilters(items, context("x site:docs.example.com"), new Set(["site"]));
    expect(outcome.items.length).toBe(4);
    expect(outcome.relaxed).toEqual([]);
    expect(outcome.filtered).toBe(false);
  });

  test("site, filetype, intitle, phrase, exclude and dates filter the rest", () => {
    const site = applyPostFilters(items, context("x site:example.com"), new Set());
    expect(site.items.map((entry) => entry.url)).toEqual([
      "https://docs.example.com/guide.pdf",
      "https://blog.example.com/post",
      "https://docs.example.com/undated",
    ]);
    const filetype = applyPostFilters(items, context("x filetype:pdf"), new Set());
    expect(filetype.items.map((entry) => entry.url)).toEqual([
      "https://docs.example.com/guide.pdf",
    ]);
    const intitle = applyPostFilters(items, context("x intitle:guide"), new Set());
    expect(intitle.items.length).toBe(2);
    const phrase = applyPostFilters(items, context('x "exact phrase"'), new Set());
    expect(phrase.items.length).toBe(3);
    const exclude = applyPostFilters(items, context('x "exact phrase" -draft'), new Set());
    expect(exclude.items.map((entry) => entry.url)).toEqual([
      "https://docs.example.com/guide.pdf",
      "https://docs.example.com/undated",
    ]);
    const dates = applyPostFilters(
      items,
      context("x after:2026-02-01 before:2026-04-01"),
      new Set(),
    );
    // 게시일을 모르는 항목은 날짜 조건으로 버리지 않는다
    expect(dates.items.map((entry) => entry.url)).toEqual([
      "https://docs.example.com/guide.pdf",
      "https://docs.example.com/undated",
    ]);
    const recent = applyPostFilters(items, context("x", { recency: "2026-04-01" }), new Set());
    expect(recent.items.map((entry) => entry.url)).toEqual([
      "https://blog.example.com/post",
      "https://docs.example.com/undated",
    ]);
  });

  test("domains from the call and from policy filter results and are never relaxed", () => {
    const denied = applyPostFilters(items, context("x", { deny: ["*.example.com"] }), new Set());
    expect(denied.items.map((entry) => entry.url)).toEqual(["https://other.test/page"]);
    const allowOnly = applyPostFilters(items, context("x", { allow: ["other.test"] }), new Set());
    expect(allowOnly.items.length).toBe(1);
    // 모든 항목이 정책 deny에 걸려도 domains는 완화하지 않아 빈 결과다
    const none = applyPostFilters(
      items,
      context("x", { deny: ["*.example.com", "other.test"] }),
      new Set(),
    );
    expect(none.items).toEqual([]);
    expect(none.relaxed).toEqual([]);
  });

  test("relax order", () => {
    const pool = [item("https://docs.example.com/a", "Plain title", "plain text", "2025-01-01")];
    // 모든 조건이 결과를 없앤다: exclude → phrase → intitle → filetype → date → recency → site 순으로 하나씩 푼다
    const query =
      'x "no such phrase" -plain intitle:missing filetype:pdf after:2026-01-01 site:elsewhere.test';
    const outcome = applyPostFilters(pool, context(query, { recency: "2026-06-01" }), new Set());
    expect(outcome.items.length).toBe(1);
    expect(outcome.relaxed).toEqual([
      "exclude",
      "phrase",
      "intitle",
      "filetype",
      "date",
      "recency",
      "site",
    ]);
    // 앞 단계에서 결과가 생기면 거기서 멈춘다
    const early = applyPostFilters(pool, context('x -plain "plain"'), new Set());
    expect(early.relaxed).toEqual(["exclude"]);
    expect(early.items.length).toBe(1);
  });

  test("an empty provider result is not relaxed", () => {
    const outcome = applyPostFilters([], context('x "phrase" site:a.test'), new Set());
    expect(outcome).toEqual({ items: [], relaxed: [], filtered: false });
  });
});
