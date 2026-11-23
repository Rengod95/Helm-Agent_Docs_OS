import { describe, expect, test } from "bun:test";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { additionsOf } from "../../../src/views/plugin/app-additions-model.ts";
import { uiEntryOf } from "../../plugin-ui/support.ts";

// "플러그인이 더한 것" 모델(app-additions-model.ts). 값을 그대로 비교한다.

const NO_TITLES: ReadonlyMap<string, string> = new Map();

function groupsOf(
  entries: readonly ExtUiEntry[],
  options: {
    readonly pinned?: readonly string[];
    readonly titles?: ReadonlyMap<string, string>;
    readonly locale?: string;
  } = {},
): ReturnType<typeof additionsOf> {
  return additionsOf({
    entries,
    pinned: options.pinned ?? [],
    titles: options.titles ?? NO_TITLES,
    locale: options.locale ?? "ko",
  });
}

describe("additionsOf", () => {
  test("lists places in the fixed order and only those that have rows", () => {
    const entries = [
      uiEntryOf({ extension: "beta", id: "cmd", placement: "command", title: "명령" }),
      uiEntryOf({ extension: "alpha", id: "side", placement: "panel", title: "패널" }),
      uiEntryOf({ extension: "alpha", id: "chip", placement: "status", title: "칸" }),
    ];
    expect(groupsOf(entries, { pinned: ["beta"] })).toEqual([
      { place: "tab", rows: [{ plugin: "beta", title: "beta", items: [] }] },
      { place: "panel", rows: [{ plugin: "alpha", title: "alpha", items: ["패널"] }] },
      { place: "status", rows: [{ plugin: "alpha", title: "alpha", items: ["칸"] }] },
      { place: "command", rows: [{ plugin: "beta", title: "beta", items: ["명령"] }] },
    ]);
  });

  test("groups one plugin's items for a place into one row, in entry order", () => {
    const entries = [
      uiEntryOf({ extension: "helm", id: "finding", placement: "card", title: "발견" }),
      uiEntryOf({ extension: "helm", id: "review", placement: "card", title: "리뷰" }),
      uiEntryOf({ extension: "helm", id: "other", placement: "card", title: "다른" }),
    ];
    expect(groupsOf(entries, { titles: new Map([["helm", "헬름"]]) })).toEqual([
      { place: "card", rows: [{ plugin: "helm", title: "헬름", items: ["발견", "리뷰", "다른"] }] },
    ]);
  });

  test("leaves out page and settings entries", () => {
    const entries = [
      uiEntryOf({ extension: "viewdemo", id: "notes", placement: "page", title: "화면" }),
      uiEntryOf({ extension: "viewdemo", id: "prefs", placement: "settings", title: "설정" }),
    ];
    expect(groupsOf(entries, { pinned: [] })).toEqual([]);
  });

  test("drops a place that has no rows and keeps the pinned tab rows in pinned order", () => {
    const entries = [
      uiEntryOf({ extension: "gamma", id: "status", placement: "status", title: "상태" }),
    ];
    expect(groupsOf(entries, { pinned: ["zeta", "alpha"] })).toEqual([
      {
        place: "tab",
        rows: [
          { plugin: "zeta", title: "zeta", items: [] },
          { plugin: "alpha", title: "alpha", items: [] },
        ],
      },
      { place: "status", rows: [{ plugin: "gamma", title: "gamma", items: ["상태"] }] },
    ]);
    expect(groupsOf([], { pinned: [] })).toEqual([]);
  });

  test("sorts the rows of a place by shown name, and uses the plugin name when the shown name is blank", () => {
    const entries = [
      uiEntryOf({ extension: "b-plugin", id: "c1", placement: "command", title: "하나" }),
      uiEntryOf({ extension: "a-plugin", id: "c2", placement: "command", title: "둘" }),
      uiEntryOf({ extension: "c-plugin", id: "c3", placement: "command", title: "셋" }),
    ];
    const titles = new Map([
      ["b-plugin", "  가 플러그인  "],
      ["a-plugin", "   "],
      ["c-plugin", "나 플러그인"],
    ]);
    expect(groupsOf(entries, { titles })).toEqual([
      {
        place: "command",
        rows: [
          { plugin: "a-plugin", title: "a-plugin", items: ["둘"] },
          { plugin: "b-plugin", title: "가 플러그인", items: ["하나"] },
          { plugin: "c-plugin", title: "나 플러그인", items: ["셋"] },
        ],
      },
    ]);
  });

  test("shows an item by its title in the locale, and by its id when the title is blank", () => {
    const entries = [
      uiEntryOf({
        extension: "viewdemo",
        id: "card-one",
        placement: "card",
        title: "card.title",
        messages: { ko: { "card.title": "카드 한 줄" } },
      }),
      uiEntryOf({ extension: "viewdemo", id: "card-two", placement: "card", title: "   " }),
    ];
    expect(groupsOf(entries, { locale: "ko" })).toEqual([
      {
        place: "card",
        rows: [{ plugin: "viewdemo", title: "viewdemo", items: ["카드 한 줄", "card-two"] }],
      },
    ]);
  });

  test("gives each plugin its own row on the same place", () => {
    const entries = [
      uiEntryOf({ extension: "one", id: "p", placement: "panel", title: "패널" }),
      uiEntryOf({ extension: "two", id: "p", placement: "panel", title: "패널 둘" }),
    ];
    expect(groupsOf(entries)).toEqual([
      {
        place: "panel",
        rows: [
          { plugin: "one", title: "one", items: ["패널"] },
          { plugin: "two", title: "two", items: ["패널 둘"] },
        ],
      },
    ]);
  });
});
