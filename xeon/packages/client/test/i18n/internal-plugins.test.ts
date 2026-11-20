import { expect, test } from "bun:test";
import { INTERNAL_PLUGIN_NAMES, internalPluginTextKey } from "@fresnel/contracts/extensions";
import { catalogOf } from "../../src/i18n/index.ts";

// AGE-33: 내부 부품마다 영어와 한국어 이름·하는 일이 있다. 새 내부 부품을 목록에 더하면서 글을 빼먹으면 이 시험이 실패한다.

const en = catalogOf("en");
const ko = catalogOf("ko");
const hangul = /[ㄱ-ㆎ가-힣]/;

test("every internal plugin has a non-empty name and purpose in en and ko", () => {
  const missing: string[] = [];
  for (const name of INTERNAL_PLUGIN_NAMES) {
    for (const field of ["name", "purpose"] as const) {
      const key = internalPluginTextKey(name, field);
      if ((en[key] ?? "").trim() === "") missing.push(`en ${key}`);
      if ((ko[key] ?? "").trim() === "") missing.push(`ko ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test("ko internal plugin texts are Korean and en texts are not", () => {
  const keys = INTERNAL_PLUGIN_NAMES.flatMap((name) => [
    internalPluginTextKey(name, "name"),
    internalPluginTextKey(name, "purpose"),
  ]);
  expect(keys.filter((key) => hangul.test(en[key] ?? ""))).toEqual([]);
  expect(keys.filter((key) => !hangul.test(ko[key] ?? ""))).toEqual([]);
});

test("the catalog has no internal plugin text for a name outside the list", () => {
  const known = new Set<string>(
    INTERNAL_PLUGIN_NAMES.flatMap((name) => [
      internalPluginTextKey(name, "name"),
      internalPluginTextKey(name, "purpose"),
    ]),
  );
  expect(
    Object.keys(en)
      .filter((key) => key.startsWith("plugin.internal."))
      .filter((key) => !known.has(key)),
  ).toEqual([]);
});

test("internal plugin names and purposes are one sentence without file names or ids", () => {
  const offending = INTERNAL_PLUGIN_NAMES.flatMap((name) => {
    const text = [en, ko].map((catalog) => catalog[internalPluginTextKey(name, "purpose")] ?? "");
    return text.filter((line) => /\.(ts|json|md)\b|fresnel\.|core-|cap-|host-/.test(line));
  });
  expect(offending).toEqual([]);
});
