import { describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { ReviewItem } from "@fresnel/contracts/wire";
import {
  approveDecisionOf,
  approveOutcomeOf,
  baseItemOf,
  codeNoticeOf,
  decideFailureOf,
  defaultTargetOf,
  entryKindOf,
  fileRowsOf,
  firstFileOf,
  kindsOf,
  missingByProfileOf,
  missingForTarget,
  nextAfter,
  pendingOf,
  placeOf,
  placesOf,
  needsTarget,
  rejectDecisionOf,
  reviewKeyOf,
  runLinesOf,
  shortHash,
  shownFilesOf,
  stepFile,
  stepItem,
  versionsOf,
  warningsOf,
} from "../../../src/views/craft/review/review-model.ts";
import {
  SAMPLE_PROFILES,
  sampleItems,
} from "../../../src/views/craft/review/testing/review-samples.ts";

// Craft 리뷰 화면(C5, craft-flows 6.12)의 순수 값. 표본 항목(review-samples.ts)을 wire 모양 그대로 넣고 값을 견준다.

const ITEMS = sampleItems();

function sample(itemId: string): ReviewItem {
  const found = ITEMS.find((item) => item.itemId === itemId);
  if (found === undefined) throw new Bug(`no sample ${itemId}`);
  return found;
}

const LINT = sample("rvw_sample_lint");
const FETCH = sample("rvw_sample_fetch");
const DRIVE = sample("rvw_sample_drive");
const RULE = sample("rvw_sample_rule");
const REMOVE = sample("rvw_sample_remove");

describe("what the list says the item is", () => {
  test("wire kinds become four screen kinds: a thread-made or rule-added new item is a draft, a folder import is an install", () => {
    expect(
      [LINT, FETCH, DRIVE, RULE, REMOVE].map((item) => [item.itemId, entryKindOf(item)]),
    ).toEqual([
      ["rvw_sample_lint", "install"],
      ["rvw_sample_fetch", "update"],
      ["rvw_sample_drive", "draft"],
      ["rvw_sample_rule", "draft"],
      ["rvw_sample_remove", "remove"],
    ]);
  });

  test("pending items come oldest first and decided ones leave the list", () => {
    const ids = pendingOf(ITEMS).map((item) => item.itemId);
    expect(ids).not.toContain("rvw_sample_fetch_base");
    expect(ids).toEqual(
      ITEMS.filter((item) => item.state === "pending")
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((item) => item.itemId),
    );
  });

  test("kinds follow the card: a hook with a script is Hook only (a script is not an injection), an MCP server is a tool", () => {
    expect(kindsOf(LINT.card)).toEqual(["hook"]);
    expect(kindsOf(FETCH.card)).toEqual(["tool"]);
    expect(kindsOf(DRIVE.card)).toEqual(["drive"]);
  });
});

describe("where a hook attaches", () => {
  test("places come from the hook name, not the card's block position", () => {
    expect(placeOf("tool.call.before")).toEqual({ group: "tool", side: "before" });
    expect(placeOf("boundary.settle.after")).toEqual({ group: "turn", side: "after" });
    expect(placeOf("guard.model.before")).toEqual({ group: "request", side: "before" });
    expect(placeOf("lifecycle.agent.settled")).toEqual({ group: "other", side: null });
    expect(placesOf(LINT.card)).toEqual([{ group: "tool", side: "before" }]);
  });
});

describe("what runs when approved", () => {
  test("a script line carries its command, what it uses, its limit and env names", () => {
    expect(runLinesOf(LINT.card)).toEqual([
      {
        kind: "script",
        name: "check",
        command: "bash hooks/check.sh",
        uses: ["system_tools"],
        timeoutMs: 10_000,
        envNames: [],
      },
    ]);
  });

  test("the code notice adds system tools and network from the scripts' uses", () => {
    expect(codeNoticeOf(LINT.card)).toEqual({
      isolated: true,
      systemTools: true,
      network: false,
      usesUnknown: false,
    });
    expect(codeNoticeOf(RULE.card)).toBeNull();
  });

  test("warnings: a missing purpose, a cost increase, project code and an admin lock (a new item has no enforcement change)", () => {
    expect(warningsOf(DRIVE, false)).toEqual(["purposeMissing"]);
    expect(warningsOf(FETCH, false)).toEqual(["costUp"]);
    expect(warningsOf(LINT, true)).toEqual(["managedOff", "projectCode"]);
  });
});

describe("files against the last approved version", () => {
  test("the previous version's number comes from the approved item whose candidate is this item's base hash", () => {
    expect(baseItemOf(ITEMS, FETCH)?.itemId).toBe("rvw_sample_fetch_base");
    expect(baseItemOf(ITEMS, LINT)).toBeNull();
    expect(versionsOf(FETCH, ITEMS)).toEqual({ now: "1.5.0", before: "1.4.0" });
    expect(versionsOf(LINT, ITEMS)).toEqual({ now: "0.3.0", before: null });
    expect(versionsOf(RULE, ITEMS)).toEqual({ now: null, before: null });
  });

  test("an update compares the engine's base files by sha256: changed, then added, removed, same", () => {
    const rows = fileRowsOf(FETCH);
    expect(rows.map((row) => [row.path, row.change, row.sides.candidate, row.sides.base])).toEqual([
      ["mcp.js", "changed", true, true],
      ["plugin.json", "changed", true, true],
      ["server.js", "changed", true, true],
      ["scripts/warm.ts", "added", true, false],
      ["old-cache.js", "removed", false, true],
      ["README.md", "same", true, true],
    ]);
    expect(firstFileOf(rows)).toBe("mcp.js");
    expect(shownFilesOf(rows).map((row) => row.path)).toEqual([
      "mcp.js",
      "plugin.json",
      "server.js",
      "scripts/warm.ts",
      "old-cache.js",
    ]);
  });

  test("a new plugin's files are all added; an update without base files is all changed and reads only the new side", () => {
    expect(fileRowsOf(LINT).map((row) => row.change)).toEqual(["added", "added", "added"]);
    const rows = fileRowsOf({ kind: FETCH.kind, files: FETCH.files });
    expect(rows.map((row) => row.change)).toEqual([
      "changed",
      "changed",
      "changed",
      "changed",
      "changed",
    ]);
    expect(rows.every((row) => row.sides.candidate && !row.sides.base)).toBe(true);
  });

  test("stepping walks the shown files (removed ones too) and stops at the ends", () => {
    const shown = shownFilesOf(fileRowsOf(FETCH));
    expect(stepFile(shown, "mcp.js", -1)).toBe("mcp.js");
    expect(stepFile(shown, "mcp.js", 1)).toBe("plugin.json");
    expect(stepFile(shown, "scripts/warm.ts", 1)).toBe("old-cache.js");
    expect(stepFile(shown, "old-cache.js", 1)).toBe("old-cache.js");
    expect(stepFile(shown, null, 1)).toBe("mcp.js");
  });

  test("hashes shorten to twelve hex digits", () => {
    expect(shortHash("sha256:0123456789abcdef0123")).toBe("0123456789ab");
    expect(shortHash(null)).toBeNull();
  });
});

describe("deciding", () => {
  test("the target defaults to the creating chat's profile; without one nothing is chosen and a new item cannot be approved yet", () => {
    expect(defaultTargetOf(DRIVE, SAMPLE_PROFILES)).toEqual({
      kind: "profile",
      profileId: "default",
    });
    expect(defaultTargetOf(RULE, SAMPLE_PROFILES)).toEqual({
      kind: "profile",
      profileId: "writing",
    });
    expect(defaultTargetOf(LINT, SAMPLE_PROFILES)).toEqual({ kind: "unset" });
    expect(defaultTargetOf({ originProfileId: "gone" }, SAMPLE_PROFILES)).toEqual({
      kind: "unset",
    });
    expect(needsTarget(LINT, { kind: "unset" })).toBe(true);
    expect(needsTarget(LINT, { kind: "library" })).toBe(false);
    expect(needsTarget(FETCH, { kind: "unset" })).toBe(false);
  });

  test("approval sends a profile or keep-only for a new item, nothing for an update, and the purpose when filled", () => {
    expect(approveDecisionOf(LINT, { kind: "profile", profileId: "default" }, "")).toEqual({
      kind: "approve",
      profileIds: ["default"],
      libraryOnly: false,
    });
    expect(approveDecisionOf(DRIVE, { kind: "library" }, "  PR을 정리한다 ")).toEqual({
      kind: "approve",
      profileIds: [],
      libraryOnly: true,
      purpose: "PR을 정리한다",
    });
    expect(approveDecisionOf(FETCH, { kind: "profile", profileId: "default" }, "")).toEqual({
      kind: "approve",
      profileIds: [],
      libraryOnly: false,
    });
  });

  test("rejecting with a reason sends it back; an empty reason discards", () => {
    expect(rejectDecisionOf("  범위가 넓어요 ")).toEqual({
      kind: "sendBack",
      reason: "범위가 넓어요",
    });
    expect(rejectDecisionOf("   ")).toEqual({ kind: "discard" });
    expect(rejectDecisionOf("가".repeat(2100))).toEqual({
      kind: "sendBack",
      reason: "가".repeat(2000),
    });
  });

  test("failures map from wire codes and connection state", () => {
    expect(decideFailureOf({ kind: "rejected", code: 3656 })).toBe("profileInvalid");
    expect(decideFailureOf({ kind: "rejected", code: 3652 })).toBe("notPending");
    expect(decideFailureOf({ kind: "rejected", code: 9999 })).toBe("failed");
    expect(decideFailureOf({ kind: "offline" })).toBe("offline");
  });

  test("after approval: profile names, and keep-only for a new plugin added to no profile (no restart)", () => {
    expect(approveOutcomeOf(LINT, [], SAMPLE_PROFILES)).toEqual({
      profiles: [],
      library: true,
      missing: [],
    });
    expect(approveOutcomeOf(LINT, ["writing"], SAMPLE_PROFILES)).toEqual({
      profiles: ["글쓰기"],
      library: false,
      missing: [],
    });
    expect(approveOutcomeOf(FETCH, ["default", "x"], SAMPLE_PROFILES)).toEqual({
      profiles: ["기본", "x"],
      library: false,
      missing: [],
    });
  });

  test("the engine's missing plugins come through as a warning, once each", () => {
    expect(approveOutcomeOf(LINT, ["default"], SAMPLE_PROFILES, ["helm", "helm"])).toEqual({
      profiles: ["기본"],
      library: false,
      missing: ["helm"],
    });
  });
});

describe("missing plugins before approval", () => {
  const profiles = [
    { id: "default", plugins: [{ name: "helm" }, { name: "word-count" }] },
    { id: "writing", plugins: [{ name: "word-count" }] },
  ];
  const installed = new Set(["word-count"]);

  test("a profile pointing to a plugin that is not installed lists it; a clean profile is absent", () => {
    const missing = missingByProfileOf(profiles, null, installed);
    expect([...missing.entries()]).toEqual([["default", ["helm"]]]);
  });

  test("the base (common set) counts for every profile", () => {
    const missing = missingByProfileOf(profiles, { plugins: [{ name: "gone" }] }, installed);
    expect([...missing.entries()]).toEqual([
      ["default", ["helm", "gone"]],
      ["writing", ["gone"]],
    ]);
  });

  test("an unread install list says nothing rather than calling everything missing", () => {
    expect(missingByProfileOf(profiles, null, null).size).toBe(0);
  });

  test("the chosen profile's list, without the plugin under review itself", () => {
    const missing = new Map([["default", ["helm", "line-count"]]]);
    expect(
      missingForTarget(missing, { kind: "profile", profileId: "default" }, "line-count"),
    ).toEqual(["helm"]);
    expect(missingForTarget(missing, { kind: "library" }, "line-count")).toEqual([]);
    expect(missingForTarget(missing, { kind: "unset" }, "line-count")).toEqual([]);
  });
});

describe("keyboard", () => {
  const plain = { metaKey: false, ctrlKey: false, altKey: false };

  test("j k arrows a r [ ] map to actions, and modifiers turn them off", () => {
    expect(
      ["j", "ArrowDown", "k", "ArrowUp", "a", "r", "]", "[", "x"].map((key) =>
        reviewKeyOf({ key, ...plain }),
      ),
    ).toEqual(["next", "next", "prev", "prev", "approve", "reject", "nextFile", "prevFile", null]);
    expect(reviewKeyOf({ key: "a", ...plain, metaKey: true })).toBeNull();
  });

  test("list stepping stops at the ends, and after a decision the next row is picked", () => {
    const ids = ["a", "b", "c"];
    expect(stepItem(ids, null, 1)).toBe("a");
    expect(stepItem(ids, "c", 1)).toBe("c");
    expect(stepItem(ids, "b", -1)).toBe("a");
    expect(nextAfter(ids, "b")).toBe("c");
    expect(nextAfter(ids, "c")).toBe("b");
    expect(nextAfter(["a"], "a")).toBeNull();
  });
});
