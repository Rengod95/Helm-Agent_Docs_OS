import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { parseEventKind } from "../../src/records/index.ts";
import {
  GroupRecordSchema,
  RECORD_KIND_PATTERN,
  RECORD_KIND_READ_PATTERN,
  RecordKindDeclJsonSchema,
  isRecordKindOf,
  validateGroupRecord,
  validateManifest,
  type GroupRecord,
  type RecordKindDecl,
} from "../../src/extensions/index.ts";
import { codesOf, groupJson, pluginJson } from "./helpers.ts";

function decl(kind: string): Record<string, unknown> {
  return { kind, version: 1, description: "d", payload: { type: "object" } };
}

describe("record kinds", () => {
  test("prefix violation rejected", () => {
    const foreign = validateManifest(groupJson({ recordKinds: [decl("grp.helm.item.tagged")] }));
    expect(codesOf(foreign.issues)).toEqual(["record_kind_prefix"]);
    const pluginUsingGroupPrefix = validateManifest(
      pluginJson({ recordKinds: [decl("grp.acme-notes.note.synced")] }),
    );
    expect(codesOf(pluginUsingGroupPrefix.issues)).toEqual(["record_kind_prefix"]);
    const threeSegments = validateManifest(
      groupJson({ recordKinds: [decl("grp.learning.proposed")] }),
    );
    expect(codesOf(threeSegments.issues)).toContain("record_kind_prefix");
  });

  test("own prefix accepted", () => {
    expect(
      validateManifest(groupJson({ recordKinds: [decl("grp.learning.skill.proposed")] })).issues,
    ).toEqual([]);
    expect(
      validateManifest(pluginJson({ recordKinds: [decl("x.acme-notes.note.synced")] })).issues,
    ).toEqual([]);
  });

  test("record kind is event kind", () => {
    const pattern = new RegExp(RECORD_KIND_PATTERN);
    for (const kind of ["grp.learning.skill.proposed", "x.acme-notes.note.synced"]) {
      expect(pattern.test(kind)).toBe(true);
      expect(parseEventKind(kind).ok).toBe(true);
    }
    expect(pattern.test("item.recorded")).toBe(false);
  });

  test("read pattern", () => {
    const pattern = new RegExp(RECORD_KIND_READ_PATTERN);
    for (const ok of ["grp.learning.*", "grp.learning.skill.*", "grp.learning.skill.proposed"]) {
      expect(pattern.test(ok)).toBe(true);
    }
    for (const bad of ["grp.*", "grp.learning", "item.*", "grp.learning.skill.*.x", "GRP.a.*"]) {
      expect(pattern.test(bad)).toBe(false);
    }
    const bad = validateManifest(groupJson({ readsRecordKinds: ["grp.*"] }));
    expect(codesOf(bad.issues)).toEqual(["read_kind_invalid"]);
    const ok = validateManifest(groupJson({ readsRecordKinds: ["grp.helm.*"] }));
    expect(ok.issues).toEqual([]);
  });

  test("read own prefix rejected", () => {
    const own = validateManifest(groupJson({ readsRecordKinds: ["grp.learning.*"] }));
    expect(codesOf(own.issues)).toEqual(["read_kind_invalid"]);
    const ownKind = validateManifest(groupJson({ readsRecordKinds: ["grp.learning.skill.*"] }));
    expect(codesOf(ownKind.issues)).toEqual(["read_kind_invalid"]);
  });

  test("isRecordKindOf", () => {
    const group = { kind: "group", name: "learning" } as const;
    const plugin = { kind: "plugin", name: "acme-notes" } as const;
    expect(isRecordKindOf("grp.learning.skill.proposed", group)).toBe(true);
    expect(isRecordKindOf("grp.helm.skill.proposed", group)).toBe(false);
    expect(isRecordKindOf("x.learning.skill.proposed", group)).toBe(false);
    expect(isRecordKindOf("x.acme-notes.note.synced", plugin)).toBe(true);
    expect(isRecordKindOf("grp.acme-notes.note.synced", plugin)).toBe(false);
    expect(isRecordKindOf("grp.learning.proposed", group)).toBe(false);
  });
});

function record(overrides: Partial<GroupRecord> = {}): GroupRecord {
  return {
    groupId: "learning",
    kind: "grp.learning.skill.proposed",
    version: 2,
    subject: { type: "thread", id: "thr_x" },
    payload: { name: "s" },
    ...overrides,
  };
}

describe("validateGroupRecord", () => {
  const registered: RecordKindDecl = {
    kind: "grp.learning.skill.proposed",
    version: 2,
    description: "d",
    payload: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  };

  test("a matching record has no issue", () => {
    expect(validateGroupRecord(record(), registered)).toEqual([]);
  });

  test("payload validated", () => {
    const issues = validateGroupRecord(record({ payload: { name: 1 } }), registered);
    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(codesOf(issues))).toEqual(new Set(["record_payload_invalid"]));
    expect(issues[0]?.severity).toBe("error");
  });

  test("unregistered kind", () => {
    expect(codesOf(validateGroupRecord(record(), undefined))).toEqual(["record_kind_unregistered"]);
    const other: RecordKindDecl = { ...registered, kind: "grp.learning.skill.saved" };
    expect(codesOf(validateGroupRecord(record(), other))).toEqual(["record_kind_unregistered"]);
  });

  test("version unknown", () => {
    const issues = validateGroupRecord(record({ version: 3 }), registered);
    expect(codesOf(issues)).toEqual(["record_version_unknown"]);
    expect(issues[0]?.severity).toBe("warning");
    expect(validateGroupRecord(record({ version: 1 }), registered)).toEqual([]);
  });
});

describe("record schemas", () => {
  test("GroupRecordSchema accepts a record and rejects an event-only kind", () => {
    const ok = {
      groupId: "learning",
      kind: "grp.learning.skill.proposed",
      version: 1,
      subject: { type: "item", id: "itm_x" },
      payload: { a: [1, null] },
    };
    expect(parse(GroupRecordSchema, ok).ok).toBe(true);
    expect(parse(GroupRecordSchema, { ...ok, kind: "item.recorded" }).ok).toBe(false);
    expect(parse(GroupRecordSchema, { ...ok, version: 0 }).ok).toBe(false);
  });

  test("RecordKindDeclJsonSchema carries the payload as a JSON Schema object", () => {
    expect(parse(RecordKindDeclJsonSchema, decl("grp.learning.skill.proposed")).ok).toBe(true);
    expect(
      parse(RecordKindDeclJsonSchema, { ...decl("grp.learning.skill.proposed"), payload: 1 }).ok,
    ).toBe(false);
  });
});
