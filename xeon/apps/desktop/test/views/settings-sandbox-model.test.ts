import { describe, expect, test } from "bun:test";
import {
  addEntry,
  checkDomain,
  checkEntry,
  checkPath,
  sandboxListKindOf,
  textListOf,
  withoutEntry,
} from "../../src/views/pages/settings/settings-sandbox-model.ts";

// 샌드박스 목록 모델(L4.desktop-ux §6.13). 쓰기 경로와 차단 도메인의 형식 검사는 실패 이유를 값으로 돌려준다.

describe("sandboxListKindOf", () => {
  test("the write paths and the blocked domains are the two lists", () => {
    expect(sandboxListKindOf("l0.sandbox.writeRoots.extra")).toBe("paths");
    expect(sandboxListKindOf("l0.sandbox.network.blockedDomains")).toBe("domains");
    expect(sandboxListKindOf("l0.sandbox.protectedPaths.extra")).toBeNull();
  });
});

describe("checkPath", () => {
  test("an absolute path or one under ~/ is kept, trimmed", () => {
    expect(checkPath("  /srv/data ")).toEqual({ ok: true, value: "/srv/data" });
    expect(checkPath("~/notes")).toEqual({ ok: true, value: "~/notes" });
    expect(checkPath("/a/..b")).toEqual({ ok: true, value: "/a/..b" });
  });

  test("an empty path, a relative path, a .. segment and a control character are refused", () => {
    expect(checkPath("   ")).toEqual({ ok: false, error: "empty" });
    expect(checkPath("data/out")).toEqual({ ok: false, error: "relative" });
    expect(checkPath("~user/x")).toEqual({ ok: false, error: "relative" });
    expect(checkPath("/a/../b")).toEqual({ ok: false, error: "traversal" });
    expect(checkPath("/a/..")).toEqual({ ok: false, error: "traversal" });
    expect(checkPath("/a\u0007b")).toEqual({ ok: false, error: "control" });
  });
});

describe("checkDomain", () => {
  test("a domain is kept in lower case, with an optional *. prefix", () => {
    expect(checkDomain(" Example.COM ")).toEqual({ ok: true, value: "example.com" });
    expect(checkDomain("*.example.com")).toEqual({ ok: true, value: "*.example.com" });
    expect(checkDomain("localhost")).toEqual({ ok: true, value: "localhost" });
  });

  test("an empty domain, a URL, a double dot, a bad label and a trailing dot are refused", () => {
    expect(checkDomain("")).toEqual({ ok: false, error: "empty" });
    expect(checkDomain("https://x.com")).toEqual({ ok: false, error: "format" });
    expect(checkDomain("a..b")).toEqual({ ok: false, error: "format" });
    expect(checkDomain("-bad.com")).toEqual({ ok: false, error: "format" });
    expect(checkDomain("example.com.")).toEqual({ ok: false, error: "format" });
    expect(checkDomain("*.")).toEqual({ ok: false, error: "format" });
    expect(
      checkDomain(`${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}`),
    ).toEqual({
      ok: false,
      error: "format",
    });
  });

  test("the check is picked by the list kind", () => {
    expect(checkEntry("paths", "/x")).toEqual({ ok: true, value: "/x" });
    expect(checkEntry("domains", "/x")).toEqual({ ok: false, error: "format" });
  });
});

describe("addEntry and withoutEntry", () => {
  test("a checked entry goes to the end, a duplicate is refused", () => {
    expect(addEntry("paths", ["/a"], " /b ")).toEqual({ ok: true, value: ["/a", "/b"] });
    expect(addEntry("paths", ["/a"], "/a")).toEqual({ ok: false, error: "duplicate" });
    expect(addEntry("domains", [], "bad host")).toEqual({ ok: false, error: "format" });
  });

  test("an entry is removed by its row", () => {
    expect(withoutEntry(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });
});

describe("textListOf", () => {
  test("a list of text reads back, anything else is unreadable", () => {
    expect(textListOf(["a", "b"])).toEqual(["a", "b"]);
    expect(textListOf([])).toEqual([]);
    expect(textListOf(["a", 1])).toBeNull();
    expect(textListOf("a")).toBeNull();
    expect(textListOf(null)).toBeNull();
  });
});
