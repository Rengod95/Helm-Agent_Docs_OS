import { expect, test } from "bun:test";
import {
  BUILTIN_GROUP_NAMES,
  BUILTIN_PLUGIN_NAMES,
  builtinPluginTextKey,
  INTERNAL_PLUGIN_LAYERS,
  INTERNAL_PLUGIN_NAMES,
  type InternalPluginTextField,
  internalLayerTextKey,
  internalPluginTextKey,
} from "@fresnel/contracts/extensions";
import { catalogOf } from "../../src/i18n/index.ts";

// AGE-33: 내부 부품마다 영어와 한국어 이름·하는 일이 있다. 새 내부 부품을 목록에 더하면서 글을 빼먹으면 이 시험이 실패한다.
// AGE-31: 내장 플러그인(내부 부품과 내장 그룹)은 이름, 목적 한 문장, 설명을 영어와 한국어로 가진다.

const en = catalogOf("en");
const ko = catalogOf("ko");
const hangul = /[ㄱ-ㆎ가-힣]/;
const TEXT_FIELDS: readonly InternalPluginTextField[] = ["name", "purpose", "description"];

/** 이름마다 주어진 칸의 카탈로그 키. 내장이 아닌 이름과 키가 없는 칸은 뺀다(빠진 칸은 아래 해석 시험이 잡는다) */
function builtinKeys(
  names: readonly string[],
  fields: readonly InternalPluginTextField[],
): string[] {
  return names.flatMap((name) =>
    fields.flatMap((field) => {
      const key = builtinPluginTextKey(name, field);
      return key === undefined ? [] : [key];
    }),
  );
}

test("every internal plugin has a non-empty name, purpose and description in en and ko", () => {
  const missing: string[] = [];
  for (const name of INTERNAL_PLUGIN_NAMES) {
    for (const field of TEXT_FIELDS) {
      const key = internalPluginTextKey(name, field);
      if ((en[key] ?? "").trim() === "") missing.push(`en ${key}`);
      if ((ko[key] ?? "").trim() === "") missing.push(`ko ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test("every builtin group has a non-empty name, purpose and description in en and ko", () => {
  const missing: string[] = [];
  for (const name of BUILTIN_GROUP_NAMES) {
    for (const field of TEXT_FIELDS) {
      const key = builtinPluginTextKey(name, field);
      if (key === undefined) {
        missing.push(`no key for ${name} ${field}`);
        continue;
      }
      if ((en[key] ?? "").trim() === "") missing.push(`en ${key}`);
      if ((ko[key] ?? "").trim() === "") missing.push(`ko ${key}`);
    }
  }
  expect(missing).toEqual([]);
});

test("every builtin plugin resolves a non-empty description in en and ko", () => {
  const unresolved = BUILTIN_PLUGIN_NAMES.filter((name) => {
    const key = builtinPluginTextKey(name, "description");
    return key === undefined || (en[key] ?? "").trim() === "" || (ko[key] ?? "").trim() === "";
  });
  expect(unresolved).toEqual([]);
});

test("ko builtin plugin texts are Korean and en texts are not", () => {
  const keys = builtinKeys(BUILTIN_PLUGIN_NAMES, TEXT_FIELDS);
  expect(keys.filter((key) => hangul.test(en[key] ?? ""))).toEqual([]);
  expect(keys.filter((key) => !hangul.test(ko[key] ?? ""))).toEqual([]);
});

test("the catalog has no internal plugin text for a name outside the list", () => {
  const known = new Set<string>([
    ...builtinKeys(INTERNAL_PLUGIN_NAMES, TEXT_FIELDS),
    ...INTERNAL_PLUGIN_LAYERS.map(internalLayerTextKey),
  ]);
  expect(
    Object.keys(en)
      .filter((key) => key.startsWith("plugin.internal."))
      .filter((key) => !known.has(key)),
  ).toEqual([]);
});

test("the catalog has no builtin plugin text for a name outside the builtin groups", () => {
  const known = new Set<string>(builtinKeys(BUILTIN_GROUP_NAMES, TEXT_FIELDS));
  expect(
    Object.keys(en)
      .filter((key) => key.startsWith("plugin.builtin."))
      .filter((key) => !known.has(key)),
  ).toEqual([]);
});

test("internal and builtin plugin purposes and descriptions are one sentence without file names or ids", () => {
  const offending = builtinKeys(BUILTIN_PLUGIN_NAMES, ["purpose", "description"]).flatMap((key) =>
    [en[key] ?? "", ko[key] ?? ""].filter((text) =>
      /\.(ts|json|md)\b|fresnel\.|core-|cap-|host-/.test(text),
    ),
  );
  expect(offending).toEqual([]);
});

test("internal and builtin plugin texts have no middle dot and no 공장", () => {
  const offending: string[] = [];
  for (const catalog of [en, ko]) {
    for (const [key, text] of Object.entries(catalog)) {
      if (!key.startsWith("plugin.internal.") && !key.startsWith("plugin.builtin.")) continue;
      if (text.includes("·") || text.includes("공장")) offending.push(`${key}: ${text}`);
    }
  }
  expect(offending).toEqual([]);
});

test("each layer group has an English and a Korean display name", () => {
  expect(INTERNAL_PLUGIN_LAYERS.map((layer) => en[internalLayerTextKey(layer)])).toEqual([
    "Core",
    "Capabilities",
    "Bridges",
  ]);
  expect(INTERNAL_PLUGIN_LAYERS.map((layer) => ko[internalLayerTextKey(layer)])).toEqual([
    "코어",
    "기능",
    "브릿지",
  ]);
});
