import { describe, expect, test } from "bun:test";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import {
  cardOf,
  commandEntriesOf,
  groupPlacements,
  nativeEntriesOf,
  originTitleOf,
  provenanceOf,
  type PlacedEntry,
} from "../../src/plugin-ui/placements.ts";
import { UI_ALLOW_PROJECT_APPS_KEY, UI_APPS_KEY } from "../../src/plugin-ui/policy-context.ts";
import { appEntryOf, uiEntryOf } from "./support.ts";

const idsOf = (rows: readonly PlacedEntry[]): string[] =>
  rows.map((row) => `${row.entry.extension}/${row.entry.id}`);

describe("groupPlacements", () => {
  test("every placement host gets a list, empty when nothing is placed there", () => {
    const groups = groupPlacements([uiEntryOf({ placement: "card", id: "c" })], {});
    expect(Object.keys(groups).toSorted()).toEqual([
      "card",
      "command",
      "page",
      "panel",
      "settings",
      "status",
    ]);
    expect(groups.page).toEqual([]);
    expect(idsOf(groups.card)).toEqual(["helm/c"]);
  });

  test("items go to their placement and keep disabled and invalid states", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({ id: "off", state: "disabled" }),
        uiEntryOf({ id: "bad", state: "invalid" }),
        uiEntryOf({ id: "panel", placement: "panel" }),
      ],
      {},
    );
    expect(groups.page.map((row) => [row.entry.id, row.entry.state, row.blocked])).toEqual([
      ["bad", "invalid", null],
      ["off", "disabled", null],
    ]);
    expect(groups.panel.map((row) => row.entry.id)).toEqual(["panel"]);
  });

  test("the order inside a placement is by extension, then id, and stable for equal keys", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({ extension: "zeta", id: "a" }),
        uiEntryOf({ extension: "alpha", id: "b" }),
        uiEntryOf({ extension: "alpha", id: "a", title: "first" }),
        uiEntryOf({ extension: "alpha", id: "a", title: "second" }),
      ],
      {},
    );
    expect(groups.page.map((row) => [row.entry.extension, row.entry.id, row.entry.title])).toEqual([
      ["alpha", "a", "first"],
      ["alpha", "a", "second"],
      ["alpha", "b", "상태"],
      ["zeta", "a", "상태"],
    ]);
  });

  test("an app entry is blocked when the project tier has no app permission", () => {
    const groups = groupPlacements([appEntryOf({ id: "graph", trust: "project" })], {});
    expect(groups.page.map((row) => row.blocked)).toEqual(["frame_blocked"]);
  });

  test("an app entry is free when the tier allows apps and the setting permits project apps", () => {
    const groups = groupPlacements(
      [
        appEntryOf({ id: "user-app", trust: "user" }),
        appEntryOf({ id: "project-app", trust: "project" }),
      ],
      { [UI_APPS_KEY]: true, [UI_ALLOW_PROJECT_APPS_KEY]: true },
    );
    expect(groups.page.map((row) => [row.entry.id, row.blocked])).toEqual([
      ["project-app", null],
      ["user-app", null],
    ]);
  });

  test("with no settings every app entry is blocked (x.ui.apps defaults off) and a native entry is not", () => {
    const groups = groupPlacements(
      [appEntryOf({ id: "app", trust: "user" }), uiEntryOf({ id: "native", trust: "user" })],
      {},
    );
    expect(groups.page.map((row) => [row.entry.id, row.blocked])).toEqual([
      ["app", "frame_blocked"],
      ["native", null],
    ]);
  });

  test("x.ui.apps false blocks app entries of every tier and leaves native entries alone", () => {
    const groups = groupPlacements(
      [appEntryOf({ id: "app", trust: "user" }), uiEntryOf({ id: "native", trust: "user" })],
      { [UI_APPS_KEY]: false },
    );
    expect(groups.page.map((row) => [row.entry.id, row.blocked])).toEqual([
      ["app", "frame_blocked"],
      ["native", null],
    ]);
  });

  test("a native entry keeps its tree and is never blocked by the app policy", () => {
    const tree = { type: "Text", props: { content: "화면" } } as const;
    const groups = groupPlacements([uiEntryOf({ id: "native", trust: "project", tree })], {});
    expect(groups.page[0]?.entry.tree).toEqual(tree);
    expect(groups.page[0]?.blocked).toBeNull();
  });
});

describe("nativeEntriesOf", () => {
  const TEXT = { type: "Text", props: { text: "글" } } as const;

  test("keeps only ok native entries with a tree, from extensions that are not inactive", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({ id: "ok", placement: "status", tree: TEXT }),
        uiEntryOf({ id: "off", placement: "status", state: "disabled", tree: TEXT }),
        uiEntryOf({ id: "bare", placement: "status" }),
        appEntryOf({ id: "app", placement: "status" }),
        uiEntryOf({ extension: "other", id: "stopped", placement: "status", tree: TEXT }),
      ],
      {},
    );
    const kept = nativeEntriesOf(groups.status, new Set(["other"])).map(
      (entry) => `${entry.extension}/${entry.id}`,
    );
    expect(kept).toEqual(["helm/ok"]);
  });
});

describe("commandEntriesOf", () => {
  test("keeps ok command entries of extensions that are not inactive, whatever their mode", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({ id: "start", placement: "command", title: "탐구 시작…" }),
        uiEntryOf({ id: "off", placement: "command", state: "disabled" }),
        uiEntryOf({ id: "bad", placement: "command", state: "invalid" }),
        uiEntryOf({ extension: "other", id: "stopped", placement: "command" }),
      ],
      {},
    );
    const kept = commandEntriesOf(groups.command, new Set(["other"])).map(
      (entry) => `${entry.extension}/${entry.id}:${entry.title}`,
    );
    expect(kept).toEqual(["helm/start:탐구 시작…"]);
  });
});

const CARD_TREE: UiNode = { type: "Chip", bind: { text: { path: "/lens" } } };

/** 카드 항목 하나(출처 시험용). 트리가 있어야 카드다 */
const cardEntry = (extension: string, forKind: string): ExtUiEntry =>
  uiEntryOf({ extension, placement: "card", forKind, tree: CARD_TREE });

describe("cardOf and provenanceOf", () => {
  test("cardOf finds the card of the record kind and skips the card when its extension is inactive", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({
          id: "finished",
          placement: "card",
          forKind: "grp.helm.inquiry.finished",
          tree: CARD_TREE,
        }),
      ],
      {},
    );
    expect(cardOf(groups.card, new Set(), "grp.helm.inquiry.finished")?.id).toBe("finished");
    expect(cardOf(groups.card, new Set(), "grp.helm.other")).toBeUndefined();
    expect(cardOf(groups.card, new Set(["helm"]), "grp.helm.inquiry.finished")).toBeUndefined();
  });

  test("a card without a tree is not a card to draw", () => {
    const groups = groupPlacements(
      [uiEntryOf({ id: "bare", placement: "card", forKind: "x.helm.note.saved" })],
      {},
    );
    expect(cardOf(groups.card, new Set(), "x.helm.note.saved")).toBeUndefined();
  });

  test("provenance is grp:<group> for a grp kind with a dot after the group, else ext:<extension>", () => {
    expect(provenanceOf(cardEntry("helm", "grp.helm.inquiry.finished"))).toBe("grp:helm");
    expect(provenanceOf(cardEntry("helm", "x.helm.note.saved"))).toBe("ext:helm");
    expect(provenanceOf(cardEntry("notes", "x.notes.k.v"))).toBe("ext:notes");
    expect(provenanceOf(cardEntry("notes", "grp.helm"))).toBe("ext:notes");
  });

  test("a card over another extension's group kind is labelled with that extension, never with the group", () => {
    expect(provenanceOf(cardEntry("aaa", "grp.helm.inquiry.finished"))).toBe("ext:aaa");
    expect(provenanceOf(cardEntry("helm", "grp.helm.inquiry.finished"))).toBe("grp:helm");
  });

  test("cardOf prefers the card of the kind's owner over name order", () => {
    const groups = groupPlacements(
      [
        cardEntry("aaa", "grp.helm.inquiry.finished"),
        cardEntry("helm", "grp.helm.inquiry.finished"),
      ],
      {},
    );
    const picked = cardOf(groups.card, new Set(), "grp.helm.inquiry.finished");
    expect(picked?.extension).toBe("helm");
    expect(picked === undefined ? null : provenanceOf(picked)).toBe("grp:helm");
  });

  test("with no owner among the cards, cardOf takes the first by name order", () => {
    const groups = groupPlacements(
      [
        cardEntry("zeta", "grp.helm.inquiry.finished"),
        cardEntry("aaa", "grp.helm.inquiry.finished"),
      ],
      {},
    );
    expect(cardOf(groups.card, new Set(), "grp.helm.inquiry.finished")?.extension).toBe("aaa");
  });

  test("cardOf ignores an owner card that is not ok and falls back to the other extension's card", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({
          extension: "helm",
          id: "off",
          placement: "card",
          forKind: "grp.helm.inquiry.finished",
          state: "disabled",
          tree: CARD_TREE,
        }),
        cardEntry("aaa", "grp.helm.inquiry.finished"),
      ],
      {},
    );
    expect(cardOf(groups.card, new Set(), "grp.helm.inquiry.finished")?.extension).toBe("aaa");
  });
});

describe("originTitleOf", () => {
  test("starts with the extension name, then the title without bidi and control characters", () => {
    expect(originTitleOf(uiEntryOf({ extension: "aaa", title: "‮exe.‬ 실행\u0007" }))).toBe(
      "aaa · exe. 실행",
    );
  });

  test("a title that is empty after stripping shows the entry id", () => {
    expect(originTitleOf(uiEntryOf({ extension: "aaa", id: "go", title: "​" }))).toBe("aaa · go");
  });
});
