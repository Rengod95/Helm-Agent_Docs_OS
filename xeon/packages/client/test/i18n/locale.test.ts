import { expect, test } from "bun:test";
import {
  createTranslator,
  osLocaleHint,
  resolveLocale,
  setActiveLocale,
  activeLocale,
  t,
} from "../../src/i18n/index.ts";

test("osLocaleHint reads LC_ALL, LC_MESSAGES then LANG and ignores C", () => {
  expect(osLocaleHint({ LC_ALL: "ko_KR.UTF-8", LANG: "en_US.UTF-8" })).toBe("ko");
  expect(osLocaleHint({ LC_ALL: "", LC_MESSAGES: "en_GB", LANG: "ko_KR" })).toBe("en");
  expect(osLocaleHint({ LANG: "C" })).toBeUndefined();
  expect(osLocaleHint({ LANG: "fr_FR.UTF-8" })).toBe("en");
  expect(osLocaleHint({})).toBeUndefined();
});

test("resolveLocale honors explicit values, auto follows the OS, unknown values fall back to en", () => {
  expect(resolveLocale("ko", { LANG: "en_US" })).toBe("ko");
  expect(resolveLocale("auto", { LANG: "ko_KR.UTF-8" })).toBe("ko");
  expect(resolveLocale(undefined, {})).toBeUndefined();
  expect(resolveLocale("fr", { LANG: "ko_KR" })).toBe("en");
});

test("translator resolves ids per locale and falls back to the fallback text", () => {
  expect(createTranslator("en").t("settings.l4.ui.locale.label")).toBe("Display language");
  expect(createTranslator("ko").t("settings.l4.ui.locale.label")).toBe("표시 언어");
  expect(createTranslator("en").tKey("no.such.id", "fallback")).toBe("fallback");
  expect(createTranslator("en").has("no.such.id")).toBe(false);
});

test("setActiveLocale switches the process translator", () => {
  const before = activeLocale();
  setActiveLocale("ko");
  expect(t("settings.l4.ui.locale.label")).toBe("표시 언어");
  setActiveLocale("en");
  expect(t("settings.l4.ui.locale.label")).toBe("Display language");
  setActiveLocale(before);
});
