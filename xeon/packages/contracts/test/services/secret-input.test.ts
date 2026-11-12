import { describe, expect, test } from "bun:test";
import { isApiKeySecretName, normalizePastedKey } from "../../src/services/secret-input.ts";

describe("normalizePastedKey", () => {
  test("지우는 것: 앞뒤 공백, CR, LF", () => {
    expect(normalizePastedKey("  sk-abc\r\n")).toEqual({ value: "sk-abc", trimmed: true });
    expect(normalizePastedKey("\tsk-abc\n")).toEqual({ value: "sk-abc", trimmed: true });
  });

  test("지우는 것: NBSP와 너비 없는 글자(U+200B, U+200C, U+200D, U+2060, U+FEFF)", () => {
    expect(normalizePastedKey("\u00A0sk-abc\u00A0")).toEqual({ value: "sk-abc", trimmed: true });
    expect(normalizePastedKey("\u200Bsk-abc\u200C")).toEqual({ value: "sk-abc", trimmed: true });
    expect(normalizePastedKey("\u200Dsk-abc\u2060")).toEqual({ value: "sk-abc", trimmed: true });
    expect(normalizePastedKey("\uFEFFsk-abc\uFEFF")).toEqual({ value: "sk-abc", trimmed: true });
  });

  test("큰따옴표, 작은따옴표, 백틱 한 쌍을 지운다", () => {
    expect(normalizePastedKey('"sk-abc"')).toEqual({ value: "sk-abc", trimmed: true });
    expect(normalizePastedKey("'sk-abc'")).toEqual({ value: "sk-abc", trimmed: true });
    expect(normalizePastedKey("`sk-abc`")).toEqual({ value: "sk-abc", trimmed: true });
  });

  test("따옴표 안쪽의 공백도 한 번 더 지운다", () => {
    expect(normalizePastedKey('  " sk-abc "\n')).toEqual({ value: "sk-abc", trimmed: true });
  });

  test("따옴표는 한 쌍만 지운다. 짝이 다르면 건드리지 않는다", () => {
    expect(normalizePastedKey("'\"sk-abc\"'")).toEqual({ value: '"sk-abc"', trimmed: true });
    expect(normalizePastedKey("\"sk-abc'")).toEqual({ value: "\"sk-abc'", trimmed: false });
    expect(normalizePastedKey('"')).toEqual({ value: '"', trimmed: false });
  });

  test("안쪽은 건드리지 않는다", () => {
    expect(normalizePastedKey("sk-a bc")).toEqual({ value: "sk-a bc", trimmed: false });
    expect(normalizePastedKey("sk-a\u200Bbc")).toEqual({ value: "sk-a\u200Bbc", trimmed: false });
    expect(normalizePastedKey("  sk-a\tbc\r\n")).toEqual({ value: "sk-a\tbc", trimmed: true });
  });

  test("바뀐 것이 없으면 trimmed는 false다", () => {
    expect(normalizePastedKey("sk-abc")).toEqual({ value: "sk-abc", trimmed: false });
    expect(normalizePastedKey("")).toEqual({ value: "", trimmed: false });
  });

  test("공백만 있으면 빈 값이 되고 trimmed는 true다", () => {
    expect(normalizePastedKey(" \r\n\t ")).toEqual({ value: "", trimmed: true });
    expect(normalizePastedKey('""')).toEqual({ value: "", trimmed: true });
  });
});

describe("isApiKeySecretName", () => {
  test("이름이 -api-key로 끝나면 API 키다", () => {
    expect(isApiKeySecretName("anthropic-api-key")).toBe(true);
    expect(isApiKeySecretName("exa-api-key")).toBe(true);
    expect(isApiKeySecretName("github-token")).toBe(false);
    expect(isApiKeySecretName("api-key-backup")).toBe(false);
  });
});
