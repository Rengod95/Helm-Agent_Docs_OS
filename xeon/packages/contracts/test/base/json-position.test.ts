import { describe, expect, test } from "bun:test";
import { jsonErrorPosition } from "../../src/index.ts";

// 엄격한 JSON 스캐너의 첫 오류 위치(줄, 칸). 올바른 JSON은 undefined다. 값을 비교한다.

describe("jsonErrorPosition", () => {
  test("a file that ends early is an error at the end of the text", () => {
    expect(jsonErrorPosition('{"a":1,')).toEqual({ line: 1, column: 8 });
  });

  test("a value missing after a colon is an error at the closing brace", () => {
    expect(jsonErrorPosition('{ "a": }')).toEqual({ line: 1, column: 8 });
  });

  test("text that is not JSON at all is an error at its first character", () => {
    expect(jsonErrorPosition("garbage")).toEqual({ line: 1, column: 1 });
    expect(jsonErrorPosition("")).toEqual({ line: 1, column: 1 });
  });

  test("the line number counts the newlines before the error", () => {
    expect(jsonErrorPosition('{\n  "a": 1,\n  "b": }')).toEqual({ line: 3, column: 8 });
    expect(jsonErrorPosition('{\r\n  "a": x\r\n}')).toEqual({ line: 2, column: 8 });
  });

  test("a trailing comma and trailing text are errors where they stand", () => {
    expect(jsonErrorPosition('{"a":1,}')).toEqual({ line: 1, column: 8 });
    expect(jsonErrorPosition("[1,]")).toEqual({ line: 1, column: 4 });
    expect(jsonErrorPosition("{} x")).toEqual({ line: 1, column: 4 });
  });

  test("the first error is reported, not a later one", () => {
    expect(jsonErrorPosition('{"a" 1 "b": }')).toEqual({ line: 1, column: 6 });
  });

  test("strings reject a raw newline, a bad escape and a short unicode escape", () => {
    expect(jsonErrorPosition('"ab\ncd"')).toEqual({ line: 1, column: 4 });
    expect(jsonErrorPosition('"\\x"')).toEqual({ line: 1, column: 3 });
    expect(jsonErrorPosition('"\\u12G4"')).toEqual({ line: 1, column: 6 });
    expect(jsonErrorPosition('"unclosed')).toEqual({ line: 1, column: 10 });
  });

  test("numbers and literals follow the JSON grammar", () => {
    expect(jsonErrorPosition("01")).toEqual({ line: 1, column: 2 });
    expect(jsonErrorPosition("1.")).toEqual({ line: 1, column: 3 });
    expect(jsonErrorPosition("-")).toEqual({ line: 1, column: 2 });
    expect(jsonErrorPosition("tru")).toEqual({ line: 1, column: 4 });
    expect(jsonErrorPosition("trux")).toEqual({ line: 1, column: 4 });
  });

  test("valid JSON has no position", () => {
    expect(jsonErrorPosition("{}")).toBeUndefined();
    expect(jsonErrorPosition("  \n\t[]\r\n")).toBeUndefined();
    expect(
      jsonErrorPosition('{"a":{"b":[1,-2.5e+3,{"c":null}],"d":"x\\u00e9\\n"},"e":true}'),
    ).toBeUndefined();
    expect(jsonErrorPosition('"\\/\\b\\f\\r\\t\\""')).toBeUndefined();
  });
});
