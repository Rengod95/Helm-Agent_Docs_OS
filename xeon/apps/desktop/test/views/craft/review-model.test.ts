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
  nextAfter,
  pendingOf,
  placeOf,
  placesOf,
  rejectDecisionOf,
  reviewKeyOf,
  runLinesOf,
  shortHash,
  stepFile,
  stepItem,
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
const FETCH_BASE = sample("rvw_sample_fetch_base");

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
  test("the base is the approved item whose candidate is this item's base hash", () => {
    expect(baseItemOf(ITEMS, FETCH)?.itemId).toBe("rvw_sample_fetch_base");
    expect(baseItemOf(ITEMS, LINT)).toBeNull();
  });

  test("an update compares sha256 per path: changed, then added, removed, same", () => {
    const rows = fileRowsOf(FETCH, FETCH_BASE);
    expect(rows.map((row) => [row.path, row.change, row.readable])).toEqual([
      ["plugin.json", "changed", true],
      ["server.js", "changed", true],
      ["scripts/warm.ts", "added", true],
      ["old-cache.js", "removed", false],
      ["mcp.js", "same", true],
    ]);
    expect(firstFileOf(rows)).toBe("plugin.json");
  });

  test("a new plugin's files are all added; an update with no known base is all changed", () => {
    expect(fileRowsOf(LINT, null).map((row) => row.change)).toEqual(["added", "added", "added"]);
    expect(fileRowsOf(FETCH, null).map((row) => row.change)).toEqual([
      "changed",
      "changed",
      "changed",
      "changed",
    ]);
  });

  test("stepping files stops at the ends and skips removed files", () => {
    const rows = fileRowsOf(FETCH, FETCH_BASE);
    expect(stepFile(rows, "plugin.json", -1)).toBe("plugin.json");
    expect(stepFile(rows, "plugin.json", 1)).toBe("server.js");
    expect(stepFile(rows, "scripts/warm.ts", 1)).toBe("mcp.js");
    expect(stepFile(rows, "mcp.js", 1)).toBe("mcp.js");
    expect(stepFile(rows, null, 1)).toBe("plugin.json");
  });

  test("hashes shorten to twelve hex digits", () => {
    expect(shortHash("sha256:0123456789abcdef0123")).toBe("0123456789ab");
    expect(shortHash(null)).toBeNull();
  });
});

describe("deciding", () => {
  test("a new plugin defaults to keep-only (the engine refuses a profile before a restart); an update follows its origin", () => {
    expect(defaultTargetOf(DRIVE, SAMPLE_PROFILES)).toEqual({ kind: "library" });
    expect(
      defaultTargetOf({ kind: "update", originProfileId: "writing" }, SAMPLE_PROFILES),
    ).toEqual({ kind: "profile", profileId: "writing" });
    expect(defaultTargetOf({ kind: "update", originProfileId: "gone" }, SAMPLE_PROFILES)).toEqual({
      kind: "library",
    });
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

  test("after approval: profile names, keep-only, and the restart note for a new plugin", () => {
    expect(approveOutcomeOf(LINT, [], SAMPLE_PROFILES)).toEqual({
      profiles: [],
      library: true,
      restart: true,
    });
    expect(approveOutcomeOf(FETCH, ["default", "x"], SAMPLE_PROFILES)).toEqual({
      profiles: ["기본", "x"],
      library: false,
      restart: false,
    });
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
