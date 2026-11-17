import { expect, test } from "bun:test";
import {
  validateManifest,
  type ExtensionManifest,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import { buildPluginCard, type CardSubject } from "../../../src/assembly/plugins/card.ts";
import { diffCards } from "../../../src/assembly/plugins/diff.ts";

// M5c §4.7.2 "하는 일의 차이": 이전 검토본 카드와 후보 카드를 칸마다 비교한다. 순수 함수 시험이다.

const EMPTY_MATERIALS: CardSubject["materials"] = {
  instructions: [],
  skills: [],
  mcpServers: [],
  agents: [],
  commands: [],
};

function manifestOf(declared: Record<string, unknown>): ExtensionManifest {
  const checked = validateManifest({
    schemaVersion: 2,
    name: "kit",
    version: "1.0.0",
    ...declared,
  });
  if (checked.manifest === undefined) throw new Error("the test manifest is invalid");
  return checked.manifest;
}

function cardOf(declared: Record<string, unknown>): PluginCard {
  return buildPluginCard({
    folder: { name: "kit", manifest: manifestOf(declared), materials: EMPTY_MATERIALS },
    origin: { kind: "user" },
    review: { state: "none", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
}

/** 비용 차. 한쪽이라도 모르면 모른다(null)다 */
function delta(prev: number | null, next: number | null): number | null {
  return prev === null || next === null ? null : next - prev;
}

const PLAIN = { purpose: "Keeps the kit" };
const WITH_TOOL = {
  purpose: "Keeps the kit",
  tools: [{ name: "kit_lint", description: "Lints the kit" }],
};
const WITH_DRIVE = {
  purpose: "Keeps the kit",
  plugins: [{ layer: "plugin", hooks: [], drives: true }],
};

test("a new plugin lists what it does as added and has nothing removed or changed", () => {
  const next = cardOf(WITH_TOOL);
  const diff = diffCards(null, next);
  expect(diff.added.some((entry) => entry.row === "inject" && entry.what === "tool:kit_lint")).toBe(
    true,
  );
  expect(diff.removed).toEqual([]);
  expect(diff.changed).toEqual([]);
  expect(diff.enforcementChange).toBeNull();
  // 새 플러그인은 0에서 바뀐 것이라 비용 차가 곧 현재 비용이다
  expect(diff.costDelta).toEqual({ always: next.cost.always, onDemand: next.cost.onDemand });
});

test("the same card yields an empty difference with a zero cost change", () => {
  const card = cardOf(WITH_TOOL);
  const diff = diffCards(card, card);
  expect(diff.added).toEqual([]);
  expect(diff.removed).toEqual([]);
  expect(diff.changed).toEqual([]);
  expect(diff.enforcementChange).toBeNull();
  // 항상 싣는 비용은 0 차이이고, 필요할 때 비용은 모르는 값(null)이라 차이도 모른다
  expect(diff.costDelta).toEqual({ always: 0, onDemand: null });
});

test("a removed tool is listed as removed with its description and the cost change is the difference", () => {
  const prev = cardOf(WITH_TOOL);
  const next = cardOf(PLAIN);
  const diff = diffCards(prev, next);
  expect(diff.removed.map((entry) => entry.what)).toEqual(["tool:kit_lint"]);
  expect(diff.removed[0]?.detail).toBe("Lints the kit");
  expect(diff.added).toEqual([]);
  expect(diff.costDelta.always).toBe(delta(prev.cost.always, next.cost.always));
});

test("a plugin that starts to drive changes the enforcement and adds the drive row", () => {
  const prev = cardOf(PLAIN);
  const next = cardOf(WITH_DRIVE);
  expect(prev.enforcement).toBe("advisory");
  expect(next.enforcement).toBe("enforced");
  const diff = diffCards(prev, next);
  expect(diff.enforcementChange).toEqual({ from: "advisory", to: "enforced" });
  expect(diff.added.some((entry) => entry.row === "drive" && entry.what === "drive:start")).toBe(
    true,
  );
});

test("a removed plugin reports every fact as removed and no fact as added", () => {
  const prev = cardOf(WITH_TOOL);
  const diff = diffCards(prev, null);
  expect(diff.added).toEqual([]);
  expect(diff.changed).toEqual([]);
  expect(diff.removed.some((entry) => entry.what === "tool:kit_lint")).toBe(true);
  expect(diff.enforcementChange).toBeNull();
  expect(diff.costDelta.always).toBe(prev.cost.always === null ? null : -prev.cost.always);
});

test("a changed isolation fact is a changed entry that shows the old and the new value", () => {
  const prev = cardOf(PLAIN);
  // 같은 플러그인이라도 격리 값이 바뀌면 바뀐 칸이다(§4.5.5 `runs.isolated`)
  const next: PluginCard = { ...prev, runs: { code: false, isolated: true } };
  const diff = diffCards(prev, next);
  expect(diff.changed.map((entry) => entry.what)).toEqual(["runs:isolated"]);
  expect(diff.changed[0]?.detail).toBe("isolated=null → isolated=true");
});
