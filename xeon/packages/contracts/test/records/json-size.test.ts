import { describe, expect, test } from "bun:test";
import { jsonUtf8Length, stringUtf8Sizes } from "../../src/records/json-size.ts";

// F.records.spec §3.4.1 큰 값의 크기 세기. 값을 직렬화한 글을 만들지 않고 센 결과가 `JSON.stringify` 뒤 UTF-8 인코딩의 길이와 같다.

const encoder = new TextEncoder();

const STRINGS: readonly string[] = [
  "",
  "plain ascii text",
  'quote " and backslash \\ and slash /',
  "controls \u0000 \u0001 \b \t \n \f \r \u001f and del \u007f",
  "한글과 émoji 😀 mixed",
  "lone high \ud800 surrogate",
  "lone low \udc00 surrogate",
  "pair 😀 and then lone \ud83d",
  "line sep   and   and bom ﻿",
  "a".repeat(70_000),
  "한".repeat(30_000),
];

const VALUES: readonly unknown[] = [
  ...STRINGS,
  [],
  {},
  null,
  true,
  12.5,
  -0,
  [1, "x", null, [2, [3]]],
  { a: 1, b: undefined, c: [undefined, 2], 'key "q" 한': { nested: "값" } },
  { list: STRINGS, deep: { deeper: { text: "😀".repeat(1000) } } },
];

describe("size counting without building the serialized text", () => {
  test("stringUtf8Sizes equals the JSON length and the UTF-8 length of the string itself", () => {
    for (const text of STRINGS) {
      expect(stringUtf8Sizes(text)).toEqual({
        json: encoder.encode(JSON.stringify(text)).length,
        utf8: encoder.encode(text).length,
      });
    }
  });

  test("jsonUtf8Length equals the UTF-8 length of JSON.stringify for strings, containers and scalars", () => {
    for (const value of VALUES) {
      expect(jsonUtf8Length(value)).toBe(encoder.encode(JSON.stringify(value)).length);
    }
  });
});
