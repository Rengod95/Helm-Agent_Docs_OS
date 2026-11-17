import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import {
  DraftInfoSchema,
  INVOCABLE_KINDS,
  PLUGIN_WIRE_METHODS,
  PluginChangedParamsSchema,
  PluginDraftFromInstructionParamsSchema,
  PluginGetResultSchema,
  PluginListParamsSchema,
  PluginInvocablesResultSchema,
} from "../../src/wire-settings/wire/plugin.ts";
import { AT, HASH, PLUGIN_CARD } from "./plugin-fixtures.ts";

// M5c-1 플러그인 wire(docs/xeon/review/m5/profile-project-loader.md §3.4, §4.10). 레지스트리 등록은 통합 담당이 하므로 여기서는 표를 직접 본다.

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

/** 호출 항목 하나. `kind`만 바꿔 종류 검사에 쓴다 */
function invocableEntry(kind: string): object {
  return { plugin: "acme-notes", entry: "notes", kind, title: "Notes", reviewedHash: HASH };
}

const DRAFT = {
  draftId: "drf_1",
  name: "acme-notes",
  contentHash: HASH,
  parent: null,
  createdAt: AT,
  originThreadId: "thr_1",
  label: "first draft",
  submittedItemId: null,
};

describe("plugin wire methods (M5c-1)", () => {
  test("the registry table names exactly the ten plugin methods", () => {
    expect(Object.keys(PLUGIN_WIRE_METHODS).toSorted()).toEqual(
      [
        "plugin.draft.create",
        "plugin.draft.discard",
        "plugin.draft.fromInstruction",
        "plugin.draft.list",
        "plugin.get",
        "plugin.invocables",
        "plugin.list",
        "plugin.requestRemove",
        "plugin.revert",
        "plugin.scan",
      ].toSorted(),
    );
  });

  test("plugin.list takes an optional filter with the card origin and card review states", () => {
    const params = PLUGIN_WIRE_METHODS["plugin.list"].params;
    expect(parse(params, {}).ok).toBe(true);
    expect(
      parse(params, { filter: { origin: "project", reviewState: "pending", profileId: "p1" } }).ok,
    ).toBe(true);
    expect(parse(params, { filter: { origin: "unknown" } }).ok).toBe(false);
    expect(parse(params, { filter: { reviewState: "sent_back" } }).ok).toBe(false);
    expect(parse(params, { filter: { extra: true } }).ok).toBe(false);
    roundTrip(PluginListParamsSchema, { filter: { origin: "user" } });
  });

  test("plugin.get result carries the card, versions, source, entries and settings defs", () => {
    const value = {
      card: PLUGIN_CARD,
      versions: [{ hash: HASH, approvedAt: AT, current: true }],
      source: { path: "/home/u/plugins/acme-notes", matchesReviewed: true },
      entries: [
        {
          plugin: "acme-notes",
          entry: "review-notes",
          kind: "command",
          title: "Review notes",
          reviewedHash: HASH,
        },
      ],
      settingsDefs: [
        {
          key: "ext.acme-notes.token",
          label: "Token",
          default: null,
          required: false,
          secret: true,
        },
      ],
    };
    roundTrip(PluginGetResultSchema, value);
    expect(parse(PluginGetResultSchema, { ...value, source: null }).ok).toBe(true);
    expect(parse(PluginGetResultSchema, { ...value, extra: 1 }).ok).toBe(false);
    expect(
      parse(PluginGetResultSchema, {
        ...value,
        versions: [{ hash: "abc", approvedAt: AT, current: true }],
      }).ok,
    ).toBe(false);
  });

  test("invocable entries take the four kinds, and plugin is the whole-plugin entry", () => {
    expect(INVOCABLE_KINDS).toEqual(["skill", "command", "drive", "plugin"]);
    for (const kind of INVOCABLE_KINDS) {
      roundTrip(PluginInvocablesResultSchema, { entries: [invocableEntry(kind)] });
    }
    expect(parse(PluginInvocablesResultSchema, { entries: [invocableEntry("hook")] }).ok).toBe(
      false,
    );
  });

  test("plugin.draft.create returns the draft id, the content hash, the card and the draft info", () => {
    const result = { draftId: "drf_1", contentHash: HASH, card: PLUGIN_CARD, info: DRAFT };
    roundTrip(PLUGIN_WIRE_METHODS["plugin.draft.create"].result, result);
    expect(
      parse(PLUGIN_WIRE_METHODS["plugin.draft.create"].params, { dir: "/tmp/acme-notes" }).ok,
    ).toBe(true);
    expect(
      parse(PLUGIN_WIRE_METHODS["plugin.draft.create"].result, {
        ...result,
        contentHash: "XYZ",
      }).ok,
    ).toBe(false);
  });

  test("draft info keeps its parent link and caps the label at 80 characters", () => {
    roundTrip(DraftInfoSchema, {
      ...DRAFT,
      parent: "drf_0",
      label: null,
      submittedItemId: "rvw_1",
    });
    expect(parse(DraftInfoSchema, { ...DRAFT, label: "a".repeat(80) }).ok).toBe(true);
    expect(parse(DraftInfoSchema, { ...DRAFT, label: "a".repeat(81) }).ok).toBe(false);
  });

  test("plugin.draft.discard takes a draft id and returns an empty object", () => {
    expect(parse(PLUGIN_WIRE_METHODS["plugin.draft.discard"].params, { draftId: "drf_1" }).ok).toBe(
      true,
    );
    expect(parse(PLUGIN_WIRE_METHODS["plugin.draft.discard"].result, {}).ok).toBe(true);
    expect(parse(PLUGIN_WIRE_METHODS["plugin.draft.discard"].result, { draftId: "x" }).ok).toBe(
      false,
    );
  });

  test("plugin.revert returns restored: true and nothing else", () => {
    roundTrip(PLUGIN_WIRE_METHODS["plugin.revert"].result, { restored: true });
    expect(parse(PLUGIN_WIRE_METHODS["plugin.revert"].result, { restored: false }).ok).toBe(false);
  });

  test("plugin.scan takes an optional project id and returns the queued item ids", () => {
    expect(parse(PLUGIN_WIRE_METHODS["plugin.scan"].params, {}).ok).toBe(true);
    expect(parse(PLUGIN_WIRE_METHODS["plugin.scan"].params, { projectId: "prj_1" }).ok).toBe(true);
    roundTrip(PLUGIN_WIRE_METHODS["plugin.scan"].result, { queued: ["rvw_1", "rvw_2"] });
  });

  test("plugin.draft.fromInstruction takes 1 to 2000 characters and an extension-pattern name", () => {
    const params = PluginDraftFromInstructionParamsSchema;
    expect(parse(params, { text: "Answer in Korean." }).ok).toBe(true);
    expect(parse(params, { text: "Answer.", name: "instr-3f9a1c", profileId: "p1" }).ok).toBe(true);
    expect(parse(params, { text: "" }).ok).toBe(false);
    expect(parse(params, { text: "a".repeat(2000) }).ok).toBe(true);
    expect(parse(params, { text: "a".repeat(2001) }).ok).toBe(false);
    expect(parse(params, { text: "x", name: "Bad Name" }).ok).toBe(false);
    roundTrip(PLUGIN_WIRE_METHODS["plugin.draft.fromInstruction"].result, {
      draftId: "drf_2",
      itemId: "rvw_9",
    });
  });

  test("the plugin.changed notification carries only the plugin name", () => {
    roundTrip(PluginChangedParamsSchema, { name: "acme-notes" });
    expect(parse(PluginChangedParamsSchema, { name: "acme-notes", rev: 2 }).ok).toBe(false);
  });
});
