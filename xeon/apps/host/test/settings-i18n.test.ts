import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildEngineCatalog } from "../src/assembly/catalog.ts";

const LOCALES_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "client",
  "src",
  "i18n",
  "locales",
);
const HANGUL = /[ㄱ-ㆎ가-힣]/;

function catalogOf(locale: "en" | "ko"): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8"));
  const out: Record<string, string> = {};
  if (typeof parsed === "object" && parsed !== null) {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  return out;
}

function coreDefs() {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error(`the core catalog must build: ${JSON.stringify(built.issues)}`);
  return [...built.catalog.values()];
}

test("no core setting label, help or unit fallback holds Hangul", () => {
  const offenders = coreDefs().flatMap((def) =>
    [def.ui?.label, def.ui?.help, def.ui?.unit]
      .filter((text): text is string => text !== undefined && HANGUL.test(text))
      .map((text) => `${def.key}: ${text}`),
  );
  expect(offenders).toEqual([]);
});

test("every built-in setting label and help key is in both catalogs, and the English fallback equals the en text", () => {
  const en = catalogOf("en");
  const ko = catalogOf("ko");
  const problems: string[] = [];
  for (const def of coreDefs()) {
    const { ui } = def;
    if (ui === undefined || def.key.startsWith("ext.")) continue;
    const pairs: ReadonlyArray<readonly [string | undefined, string | undefined]> = [
      [ui.labelKey, ui.label],
      [ui.helpKey, ui.help],
      [ui.unitKey, ui.unit],
    ];
    for (const [key, fallback] of pairs) {
      if (key === undefined) continue;
      // 영어 단위(ms, s, B)는 로케일마다 같아서 카탈로그에 두지 않는다
      if (
        en[key] === undefined &&
        ko[key] === undefined &&
        fallback !== undefined &&
        !HANGUL.test(fallback)
      ) {
        continue;
      }
      if (en[key] !== fallback) problems.push(`${def.key}: en ${key} is not the fallback`);
      if (ko[key] === undefined || ko[key] === en[key])
        problems.push(`${def.key}: ko ${key} missing or copied`);
    }
  }
  expect(problems).toEqual([]);
});
