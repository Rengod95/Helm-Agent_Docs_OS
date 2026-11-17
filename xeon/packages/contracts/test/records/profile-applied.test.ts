import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  CORE_EVENT_KINDS,
  PROFILE_APPLIED_REASONS,
  ProfileAppliedPayloadSchema,
  catalogEntry,
  parseEventKind,
  type ProfileAppliedPayload,
} from "../../src/records/index.ts";

const SHA = "a".repeat(64);
const base = {
  reason: "switched",
  profileId: "inquiry",
  profileRev: 2,
  commonRev: 1,
  added: ["helm"],
  removed: ["web-exa"],
  overlay: [],
} satisfies ProfileAppliedPayload;

describe("profile.applied (M5c-1 §3.2)", () => {
  test("the kind is a core kind in the catalog, durable, at version 1", () => {
    expect(CORE_EVENT_KINDS).toContain("profile.applied");
    const entry = catalogEntry("profile.applied");
    expect(entry.version).toBe(1);
    expect(entry.durable).toBe(true);
    expect(entry.payload).toBe(ProfileAppliedPayloadSchema);
    expect(parseEventKind("profile.applied")).toEqual({
      ok: true,
      value: { origin: "core", area: "profile", name: "applied" },
    });
  });

  test("the reasons are the nine stored strings, in order", () => {
    expect([...PROFILE_APPLIED_REASONS]).toEqual([
      "open",
      "profile_edited",
      "common_edited",
      "switched",
      "overlay_on",
      "overlay_off",
      "plugin_updated",
      "plugin_stopped",
      "profile_missing",
    ]);
  });

  test("a minimal payload and a full payload round trip by value", () => {
    expect(parse(ProfileAppliedPayloadSchema, base)).toEqual({ ok: true, value: base });
    const full = {
      ...base,
      reason: "overlay_on",
      overlay: [{ plugin: "helm", contentHash: SHA, draftId: "drf_1", until: "release" }],
      permission: { from: "ask", to: "bypass" },
      toolsChanged: { added: ["web.search"], removed: [] },
      updated: [{ plugin: "helm", fromHash: SHA, toHash: "b".repeat(64) }],
    } satisfies ProfileAppliedPayload;
    expect(parse(ProfileAppliedPayloadSchema, full)).toEqual({ ok: true, value: full });
  });

  test("an unknown reason, an unknown field, or a fifth overlay entry is refused", () => {
    expect(parse(ProfileAppliedPayloadSchema, { ...base, reason: "nonsense" }).ok).toBe(false);
    expect(parse(ProfileAppliedPayloadSchema, { ...base, extra: 1 }).ok).toBe(false);
    const overlay = { plugin: "helm", contentHash: SHA, until: "turn" };
    expect(
      parse(ProfileAppliedPayloadSchema, { ...base, overlay: [overlay, overlay, overlay, overlay] })
        .ok,
    ).toBe(true);
    expect(
      parse(ProfileAppliedPayloadSchema, {
        ...base,
        overlay: [overlay, overlay, overlay, overlay, overlay],
      }).ok,
    ).toBe(false);
  });

  test("until is turn or release only, and the revisions are non-negative integers", () => {
    const overlay = { plugin: "helm", contentHash: SHA, until: "forever" };
    expect(parse(ProfileAppliedPayloadSchema, { ...base, overlay: [overlay] }).ok).toBe(false);
    expect(parse(ProfileAppliedPayloadSchema, { ...base, profileRev: -1 }).ok).toBe(false);
    expect(parse(ProfileAppliedPayloadSchema, { ...base, commonRev: 1.5 }).ok).toBe(false);
  });
});
