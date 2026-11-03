import { describe, expect, test } from "bun:test";
import { FIXTURE_ORDER } from "../../../src/workbench/canvas/fixture.ts";
import { hooksInOrder } from "../../../src/workbench/canvas/hooks.ts";
import {
  REL_ORDER,
  matchesRecord,
  relationsOf,
  type RelationContext,
} from "../../../src/workbench/canvas/relations.ts";
import { applyToggle } from "../../../src/workbench/canvas/select.ts";
import type { CanvasSnapshot } from "../../../src/workbench/canvas/types.ts";
import { MOCK, plugin } from "./support.ts";

const ctx = (holder: string | null = "helm"): RelationContext => ({
  order: hooksInOrder(MOCK.plugins, FIXTURE_ORDER),
  drive: { holder, turns: [1, 4] },
});

describe("relation kinds and record patterns", () => {
  test("five kinds in the order the strands are colored", () => {
    expect(REL_ORDER).toEqual(["hook", "cap", "group", "drive", "record"]);
  });

  test("a trailing .* reads as a prefix, anything else must match exactly", () => {
    expect(matchesRecord("grp.learning.memory.*", "grp.learning.memory.written")).toEqual(true);
    expect(matchesRecord("grp.learning.memory.*", "grp.learning.note")).toEqual(false);
    expect(matchesRecord("x.acme-notes.note.indexed", "x.acme-notes.note.indexed")).toEqual(true);
    expect(matchesRecord("x.acme-notes.note.indexed", "x.acme-notes.note")).toEqual(false);
  });
});

describe("relationsOf", () => {
  test("helm links to 13 others: the hook lanes, its group, one capability, one record", () => {
    const rels = relationsOf(plugin(MOCK, "helm"), MOCK, ctx());
    expect(rels.map((r) => [r.other.id, r.kind, r.count])).toEqual([
      ["helm/explore", "group", 1],
      ["helm/panel", "group", 1],
      ["learning", "hook", 1],
      ["learning/ledger", "record", 1],
      ["review", "hook", 1],
      ["review/lens", "hook", 1],
      ["web", "cap", 1],
      ["exa", "cap", 1],
      ["knowledge", "cap", 1],
      ["work", "cap", 1],
      ["secret-scan", "hook", 1],
      ["lint-on-edit", "hook", 1],
      ["notify-done", "hook", 1],
    ]);
  });

  test("a shared hook lane gives the order facts: where the other one runs", () => {
    const rel = relationsOf(plugin(MOCK, "helm"), MOCK, ctx()).find(
      (r) => r.other.id === "review/lens",
    );
    expect(rel?.facts).toEqual([
      {
        labelKey: "rel.fact.hook",
        value: { k: "data", text: "input.agent.before" },
        mono: true,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.dir",
        value: { k: "msg", keys: ["rel.dir.after"] },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.rule",
        value: { k: "msg", keys: ["rel.fold.collect"] },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.order",
        value: { k: "data", text: "2/2" },
        mono: false,
        note: "",
        meter: { value: 2, max: 2 },
      },
      {
        labelKey: "rel.fact.failure",
        value: { k: "msg", keys: ["rel.fail.open"] },
        mono: false,
        note: "",
        meter: null,
      },
    ]);
  });

  test("a capability the other side offers and this one may use: use, optional, providers, peer state", () => {
    const rel = relationsOf(plugin(MOCK, "helm"), MOCK, ctx()).find((r) => r.other.id === "exa");
    expect(rel?.facts).toEqual([
      {
        labelKey: "rel.fact.cap",
        value: { k: "data", text: "web.search" },
        mono: true,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.dir",
        value: { k: "msg", keys: ["rel.dir.use"] },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.need",
        value: { k: "msg", keys: ["rel.need.optional"] },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.providers",
        value: { k: "data", text: "2" },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.peer",
        value: { k: "msg", keys: ["rel.state.off"] },
        mono: false,
        note: "",
        meter: null,
      },
    ]);
  });

  test("a record the other side reads: read direction, the kind, its prefix", () => {
    const rel = relationsOf(plugin(MOCK, "helm"), MOCK, ctx()).find(
      (r) => r.other.id === "learning/ledger",
    );
    expect(rel?.facts).toEqual([
      {
        labelKey: "rel.fact.recordKind",
        value: { k: "data", text: "grp.learning.memory.written" },
        mono: true,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.dir",
        value: { k: "msg", keys: ["rel.dir.read"] },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.prefix",
        value: { k: "data", text: "grp" },
        mono: false,
        note: "",
        meter: null,
      },
    ]);
  });

  test("the group fact shows the group's name, version and how many members are on", () => {
    const rel = relationsOf(plugin(MOCK, "helm"), MOCK, ctx()).find(
      (r) => r.other.id === "helm/panel",
    );
    expect(rel?.facts).toEqual([
      {
        labelKey: "rel.fact.group",
        value: { k: "data", text: "Helm" },
        mono: false,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.version",
        value: { k: "data", text: "0.4.0" },
        mono: true,
        note: "",
        meter: null,
      },
      {
        labelKey: "rel.fact.members",
        value: { k: "data", text: "3/3" },
        mono: false,
        note: "",
        meter: { value: 3, max: 3 },
      },
    ]);
  });

  test("toggling a group member toggles the whole group, so its members count drops to 0/2", () => {
    const off = applyToggle(MOCK, "learning/ledger", false);
    const rel = relationsOf(plugin(off, "learning"), off, ctx()).find((r) => r.kind === "group");
    expect(rel?.other.id).toEqual("learning/ledger");
    expect(rel?.facts[2]).toEqual({
      labelKey: "rel.fact.members",
      value: { k: "data", text: "0/2" },
      mono: false,
      note: "",
      meter: { value: 0, max: 2 },
    });
  });

  test("two drivers give a drive relation: the holder holds, the other contends", () => {
    const pair: CanvasSnapshot = {
      plugins: [plugin(MOCK, "helm"), { ...plugin(MOCK, "web"), drives: true }],
      groups: [],
    };
    const driveOf = (holder: string | null) =>
      relationsOf(plugin(pair, "helm"), pair, {
        order: {},
        drive: { holder, turns: [1, 4] },
      }).filter((r) => r.kind === "drive");
    expect(driveOf("helm").map((r) => r.facts)).toEqual([
      [
        {
          labelKey: "rel.fact.drive",
          value: { k: "msg", keys: ["rel.drive.holds"] },
          mono: false,
          note: "",
          meter: null,
        },
        {
          labelKey: "rel.fact.limit",
          value: { k: "data", text: "1/4" },
          mono: false,
          note: "",
          meter: { value: 1, max: 4 },
        },
      ],
    ]);
    expect(driveOf("web").map((r) => r.facts[0])).toEqual([
      {
        labelKey: "rel.fact.drive",
        value: { k: "msg", keys: ["rel.drive.contend"] },
        mono: false,
        note: "",
        meter: null,
      },
    ]);
  });

  test("a plugin with nothing shared with the rest has no relations", () => {
    expect(relationsOf(plugin(MOCK, "pr-kit"), MOCK, ctx())).toEqual([]);
  });
});
