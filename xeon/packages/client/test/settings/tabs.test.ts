import { describe, expect, test } from "bun:test";
import { SettingsTabSchema } from "@xeon/contracts/settings";
import { parse } from "@xeon/contracts";
import { TAB_ORDER, TAB_SPECS } from "../../src/settings/index.ts";

describe("settings tabs", () => {
  test("there are 13 tabs, in the table order, with positions 0..12", () => {
    expect(TAB_ORDER).toEqual([
      "overview",
      "models",
      "budgets",
      "providers",
      "secrets",
      "permissions",
      "sandbox",
      "sessions",
      "tools",
      "plugins",
      "execution",
      "appearance",
      "advanced",
    ]);
    expect(TAB_ORDER.map((id) => TAB_SPECS[id].position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  test("every tab id is a valid SettingsTab and its spec carries the same id", () => {
    for (const id of TAB_ORDER) {
      expect(parse(SettingsTabSchema, id).ok).toBe(true);
      expect(TAB_SPECS[id].id).toBe(id);
    }
  });

  test("labels are the Korean names of the spec table", () => {
    expect(TAB_ORDER.map((id) => TAB_SPECS[id].label)).toEqual([
      "개요",
      "모델",
      "예산과 한도",
      "계정과 제공자",
      "비밀",
      "권한",
      "샌드박스",
      "세션과 컨텍스트",
      "도구와 웹",
      "플러그인과 그룹",
      "실행과 서비스",
      "외관",
      "고급",
    ]);
  });

  test("only budgets and providers have a gauge slot", () => {
    const gauges = TAB_ORDER.filter((id) => TAB_SPECS[id].gauge);
    expect(gauges).toEqual(["budgets", "providers"]);
  });

  test("every tab has a non-empty empty-state sentence", () => {
    for (const id of TAB_ORDER) {
      expect(TAB_SPECS[id].emptyText.trim().length).toBeGreaterThan(0);
      expect(TAB_SPECS[id].emptyText).toContain("없어요");
    }
  });
});
