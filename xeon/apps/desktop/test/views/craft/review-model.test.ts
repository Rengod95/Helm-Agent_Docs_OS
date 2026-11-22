import { describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { CardScriptEnv } from "@fresnel/contracts/extensions";
import type { ReviewItem } from "@fresnel/contracts/wire";
import {
  approveDecisionOf,
  approveOutcomeOf,
  baseItemOf,
  codeNoticeOf,
  costViewOf,
  decideFailureOf,
  defaultTargetOf,
  entryKindOf,
  fileRowsOf,
  firstFileOf,
  keeperOf,
  kindsOf,
  missingByProfileOf,
  missingForTarget,
  nextAfter,
  pendingOf,
  placeOf,
  placesOf,
  purposeDraftOf,
  needsTarget,
  rejectDecisionOf,
  reviewKeyOf,
  runLinesOf,
  shortHash,
  shownFilesOf,
  stepFile,
  stepItem,
  versionsOf,
  hookOriginLineOf,
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
const IMPORTED = sample("rvw_sample_imported");
const IMPORTED_BOX = sample("rvw_sample_imported_box");
const IMPORTED_UNKNOWN = sample("rvw_sample_imported_unknown");
const NOTES = sample("rvw_sample_notes");
const SCRIPT_DRAFT = sample("rvw_sample_script_draft");

/** 스크립트 줄마다 [넘어가는 이름, 받지 못하는 이름] */
function envPairsOf(
  item: ReviewItem,
): readonly (readonly [readonly string[], readonly string[]])[] {
  return runLinesOf(item.card).flatMap((line) =>
    line.kind === "script" ? [[line.envNames, line.envNotPassed] as const] : [],
  );
}

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
        uses: ["sandbox_full_access", "network"],
        timeoutMs: 10_000,
        envNames: [],
        envNotPassed: [],
        env: null,
      },
    ]);
  });

  test("a script line keeps the names that pass apart from the declared names that do not (AGE-63, enPp6-b)", () => {
    expect(envPairsOf(FETCH)).toEqual([[[], ["FETCH_API_KEY"]]]);
    expect(envPairsOf(SCRIPT_DRAFT)).toEqual([[["LANG"], ["GITHUB_TOKEN"]]]);
    // 엔진이 싣지 않은 카드는 받지 못하는 이름이 없다
    expect(envPairsOf(LINT)).toEqual([[[], []]]);
  });

  test("a script-only draft (no plugin code) also gets the narrow notice from narrowBeforeApproval", () => {
    expect(SCRIPT_DRAFT.card.runs.code).toBe(false);
    expect(codeNoticeOf(SCRIPT_DRAFT.card)).toEqual({
      mode: "narrow",
      isolated: null,
      serverEnv: false,
      usesUnknown: false,
    });
    expect(
      codeNoticeOf({ ...SCRIPT_DRAFT.card, runs: { code: false, isolated: null } })?.mode,
    ).toBe("open");
  });

  test("the code notice reads the open policy, and the narrow draft only from the card's narrowBeforeApproval", () => {
    expect(codeNoticeOf(LINT.card)).toEqual({
      mode: "open",
      isolated: true,
      serverEnv: false,
      usesUnknown: false,
    });
    // 로컬 MCP 서버의 설정에 환경 변수 이름이 있다(FETCH_API_KEY)
    expect(codeNoticeOf(FETCH.card)?.serverEnv).toBe(true);
    // 승인 전 드래프트: 스크립트의 uses는 승인 뒤의 값(SCRIPT_USES)이어도 카드의 runs가 좁다고 알린다
    expect(codeNoticeOf(DRIVE.card)).toEqual({
      mode: "narrow",
      isolated: true,
      serverEnv: false,
      usesUnknown: false,
    });
    expect(codeNoticeOf({ ...DRIVE.card, runs: { code: true, isolated: true } })?.mode).toBe(
      "open",
    );
    expect(codeNoticeOf(NOTES.card)).toBeNull();
    expect(codeNoticeOf(RULE.card)).toBeNull();
  });

  test("warnings: a missing purpose, project code and an admin lock (a new item has no enforcement change); cost is not a warning", () => {
    expect(warningsOf(DRIVE, false)).toEqual(["purposeMissing"]);
    expect(warningsOf(FETCH, false)).toEqual([]);
    expect(warningsOf(LINT, true)).toEqual(["managedOff", "projectCode"]);
  });
});

describe("cost section (m6R5)", () => {
  const NOTES = sample("rvw_sample_notes");

  test("an update shows what it carries now and how much that changed since the last approved version", () => {
    expect(costViewOf(FETCH)).toEqual({
      kind: "rows",
      always: { tokens: 120, change: 120 },
      onDemand: { tokens: 410, change: 180 },
      tools: 2,
    });
  });

  test("a new item shows what it carries, without a change (the change would be the whole)", () => {
    expect(costViewOf(NOTES)).toEqual({
      kind: "rows",
      always: { tokens: 64, change: null },
      onDemand: { tokens: 900, change: null },
      tools: null,
    });
  });

  test("nothing carried is one line, and no value from the engine is no section", () => {
    expect(costViewOf(LINT)).toEqual({ kind: "none" });
    const unknown: ReviewItem = {
      ...LINT,
      card: {
        ...LINT.card,
        cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
      },
    };
    expect(costViewOf(unknown)).toEqual({ kind: "hidden" });
  });

  test("a removal says only how much less every turn carries", () => {
    const gone: ReviewItem = {
      ...NOTES,
      kind: "remove",
      diff: { ...NOTES.diff, costDelta: { always: -64, onDemand: -900 } },
    };
    expect(costViewOf(gone)).toEqual({
      kind: "rows",
      always: { tokens: null, change: -64 },
      onDemand: { tokens: null, change: -900 },
      tools: null,
    });
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

describe("fourth round (m6R4)", () => {
  test("an imported hook keeps its original command, shell, refs and missing tools on the run line", () => {
    const [line] = runLinesOf(IMPORTED.card);
    expect(line?.kind === "script" ? line.env : null).toEqual({
      command: 'npx prettier --write "$CLAUDE_FILE_PATHS"',
      shell: "bash",
      interpreter: "/opt/homebrew/bin/npx",
      refs: [
        { path: ".prettierrc", hash: expect.stringMatching(/^sha256:/) },
        { path: "package.json", hash: null },
      ],
      refsKnown: true,
      missingTools: [],
      versionHints: [],
      origin: "user",
      originLabel: null,
      fromProject: false,
    });
  });

  test("the code notice tells your-permissions apart from the sandbox setting and from Fresnel-made scripts", () => {
    expect(
      [LINT, FETCH, IMPORTED, IMPORTED_BOX].map((item) => codeNoticeOf(item.card)?.mode),
    ).toEqual(["open", "open", "userFull", "sandboxed"]);
  });

  test("who keeps it: engine-enforced, an observe-only hook the engine runs, or the model's call", () => {
    expect(
      [LINT, IMPORTED, REMOVE, FETCH, NOTES, DRIVE].map((item) => keeperOf(item.card)),
    ).toEqual(["engine", "watch", "watch", "model", "model", "engine"]);
  });

  test("the purpose default comes from the engine's one tool description, else from the card's facts", () => {
    expect(purposeDraftOf(DRIVE.card)).toEqual({ kind: "drive", command: "review", start: false });
    expect(purposeDraftOf(IMPORTED.card)).toEqual({
      kind: "hook",
      place: { group: "tool", side: "after" },
      power: "observe",
    });
    expect(purposeDraftOf(LINT.card)).toEqual({
      kind: "hook",
      place: { group: "tool", side: "before" },
      power: "decide",
    });
    expect(purposeDraftOf(FETCH.card)).toEqual({
      kind: "tools",
      names: ["fetch_page", "fetch_many"],
    });
    expect(purposeDraftOf(NOTES.card)).toEqual({ kind: "skill", name: "release-notes" });
    expect(purposeDraftOf(RULE.card)).toEqual({ kind: "instructions" });
    const oneTool = {
      ...FETCH.card,
      does: {
        ...FETCH.card.does,
        inject:
          FETCH.card.does.inject === null
            ? null
            : {
                ...FETCH.card.does.inject,
                tools: [{ name: "fetch_page", description: " 페이지 하나를 읽는다 " }],
              },
      },
    };
    expect(purposeDraftOf(oneTool)).toEqual({ kind: "toolText", text: "페이지 하나를 읽는다" });
    expect(purposeDraftOf({ ...DRIVE.card, internal: true })).toEqual({ kind: "none" });
  });
});

function envOf(item: ReviewItem): CardScriptEnv {
  const [line] = runLinesOf(item.card);
  if (line?.kind !== "script" || line.env === null) throw new Bug(`no env on ${item.itemId}`);
  return line.env;
}

describe("where an imported hook came from (m6R6)", () => {
  test("a project hook names its folder, an unrecorded one says it is unknown, a user hook adds no line", () => {
    expect(
      [IMPORTED_BOX, IMPORTED_UNKNOWN, IMPORTED].map((item) => hookOriginLineOf(envOf(item))),
    ).toEqual([{ kind: "project", label: "~/code/helm" }, { kind: "unknown" }, null]);
  });

  test("a hook the plugin's own project folder carried reads as the same project line, without a folder", () => {
    const env = envOf(IMPORTED_UNKNOWN);
    expect(hookOriginLineOf({ ...env, origin: "unknown", fromProject: true })).toEqual({
      kind: "project",
      label: null,
    });
    expect(hookOriginLineOf({ ...env, origin: "user", fromProject: false })).toBeNull();
  });

  test("the judging column sums it up once: project code, or unknown origin", () => {
    expect(
      [IMPORTED_BOX, IMPORTED_UNKNOWN, IMPORTED].map((item) => warningsOf(item, false)),
    ).toEqual([["projectCode"], ["hookOriginUnknown"], ["purposeMissing"]]);
  });
});
