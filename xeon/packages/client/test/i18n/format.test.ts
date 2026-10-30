import { expect, test } from "bun:test";
import { createIntlFormat } from "../../src/i18n/index.ts";

const fmt = createIntlFormat();

test("simple arguments and missing arguments", () => {
  expect(fmt.format("en", "Hello {name}!", { name: "Ann" })).toBe("Hello Ann!");
  expect(fmt.format("en", "Hello {name}!", {})).toBe("Hello {name}!");
});

test("plural picks exact, category and other cases with # as the number", () => {
  const message = "{n, plural, =0{no files} one{# file} other{# files}}";
  expect(fmt.format("en", message, { n: 0 })).toBe("no files");
  expect(fmt.format("en", message, { n: 1 })).toBe("1 file");
  expect(fmt.format("en", message, { n: 1234 })).toBe("1,234 files");
  expect(fmt.format("ko", "{n, plural, other{파일 #개}}", { n: 3 })).toBe("파일 3개");
});

test("select falls back to other", () => {
  const message = "{kind, select, a{Alpha} other{Other {kind}}}";
  expect(fmt.format("en", message, { kind: "a" })).toBe("Alpha");
  expect(fmt.format("en", message, { kind: "z" })).toBe("Other z");
});

test("nested plural inside text keeps surrounding text", () => {
  expect(
    fmt.format("en", "Found {n, plural, one{# match} other{# matches}} in {dir}", {
      n: 2,
      dir: "src",
    }),
  ).toBe("Found 2 matches in src");
});

test("number, date and time use Intl and UTC", () => {
  expect(fmt.format("en", "{n, number}", { n: 1234567.5 })).toBe("1,234,567.5");
  expect(fmt.format("en", "{n, number, integer}", { n: 2.6 })).toBe("3");
  expect(fmt.format("en", "{n, number, percent}", { n: 0.25 })).toBe("25%");
  const when = new Date(Date.UTC(2026, 9, 29, 23, 30));
  expect(fmt.format("en", "{d, date, long}", { d: when })).toBe("October 29, 2026");
  expect(fmt.format("ko", "{d, date, long}", { d: when })).toBe("2026년 10월 29일");
  expect(fmt.format("en", "{d, time, short}", { d: when })).toBe("11:30 PM");
});

test("apostrophe quotes only before a brace", () => {
  expect(fmt.format("en", "don't", {})).toBe("don't");
  expect(fmt.format("en", "use '{'braces'}' and it''s", {})).toBe("use {braces} and it's");
});
