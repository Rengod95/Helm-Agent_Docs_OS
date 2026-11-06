import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { activeLocale, setActiveLocale, type Locale } from "../../src/i18n/index.ts";
import { extNameOf, INITIAL_WORKBENCH, rowOf } from "../../src/workbench/index.ts";

function inLocale<T>(locale: Locale, read: () => T): T {
  const before = activeLocale();
  setActiveLocale(locale);
  try {
    return read();
  } finally {
    setActiveLocale(before);
  }
}

const full = (over: Partial<ExtListEntry>): ExtListEntry => ({
  name: "x",
  displayName: "x",
  layer: "L1",
  isGroup: false,
  version: "1.0.0",
  location: "/x",
  origin: "builtin",
  requestedGrade: "user",
  effectiveGrade: "user",
  tier: null,
  status: "enabled",
  plugins: [],
  diagnostics: [],
  autoDisabled: false,
  safeModeExcluded: null,
  hookCount: 0,
  ...over,
});

const part: Pick<ExtListEntry, "name" | "displayName"> = {
  name: "core-persistence",
  displayName: "Session persistence",
};

describe("확장 이름", () => {
  test("카탈로그에 ext.name 키가 있으면 한국어 이름을 쓴다", () => {
    expect(inLocale("ko", () => extNameOf(part))).toBe("대화 저장");
  });

  test("영어 말투와 키가 없는 확장은 매니페스트 이름을 쓴다", () => {
    expect(inLocale("en", () => extNameOf(part))).toBe("Session persistence");
    expect(inLocale("ko", () => extNameOf({ name: "x-other", displayName: "Other Tool" }))).toBe(
      "Other Tool",
    );
  });

  test("행의 표시 이름은 한국어 이름이고, 이름이 id와 같으면 null이다", () => {
    inLocale("ko", () => {
      expect(rowOf(full(part), INITIAL_WORKBENCH.pending).displayName).toBe("대화 저장");
      expect(rowOf(full({}), INITIAL_WORKBENCH.pending).displayName).toBeNull();
    });
  });
});
