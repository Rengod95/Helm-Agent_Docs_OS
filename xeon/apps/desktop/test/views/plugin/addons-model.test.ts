import { describe, expect, test } from "bun:test";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { groupPlacements } from "../../../src/plugin-ui/placements.ts";
import type { PluginUiState } from "../../../src/plugin-ui/runtime.ts";
import { addonCardsOf, openableScreensOf } from "../../../src/views/plugin/addons-model.ts";
import { appEntryOf, uiEntryOf } from "../../plugin-ui/support.ts";

function stateOf(
  entries: readonly ExtUiEntry[],
  inactive: readonly string[] = [],
  settings: Readonly<Record<string, unknown>> = { "x.ui.apps": true },
): PluginUiState {
  return {
    phase: "ready",
    entries,
    settings,
    groups: groupPlacements(entries, settings),
    inactive: new Set(inactive),
    rootsSkipped: [],
  };
}
const titleOf = (entry: ExtUiEntry): string => entry.title;

describe("addonCardsOf", () => {
  test("only plugins with a screen get a card, sorted by name, with titles as the summary", () => {
    const cards = addonCardsOf(
      stateOf([
        uiEntryOf({ extension: "zeta", id: "b", title: "보드" }),
        uiEntryOf({ extension: "alpha", id: "a", title: "개요" }),
        uiEntryOf({ extension: "alpha", id: "z", title: "기록" }),
        uiEntryOf({ extension: "onlystatus", id: "s", placement: "status", title: "칸" }),
      ]),
      titleOf,
    );
    expect(cards.map((card) => [card.extension, card.initial, card.summary])).toEqual([
      ["alpha", "A", "개요, 기록"],
      ["zeta", "Z", "보드"],
    ]);
    expect(cards[0]?.screens.map((row) => row.key)).toEqual(["alpha/a", "alpha/z"]);
  });

  test("other placements of the same plugin become extras in placement order, not screens", () => {
    const [card] = addonCardsOf(
      stateOf([
        uiEntryOf({ id: "p", title: "쪽" }),
        uiEntryOf({ id: "c", placement: "card", title: "카드", forKind: "x.helm.note" }),
        uiEntryOf({ id: "s", placement: "status", title: "칸" }),
        uiEntryOf({ id: "m", placement: "command", title: "명령" }),
      ]),
      titleOf,
    );
    expect(card?.screens.map((row) => row.id)).toEqual(["p"]);
    expect(card?.extras.map((row) => [row.kind, row.title])).toEqual([
      ["card", "카드"],
      ["status", "칸"],
      ["command", "명령"],
    ]);
  });

  test("problems: invalid beats blocked beats off, and a healthy plugin has none", () => {
    const healthy = addonCardsOf(stateOf([uiEntryOf({ extension: "a" })]), titleOf);
    expect(healthy[0]?.problem).toBeNull();
    const off = addonCardsOf(stateOf([uiEntryOf({ extension: "a" })], ["a"]), titleOf);
    expect(off[0]?.problem).toBe("off");
    const blocked = addonCardsOf(
      stateOf([appEntryOf({ extension: "a" })], [], { "x.ui.apps": false }),
      titleOf,
    );
    expect(blocked[0]?.problem).toBe("blocked");
    const invalid = addonCardsOf(
      stateOf([
        uiEntryOf({ extension: "a", id: "x", state: "invalid" }),
        uiEntryOf({ extension: "a", id: "y" }),
      ]),
      titleOf,
    );
    expect(invalid[0]?.problem).toBe("invalid");
  });

  test("openable screens skip off, blocked and invalid ones", () => {
    const [card] = addonCardsOf(
      stateOf([
        uiEntryOf({ id: "a" }),
        uiEntryOf({ id: "b", state: "disabled" }),
        uiEntryOf({ id: "c", state: "invalid" }),
      ]),
      titleOf,
    );
    expect(card === undefined ? [] : openableScreensOf(card).map((row) => row.id)).toEqual(["a"]);
  });
});
