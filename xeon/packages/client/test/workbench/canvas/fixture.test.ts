import { describe, expect, test } from "bun:test";
import { buildFixture } from "../../../src/workbench/canvas/fixture.ts";
import type { LayerKey } from "../../../src/workbench/canvas/types.ts";
import { MOCK, plugin } from "./support.ts";

const LAYERS: readonly LayerKey[] = ["L1", "L2", "L3", "plugin"];

describe("buildFixture", () => {
  test("77 extensions in 11 groups", () => {
    const snap = buildFixture(77);
    expect(snap.plugins.length).toEqual(77);
    expect(snap.groups.length).toEqual(11);
  });

  test("the first 18 extensions are the mock's, in the mock's order", () => {
    expect(MOCK.plugins.map((p) => p.id)).toEqual([
      "helm",
      "helm/explore",
      "helm/panel",
      "learning",
      "learning/ledger",
      "review",
      "review/lens",
      "web",
      "exa",
      "knowledge",
      "work",
      "cost-router",
      "compact-keep",
      "secret-scan",
      "lint-on-edit",
      "notify-done",
      "acme-notes",
      "pr-kit",
    ]);
    expect(buildFixture(77).plugins.slice(0, 18)).toEqual([...MOCK.plugins]);
  });

  test("the same count gives the same snapshot every time", () => {
    expect(buildFixture(77)).toEqual(buildFixture(77));
  });

  test("ids are unique and every group member is a plugin whose group is that group", () => {
    const snap = buildFixture(77);
    const ids = snap.plugins.map((p) => p.id);
    expect(new Set(ids).size).toEqual(77);
    expect(new Set(snap.groups.map((g) => g.id)).size).toEqual(11);
    const wrong = snap.groups.flatMap((g) =>
      g.members.filter((id) => plugin(snap, id).group !== g.id).map((id) => `${g.id}:${id}`),
    );
    expect(wrong).toEqual([]);
    const grouped = snap.plugins.filter((p) => p.group !== undefined).map((p) => p.id);
    const listed = new Set(snap.groups.flatMap((g) => g.members));
    expect(grouped.filter((id) => !listed.has(id))).toEqual([]);
  });

  test("every required capability has a provider and every failing plugin names a hook it declares", () => {
    const snap = buildFixture(77);
    const provided = new Set(snap.plugins.flatMap((p) => p.provides));
    expect(snap.plugins.flatMap((p) => p.requires ?? []).filter((c) => !provided.has(c))).toEqual(
      [],
    );
    expect(
      snap.plugins.filter((p) => p.health !== undefined && !p.hooks.includes(p.health.hook)),
    ).toEqual([]);
  });

  test("spread across the four layers, with some off, some failing, some drive holders", () => {
    const snap = buildFixture(77);
    expect(LAYERS.map((l) => snap.plugins.filter((p) => p.layer === l).length)).toEqual([
      8, 27, 24, 18,
    ]);
    expect({
      off: snap.plugins.filter((p) => !p.on).length,
      failing: snap.plugins.filter((p) => p.health !== undefined).length,
      autoOff: snap.plugins.filter((p) => p.health?.autoOff === true).length,
      drivers: snap.plugins.filter((p) => p.drives === true).length,
    }).toEqual({ off: 7, failing: 6, autoOff: 1, drivers: 4 });
  });

  test("a count below the mock's 18 is a bug", () => {
    expect(() => buildFixture(17)).toThrow(
      "fixture count must be an integer of at least 18, got 17",
    );
  });
});
