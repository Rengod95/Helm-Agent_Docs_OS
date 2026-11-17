import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  ThreadStartedPayloadSchema,
  ThreadUpdatedPayloadSchema,
} from "../../src/conversation/index.ts";
import {
  CommonInputSchema,
  CommonSetSchema,
  OVERLAY_LIMIT,
  OVERLAY_WIRE_MAX,
  OverlayListSchema,
  OverlayRefSchema,
  PROFILE_ID_PATTERN,
  PROFILE_ISSUE_CODES,
  PROFILE_LIMITS,
  PROFILE_WIRE_METHODS,
  ProfileInputSchema,
  ProfileIssueSchema,
  ProfileListResultSchema,
  ProfileSchema,
  ProfilesFileSchema,
  ThreadProfileViewSchema,
} from "../../src/wire-settings/wire/profile.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

const plugin = { name: "helm" };
const setting = { key: "ext.helm.autoStart", value: "auto" };
const profile = {
  id: "inquiry",
  title: "Inquiry",
  builtin: false,
  plugins: [plugin, { name: "web-exa" }],
  settings: [setting],
  startDrive: "helm",
  updatedAt: "2026-11-17T00:00:00.000Z",
  rev: 2,
};
const common = {
  plugins: [{ name: "fs-tools" }],
  settings: [{ key: "l1.tools.permissionMode", value: "bypass" }],
  updatedAt: "2026-11-17T00:00:00.000Z",
  rev: 1,
};
const { updatedAt: _pu, rev: _pr, builtin: _pb, ...profileInput } = profile;
const threadId = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";

function list(count: number, make: (index: number) => unknown): unknown[] {
  return Array.from({ length: count }, (_, index) => make(index));
}
function pluginsOf(count: number): unknown[] {
  return list(count, (index) => ({ name: `plug-${index}` }));
}
function settingsOf(count: number): unknown[] {
  return list(count, (index) => ({ key: `ext.helm.k${index}`, value: index }));
}
function overlayRefOf(index: number): unknown {
  return { plugin: `tool-${index}` };
}

describe("profile storage (M5c-1 §3.1)", () => {
  test("Profile round trips by value, with ordered plugins, settings, startDrive and builtin", () => {
    roundTrip(ProfileSchema, profile);
    roundTrip(ProfileSchema, { ...profile, startDrive: null, hidden: true });
    expect(parse(ProfileSchema, { ...profile, hidden: "yes" }).ok).toBe(false);
  });

  test("Profile rejects bad ids, unknown fields, pinned plugins and non-key settings", () => {
    expect(parse(ProfileSchema, { ...profile, id: "Bad Id" }).ok).toBe(false);
    expect(parse(ProfileSchema, { ...profile, extra: 1 }).ok).toBe(false);
    expect(parse(ProfileSchema, { ...profile, driveGroup: "helm" }).ok).toBe(false);
    expect(parse(ProfileSchema, { ...profile, plugins: [{ name: "helm", version: "1" }] }).ok).toBe(
      false,
    );
    expect(parse(ProfileSchema, { ...profile, plugins: [{ name: "H" }] }).ok).toBe(false);
    expect(parse(ProfileSchema, { ...profile, settings: [{ key: "loop.max", value: 1 }] }).ok).toBe(
      false,
    );
    const { builtin: _builtin, ...withoutBuiltin } = profile;
    expect(parse(ProfileSchema, withoutBuiltin).ok).toBe(false);
  });

  test("plugin and setting lists stop at 128 entries", () => {
    expect(PROFILE_LIMITS.plugins).toBe(128);
    expect(PROFILE_LIMITS.settings).toBe(128);
    expect(parse(ProfileSchema, { ...profile, plugins: pluginsOf(128) }).ok).toBe(true);
    expect(parse(ProfileSchema, { ...profile, plugins: pluginsOf(129) }).ok).toBe(false);
    expect(parse(ProfileSchema, { ...profile, settings: settingsOf(128) }).ok).toBe(true);
    expect(parse(ProfileSchema, { ...profile, settings: settingsOf(129) }).ok).toBe(false);
  });

  test("ProfilesFile is schemaVersion 2 with common, and stops at 200 profiles", () => {
    expect(PROFILE_LIMITS.profiles).toBe(200);
    roundTrip(ProfilesFileSchema, { schemaVersion: 2, common, profiles: [profile] });
    expect(parse(ProfilesFileSchema, { schemaVersion: 1, profiles: [profile] }).ok).toBe(false);
    expect(parse(ProfilesFileSchema, { schemaVersion: 2, profiles: [profile] }).ok).toBe(false);
    const full = list(200, (index) => ({ ...profile, id: `p-${index}` }));
    expect(parse(ProfilesFileSchema, { schemaVersion: 2, common, profiles: full }).ok).toBe(true);
    expect(
      parse(ProfilesFileSchema, {
        schemaVersion: 2,
        common,
        profiles: [...full, { ...profile, id: "p-200" }],
      }).ok,
    ).toBe(false);
  });

  test("CommonSet round trips and CommonInput refuses storage-owned fields", () => {
    roundTrip(CommonSetSchema, common);
    const { updatedAt: _u, rev: _r, ...input } = common;
    roundTrip(CommonInputSchema, input);
    expect(parse(CommonInputSchema, common).ok).toBe(false);
  });

  test("profile id pattern accepts default and rejects capitals", () => {
    expect(new RegExp(PROFILE_ID_PATTERN).test("default")).toBe(true);
    expect(new RegExp(PROFILE_ID_PATTERN).test("Default")).toBe(false);
  });
});

describe("profile issues (M5c §4.2.7)", () => {
  test("the issue codes are the fifteen in the spec", () => {
    expect([...PROFILE_ISSUE_CODES]).toEqual([
      "plugin_unknown",
      "plugin_not_reviewed",
      "replace_conflict",
      "driver_not_in_list",
      "driver_cannot_drive",
      "driver_unavailable",
      "setting_unknown_key",
      "setting_scope_not_allowed",
      "setting_invalid_value",
      "secret_literal",
      "secret_missing",
      "required_unset",
      "requirement_unmet",
      "managed_forbidden",
      "limit",
    ]);
  });

  test("an issue carries code, severity and the optional names it refers to", () => {
    roundTrip(ProfileIssueSchema, {
      code: "replace_conflict",
      severity: "error",
      plugin: "a-tools",
      other: "b-tools",
      tool: "read",
    });
    expect(parse(ProfileIssueSchema, { code: "nope", severity: "error" }).ok).toBe(false);
    expect(parse(ProfileIssueSchema, { code: "limit", severity: "info" }).ok).toBe(false);
  });
});

describe("profile.* params and results (M5c §3.4)", () => {
  test("profile.put takes a ProfileInput and baseRev (null on create)", () => {
    const params = PROFILE_WIRE_METHODS["profile.put"].params;
    expect(parse(params, { profile: profileInput, baseRev: null }).ok).toBe(true);
    expect(parse(params, { profile: profileInput, baseRev: 2 }).ok).toBe(true);
    expect(parse(params, { profile: profileInput }).ok).toBe(false);
    expect(parse(params, { profile, baseRev: 2 }).ok).toBe(false);
    expect(parse(ProfileInputSchema, { ...profileInput, builtin: true }).ok).toBe(false);
  });

  test("profile.put result carries warnings only", () => {
    roundTrip(PROFILE_WIRE_METHODS["profile.put"].result, {
      profile,
      issues: [{ code: "secret_missing", severity: "warning", key: "ext.helm.token" }],
    });
  });

  test("profile.list round trips with the common set and the list revision", () => {
    roundTrip(ProfileListResultSchema, { profiles: [profile], common, rev: 5 });
    expect(parse(ProfileListResultSchema, { profiles: [profile], rev: 5 }).ok).toBe(false);
  });

  test("profile.get and profile.delete take an id and answer with the stored row", () => {
    expect(parse(PROFILE_WIRE_METHODS["profile.get"].params, { id: "inquiry" }).ok).toBe(true);
    expect(parse(PROFILE_WIRE_METHODS["profile.get"].params, {}).ok).toBe(false);
    roundTrip(PROFILE_WIRE_METHODS["profile.delete"].result, { rev: 3, reassignedThreads: 1 });
    expect(parse(PROFILE_WIRE_METHODS["profile.delete"].result, { rev: 3 }).ok).toBe(false);
  });

  test("profile.clone needs a valid newId", () => {
    const params = PROFILE_WIRE_METHODS["profile.clone"].params;
    expect(parse(params, { id: "inquiry", newId: "inquiry-2", title: "Copy" }).ok).toBe(true);
    expect(parse(params, { id: "inquiry", newId: "Bad Id", title: "Copy" }).ok).toBe(false);
    expect(parse(params, { id: "inquiry", title: "Copy" }).ok).toBe(false);
  });

  test("profile.common.put needs common and a numeric baseRev; get answers with issues", () => {
    const params = PROFILE_WIRE_METHODS["profile.common.put"].params;
    const { updatedAt: _u, rev: _r, ...input } = common;
    expect(parse(params, { common: input, baseRev: 1 }).ok).toBe(true);
    expect(parse(params, { common: input, baseRev: null }).ok).toBe(false);
    expect(parse(params, { common: input }).ok).toBe(false);
    roundTrip(PROFILE_WIRE_METHODS["profile.common.get"].result, { common, issues: [] });
  });

  test("profile.preview takes an id or a draft, not both, and answers with dropsDrive", () => {
    const params = PROFILE_WIRE_METHODS["profile.preview"].params;
    expect(parse(params, { id: "inquiry" }).ok).toBe(true);
    expect(parse(params, { id: "inquiry", threadId: threadId }).ok).toBe(true);
    expect(parse(params, { draft: profileInput }).ok).toBe(true);
    expect(parse(params, {}).ok).toBe(false);
    expect(parse(params, { id: "inquiry", draft: profileInput }).ok).toBe(false);
    const result = PROFILE_WIRE_METHODS["profile.preview"].result;
    const cost = { always: 120, drive: null, onDemand: 40, toolCount: 3, basis: "declared" };
    const base = {
      resolved: [plugin],
      issues: [],
      cost: { total: cost, byPlugin: [{ plugin: "helm", cost }] },
      missingRequired: [{ plugin: "helm", key: "ext.helm.region" }],
      threadsUsing: 2,
    };
    roundTrip(result, { ...base, dropsDrive: null });
    roundTrip(result, {
      ...base,
      permission: { from: "bypass", to: "ask" },
      toolsChanged: { added: ["web.search"], removed: [] },
      cacheImpact: "tool_change_append",
      dropsDrive: { threadCount: 1 },
    });
    expect(parse(result, { ...base, dropsDrive: null, cacheImpact: "append" }).ok).toBe(false);
    expect(parse(result, { ...base })).toMatchObject({ ok: false });
  });

  test("profile.defaultFor takes an optional workspace and answers with a profile id", () => {
    const params = PROFILE_WIRE_METHODS["profile.defaultFor"].params;
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { workspace: "/Users/me/app" }).ok).toBe(true);
    expect(parse(params, { workspace: "" }).ok).toBe(false);
    roundTrip(PROFILE_WIRE_METHODS["profile.defaultFor"].result, { profileId: "default" });
  });

  test("profile.removePlugin needs baseRev and answers with the preview", () => {
    const params = PROFILE_WIRE_METHODS["profile.removePlugin"].params;
    expect(parse(params, { id: "inquiry", plugin: "helm", baseRev: 2 }).ok).toBe(true);
    expect(parse(params, { id: "inquiry", plugin: "helm" }).ok).toBe(false);
    roundTrip(PROFILE_WIRE_METHODS["profile.removePlugin"].result, {
      profile,
      preview: { threadsUsing: 1, dropsDrive: { threadCount: 1 } },
    });
  });

  test("profile.default.reset takes an optional preview flag and reports what changed", () => {
    const params = PROFILE_WIRE_METHODS["profile.default.reset"].params;
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { preview: true }).ok).toBe(true);
    expect(parse(params, { preview: "yes" }).ok).toBe(false);
    roundTrip(PROFILE_WIRE_METHODS["profile.default.reset"].result, {
      profile,
      changed: { plugins: true, settings: false },
      threadsUsing: 0,
    });
  });

  test("thread.setProfile takes a thread id and a profile id and answers with a position", () => {
    const params = PROFILE_WIRE_METHODS["thread.setProfile"].params;
    expect(parse(params, { threadId, profileId: "inquiry" }).ok).toBe(true);
    expect(parse(params, { threadId: "thr_1", profileId: "inquiry" }).ok).toBe(false);
    expect(parse(params, { threadId, profileId: "" }).ok).toBe(false);
    roundTrip(PROFILE_WIRE_METHODS["thread.setProfile"].result, {
      position: { storeId: "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV", seq: 12 },
      preview: { cacheImpact: "none" },
    });
  });

  test("every profile method is an M4 spec, and none is a trial", () => {
    for (const spec of Object.values(PROFILE_WIRE_METHODS)) {
      expect(spec.stage).toBe("M4");
      expect(spec.status).toBe("active");
    }
    expect(Object.keys(PROFILE_WIRE_METHODS).toSorted()).toEqual([
      "profile.clone",
      "profile.common.get",
      "profile.common.put",
      "profile.default.reset",
      "profile.defaultFor",
      "profile.delete",
      "profile.get",
      "profile.list",
      "profile.preview",
      "profile.put",
      "profile.removePlugin",
      "thread.setProfile",
    ]);
  });
});

describe("overlay and the thread profile view (M5c §3.1, §4.3.9)", () => {
  test("OVERLAY_LIMIT is four; turn.start's wire list takes up to OVERLAY_WIRE_MAX so the handler answers overlay.limit", () => {
    expect(OVERLAY_LIMIT).toBe(4);
    expect(OVERLAY_WIRE_MAX).toBe(16);
    // 다섯 개째부터의 한도는 처리기가 `overlay.limit`으로 답한다(스키마가 invalidParams로 먼저 거절하지 않는다)
    expect(parse(OverlayListSchema, list(5, overlayRefOf)).ok).toBe(true);
    expect(parse(OverlayListSchema, list(16, overlayRefOf)).ok).toBe(true);
    expect(parse(OverlayListSchema, list(17, overlayRefOf)).ok).toBe(false);
  });

  test("an overlay ref names a plugin, optionally a draft and an entry, and nothing else", () => {
    roundTrip(OverlayRefSchema, { plugin: "helm" });
    roundTrip(OverlayRefSchema, { plugin: "helm", draftId: "drf_1", entry: "review" });
    expect(parse(OverlayRefSchema, { plugin: "helm", extra: 1 }).ok).toBe(false);
    expect(parse(OverlayRefSchema, { plugin: "H" }).ok).toBe(false);
  });

  test("ThreadProfileView round trips with and without a project, and its overlay marks", () => {
    roundTrip(ThreadProfileViewSchema, {
      profileId: "inquiry",
      profileRev: 2,
      project: null,
      overlay: [],
    });
    roundTrip(ThreadProfileViewSchema, {
      profileId: "inquiry",
      profileRev: 2,
      project: { projectId: "prj_demo", name: "Demo" },
      overlay: [{ plugin: "helm", draft: true, until: "turn" }],
    });
    expect(
      parse(ThreadProfileViewSchema, {
        profileId: "inquiry",
        profileRev: 2,
        project: null,
        overlay: [{ plugin: "helm", draft: false, until: "forever" }],
      }).ok,
    ).toBe(false);
  });
});

describe("thread lifecycle fields (M5c §3.2)", () => {
  test("thread.started takes an optional profileId, and an empty one is refused", () => {
    expect(
      parse(ThreadStartedPayloadSchema, { title: null, forkedFrom: null, profileId: "inquiry" }).ok,
    ).toBe(true);
    expect(parse(ThreadStartedPayloadSchema, { title: null, forkedFrom: null }).ok).toBe(true);
    expect(
      parse(ThreadStartedPayloadSchema, { title: null, forkedFrom: null, profileId: "" }).ok,
    ).toBe(false);
  });

  test("thread.updated takes an optional profileId and an optional absolute workspace", () => {
    expect(parse(ThreadUpdatedPayloadSchema, { profileId: "inquiry" }).ok).toBe(true);
    expect(parse(ThreadUpdatedPayloadSchema, { workspace: "/Users/me/app-wt" }).ok).toBe(true);
    expect(parse(ThreadUpdatedPayloadSchema, { workspace: "" }).ok).toBe(false);
    expect(parse(ThreadUpdatedPayloadSchema, { workspace: null }).ok).toBe(false);
  });
});
