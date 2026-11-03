import { describe, expect, test } from "bun:test";
import { parsePointer, readPointer } from "../../../src/views/native/pointer.ts";

const DOC = {
  a: { b: [1, { c: "x" }], "0": "zero", "with/slash": 5, "tilde~": 6 },
  n: null,
};

describe("parsePointer", () => {
  test("the empty pointer is the whole document", () => {
    expect(parsePointer("")).toEqual([]);
  });

  test("splits segments; a lone slash is one empty key", () => {
    expect(parsePointer("/a/b")).toEqual(["a", "b"]);
    expect(parsePointer("/")).toEqual([""]);
    expect(parsePointer("/a//b")).toEqual(["a", "", "b"]);
  });

  test("decodes ~1 to slash and ~0 to tilde, in RFC 6901 order", () => {
    expect(parsePointer("/a~1b")).toEqual(["a/b"]);
    expect(parsePointer("/m~0n")).toEqual(["m~n"]);
    expect(parsePointer("/~01")).toEqual(["~1"]);
    expect(parsePointer("/~0~1")).toEqual(["~/"]);
  });

  test("rejects a pointer without a leading slash or with a bad tilde escape", () => {
    expect(parsePointer("a/b")).toBeUndefined();
    expect(parsePointer("/a~")).toBeUndefined();
    expect(parsePointer("/a~2")).toBeUndefined();
    expect(parsePointer("/~")).toBeUndefined();
  });
});

describe("readPointer", () => {
  test("reads object keys and array indexes", () => {
    expect(readPointer(DOC, ["a", "b", "1", "c"])).toEqual({ found: true, value: "x" });
    expect(readPointer(DOC, ["a", "b"])).toEqual({ found: true, value: [1, { c: "x" }] });
    expect(readPointer(DOC, ["a", "with/slash"])).toEqual({ found: true, value: 5 });
    expect(readPointer(DOC, ["a", "tilde~"])).toEqual({ found: true, value: 6 });
    expect(readPointer(DOC, [])).toEqual({ found: true, value: DOC });
  });

  test("reports a missing key, an out-of-range index and non-canonical indexes as not found", () => {
    expect(readPointer(DOC, ["a", "missing"])).toEqual({ found: false });
    expect(readPointer(DOC, ["a", "b", "2"])).toEqual({ found: false });
    expect(readPointer(DOC, ["a", "b", "01"])).toEqual({ found: false });
    expect(readPointer(DOC, ["a", "b", "-1"])).toEqual({ found: false });
    expect(readPointer(DOC, ["a", "b", "1.0"])).toEqual({ found: false });
  });

  test("does not walk into primitives or null", () => {
    expect(readPointer(DOC, ["n", "x"])).toEqual({ found: false });
    expect(readPointer(DOC, ["a", "b", "1", "c", "length"])).toEqual({ found: false });
    expect(readPointer(DOC, ["a", "b", "0", "length"])).toEqual({ found: false });
  });

  test("never reads prototype members, even as the own property of the document", () => {
    expect(readPointer({}, ["constructor"])).toEqual({ found: false });
    expect(readPointer({}, ["toString"])).toEqual({ found: false });
    expect(readPointer({}, ["prototype"])).toEqual({ found: false });
    expect(readPointer({}, ["__proto__"])).toEqual({ found: false });

    // JSON.parse가 만드는 own "__proto__"와 "constructor"도 찾지 못한 것으로 본다
    const own = Object.defineProperty({}, "__proto__", {
      value: { polluted: true },
      enumerable: true,
    });
    const named = Object.defineProperty({}, "constructor", { value: 1, enumerable: true });
    expect(readPointer(own, ["__proto__", "polluted"])).toEqual({ found: false });
    expect(readPointer(own, ["__proto__"])).toEqual({ found: false });
    expect(readPointer(named, ["constructor"])).toEqual({ found: false });
  });
});
