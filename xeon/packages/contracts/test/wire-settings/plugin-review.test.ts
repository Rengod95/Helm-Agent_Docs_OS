import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  PLUGIN_REVIEW_WIRE_METHODS,
  PluginReviewChangedParamsSchema,
  PluginReviewDecideParamsSchema,
  PluginReviewListParamsSchema,
  PluginHistoryResultSchema,
  PluginReviewRequestRollbackParamsSchema,
  PluginReviewSubmitDraftParamsSchema,
  ProfilePlanSchema,
  ReviewDecisionSchema,
  ReviewItemSchema,
  type ReviewItem,
} from "../../src/wire-settings/wire/plugin-review.ts";
import { AT, HASH, PLUGIN_CARD } from "./plugin-fixtures.ts";

// M5c-1 검토 wire(docs/xeon/review/m5/profile-project-loader.md §3.1, §3.4, §3.6). `ReviewDecision.approve.purpose`는 §3.6이 정한 모양이다.

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

const NEW_ITEM = {
  itemId: "rvw_1",
  kind: "new",
  state: "pending",
  name: "acme-notes",
  candidateHash: HASH,
  baseHash: null,
  provenance: "assistant",
  originThreadId: "thr_1",
  originProfileId: "default",
  card: PLUGIN_CARD,
  diff: {
    added: [{ row: "inject", what: "instructions.md", detail: "120 bytes" }],
    removed: [],
    changed: [],
    enforcementChange: null,
    costDelta: { always: 120, onDemand: 80 },
  },
  evidence: [{ kind: "turn", threadId: "thr_1", turnId: "trn_1" }],
  files: [{ path: "instructions.md", bytes: 120, sha256: "b".repeat(64) }],
  createdAt: AT,
  decidedAt: null,
  reason: null,
  removal: null,
} satisfies ReviewItem;

describe("review item (M5c-1)", () => {
  test("a new item round trips by value", () => {
    roundTrip(ReviewItemSchema, NEW_ITEM);
  });

  test("a remove item carries its removal preview and a null candidate hash", () => {
    roundTrip(ReviewItemSchema, {
      ...NEW_ITEM,
      kind: "remove",
      candidateHash: null,
      baseHash: HASH,
      files: [],
      removal: {
        affectedProfiles: [
          { profileId: "default", title: "Default" },
          { profileId: "common", title: "Common" },
        ],
        removes: { state: true, records: null },
        baseCard: PLUGIN_CARD,
      },
    });
  });

  test("provenance is one of the six values and a hand edit is not one of them", () => {
    for (const provenance of [
      "assistant",
      "project",
      "unknown",
      "bundled",
      "user_instruction",
      "migration",
    ]) {
      expect(parse(ReviewItemSchema, { ...NEW_ITEM, provenance }).ok).toBe(true);
    }
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, provenance: "hand_edit" }).ok).toBe(false);
  });

  test("the item state is one of the six states and the kind one of three", () => {
    for (const state of [
      "pending",
      "approved",
      "sent_back",
      "discarded",
      "superseded",
      "withdrawn",
    ]) {
      expect(parse(ReviewItemSchema, { ...NEW_ITEM, state }).ok).toBe(true);
    }
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, state: "rejected" }).ok).toBe(false);
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, kind: "replace" }).ok).toBe(false);
  });

  test("the diff rows are the six card rows and the cost delta may be negative", () => {
    const diff = {
      added: [],
      removed: [],
      changed: [
        { row: "hook", what: "turn.before", detail: "fold chain to first" },
        { row: "replaces", what: "read" },
      ],
      enforcementChange: { from: "advisory", to: "enforced" },
      costDelta: { always: -40, onDemand: null },
    };
    roundTrip(ReviewItemSchema, { ...NEW_ITEM, diff });
    expect(
      parse(ReviewItemSchema, {
        ...NEW_ITEM,
        diff: { ...diff, changed: [{ row: "tools", what: "x" }] },
      }).ok,
    ).toBe(false);
  });

  test("the dependency row (AGE-33) is a diff row next to the card rows", () => {
    const diff = {
      added: [{ row: "dependencies", what: "dependsOn:app->kit", detail: "hard, range ^1.0.0" }],
      removed: [],
      changed: [],
      enforcementChange: null,
      costDelta: { always: null, onDemand: null },
    };
    roundTrip(ReviewItemSchema, { ...NEW_ITEM, diff });
    expect(
      parse(ReviewItemSchema, {
        ...NEW_ITEM,
        diff: { ...diff, added: [{ row: "depends", what: "x" }] },
      }).ok,
    ).toBe(false);
  });

  test("a review item may carry a profile plan, and a plan without a swap or a place is still a plan", () => {
    const plan = { swapOut: ["helm", "kit"], placeAfter: null, driveFrom: "helm" };
    roundTrip(ReviewItemSchema, { ...NEW_ITEM, profilePlan: plan });
    roundTrip(ReviewItemSchema, {
      ...NEW_ITEM,
      profilePlan: { swapOut: [], placeAfter: "helm", driveFrom: null },
    });
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, profilePlan: null }).ok).toBe(false);
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, profilePlan: { ...plan, extra: true } }).ok).toBe(
      false,
    );
  });

  test("the reason is at most 2000 characters and the removal is null or an object", () => {
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, reason: "a".repeat(2000) }).ok).toBe(true);
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, reason: "a".repeat(2001) }).ok).toBe(false);
    expect(parse(ReviewItemSchema, { ...NEW_ITEM, removal: "gone" }).ok).toBe(false);
  });
});

describe("profile plan (AGE-72)", () => {
  test("a plan takes swap-out names of at most sixteen, and nullable placeAfter and driveFrom", () => {
    roundTrip(ProfilePlanSchema, { swapOut: ["helm", "kit"], placeAfter: null, driveFrom: null });
    roundTrip(ProfilePlanSchema, { swapOut: [], placeAfter: "helm", driveFrom: "kit" });
    expect(
      parse(ProfilePlanSchema, {
        swapOut: Array.from({ length: 16 }, (_, index) => `plug-${String(index)}`),
        placeAfter: null,
        driveFrom: null,
      }).ok,
    ).toBe(true);
    expect(
      parse(ProfilePlanSchema, {
        swapOut: Array.from({ length: 17 }, (_, index) => `plug-${String(index)}`),
        placeAfter: null,
        driveFrom: null,
      }).ok,
    ).toBe(false);
    expect(parse(ProfilePlanSchema, { swapOut: ["helm"], driveFrom: null }).ok).toBe(false);
    expect(
      parse(ProfilePlanSchema, { swapOut: ["Helm"], placeAfter: null, driveFrom: null }).ok,
    ).toBe(false);
    expect(
      parse(ProfilePlanSchema, { swapOut: [], placeAfter: null, driveFrom: null, order: 1 }).ok,
    ).toBe(false);
  });

  test("pluginReview.submitDraft takes a draft id with an optional origin profile and plan", () => {
    const params = PluginReviewSubmitDraftParamsSchema;
    roundTrip(params, { draftId: "drf_1" });
    roundTrip(params, {
      draftId: "drf_1",
      originProfileId: "default",
      profilePlan: { swapOut: ["helm", "kit"], placeAfter: null, driveFrom: null },
    });
    expect(parse(params, { draftId: "drf_1", profilePlan: { swapOut: [] } }).ok).toBe(false);
    expect(parse(params, { draftId: "drf_1", originProfileId: "" }).ok).toBe(false);
  });
});

describe("review decision (M5c-1, §3.6)", () => {
  test("approve takes profile ids, libraryOnly and an optional purpose of at most 200 characters", () => {
    roundTrip(ReviewDecisionSchema, {
      kind: "approve",
      profileIds: ["default"],
      libraryOnly: false,
    });
    roundTrip(ReviewDecisionSchema, {
      kind: "approve",
      profileIds: [],
      libraryOnly: true,
      purpose: "Keep notes.",
    });
    expect(
      parse(ReviewDecisionSchema, {
        kind: "approve",
        profileIds: [],
        libraryOnly: true,
        purpose: "a".repeat(200),
      }).ok,
    ).toBe(true);
    expect(
      parse(ReviewDecisionSchema, {
        kind: "approve",
        profileIds: [],
        libraryOnly: true,
        purpose: "a".repeat(201),
      }).ok,
    ).toBe(false);
    expect(parse(ReviewDecisionSchema, { kind: "approve", profileIds: [] }).ok).toBe(false);
  });

  test("sendBack needs a reason of 1 to 2000 characters, and discard takes no fields", () => {
    roundTrip(ReviewDecisionSchema, { kind: "sendBack", reason: "Narrow the hook." });
    expect(parse(ReviewDecisionSchema, { kind: "sendBack", reason: "" }).ok).toBe(false);
    expect(parse(ReviewDecisionSchema, { kind: "sendBack", reason: "a".repeat(2001) }).ok).toBe(
      false,
    );
    roundTrip(ReviewDecisionSchema, { kind: "discard" });
    expect(parse(ReviewDecisionSchema, { kind: "discard", reason: "x" }).ok).toBe(false);
  });

  test("pluginReview.decide takes an item id and a decision", () => {
    const params = PluginReviewDecideParamsSchema;
    expect(
      parse(params, {
        itemId: "rvw_1",
        decision: { kind: "approve", profileIds: [], libraryOnly: true },
      }).ok,
    ).toBe(true);
    expect(parse(params, { itemId: "rvw_1", decision: { kind: "later" } }).ok).toBe(false);
    expect(parse(params, { decision: { kind: "discard" } }).ok).toBe(false);
  });
});

describe("pluginReview methods and notification (M5c-1)", () => {
  test("the registry table names exactly the seven pluginReview methods", () => {
    expect(Object.keys(PLUGIN_REVIEW_WIRE_METHODS).toSorted()).toEqual(
      [
        "pluginReview.decide",
        "pluginReview.file",
        "pluginReview.get",
        "pluginReview.history",
        "pluginReview.list",
        "pluginReview.requestRollback",
        "pluginReview.submitDraft",
      ].toSorted(),
    );
  });

  test("pluginReview.list filters by a review state of the item states", () => {
    const params = PluginReviewListParamsSchema;
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { state: "pending", name: "acme-notes" }).ok).toBe(true);
    expect(parse(params, { state: "draft" }).ok).toBe(false);
  });

  test("pluginReview.file returns the text or null and whether it was truncated", () => {
    const result = PLUGIN_REVIEW_WIRE_METHODS["pluginReview.file"].result;
    roundTrip(result, { path: "instructions.md", text: "Answer briefly.", truncated: false });
    roundTrip(result, { path: "logo.png", text: null, truncated: false });
    expect(parse(result, { path: "a", text: "x" }).ok).toBe(false);
  });

  test("pluginReview.file takes an optional side and reports a version that is no longer kept as missing", () => {
    const params = PLUGIN_REVIEW_WIRE_METHODS["pluginReview.file"].params;
    const result = PLUGIN_REVIEW_WIRE_METHODS["pluginReview.file"].result;
    roundTrip(params, { itemId: "rvw_1", path: "a.md" });
    roundTrip(params, { itemId: "rvw_1", path: "a.md", side: "candidate" });
    roundTrip(params, { itemId: "rvw_1", path: "a.md", side: "base" });
    expect(parse(params, { itemId: "rvw_1", path: "a.md", side: "old" }).ok).toBe(false);
    roundTrip(result, { path: "a.md", text: null, truncated: false, missing: true });
    roundTrip(result, { path: "a.md", text: "x", truncated: true, missing: false });
  });

  test("an update item lists the files of the base version and a card carries the manifest version", () => {
    const withBase = {
      ...NEW_ITEM,
      kind: "update",
      baseHash: HASH,
      card: { ...PLUGIN_CARD, version: "1.2.0" },
      baseFiles: [
        { path: "instructions.md", bytes: 100, sha256: "c".repeat(64) },
        { path: "old.md", bytes: 5, sha256: "d".repeat(64) },
      ],
    } satisfies ReviewItem;
    roundTrip(ReviewItemSchema, withBase);
    expect(parse(ReviewItemSchema, { ...withBase, baseFiles: [{ path: "x" }] }).ok).toBe(false);
    expect(parse(ReviewItemSchema, { ...withBase, card: { ...PLUGIN_CARD, version: 3 } }).ok).toBe(
      false,
    );
  });

  test("pluginReview.decide returns the item and the applied profile ids", () => {
    roundTrip(PLUGIN_REVIEW_WIRE_METHODS["pluginReview.decide"].result, {
      item: { ...NEW_ITEM, state: "approved", decidedAt: AT },
      appliedTo: ["default"],
    });
  });

  test("the pluginReview.changed notification carries the item id and its new state", () => {
    roundTrip(PluginReviewChangedParamsSchema, { itemId: "rvw_1", state: "approved" });
    expect(parse(PluginReviewChangedParamsSchema, { itemId: "rvw_1", state: "done" }).ok).toBe(
      false,
    );
  });
});

describe("plugin history and rollback review (AGE-76)", () => {
  const ENTRY = {
    at: AT,
    event: "rollback",
    version: "0.1.0",
    contentHash: HASH,
    baseHash: null,
    itemId: "rvw_2",
    actor: "user",
    summary: "Keeps notes",
    current: true,
    kept: true,
  };

  test("a history result keeps every entry field and the block reason", () => {
    roundTrip(PluginHistoryResultSchema, { entries: [ENTRY], blocked: null });
    roundTrip(PluginHistoryResultSchema, { entries: [], blocked: "builtin" });
  });

  test("a history entry refuses an event or block outside the lists", () => {
    expect(
      parse(PluginHistoryResultSchema, { entries: [{ ...ENTRY, event: "install" }], blocked: null })
        .ok,
    ).toBe(false);
    expect(parse(PluginHistoryResultSchema, { entries: [], blocked: "locked" }).ok).toBe(false);
  });

  test("a rollback request names a content hash, not a version text", () => {
    const params = PluginReviewRequestRollbackParamsSchema;
    roundTrip(params, { name: "acme-notes", contentHash: HASH });
    expect(parse(params, { name: "acme-notes", contentHash: "0.1.0" }).ok).toBe(false);
  });

  test("a review item may carry the rollback preview", () => {
    const item = {
      ...NEW_ITEM,
      kind: "update",
      baseHash: HASH,
      rollback: { fromVersion: "0.2.0", toVersion: "0.1.0", savedState: true },
    };
    roundTrip(ReviewItemSchema, item);
    expect(
      parse(ReviewItemSchema, { ...item, rollback: { toVersion: "0.1.0", savedState: true } }).ok,
    ).toBe(false);
  });
});
