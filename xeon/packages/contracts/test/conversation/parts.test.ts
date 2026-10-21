import { describe, expect, test } from "bun:test";
import { Bug, parse } from "../../src/index.ts";
import { fixedIdFactory, must, rawId } from "../helpers/ids.ts";
import {
  ItemIdSchema,
  PartDeltaSchema,
  PartIdSchema,
  PartRecordSchema,
  assignPartIds,
  partIdAt,
  type PartKind,
  type PartRecord,
} from "../../src/conversation/index.ts";

const ITEM = must(ItemIdSchema, rawId("itm", 1));
const OTHER_ITEM = must(ItemIdSchema, rawId("itm", 2));
const PART = must(PartIdSchema, rawId("prt", 1));

const KINDS: readonly PartKind[] = ["thinking", "text", "toolCall"];
const TOOL_IDS: readonly (string | null)[] = [null, null, "call_1"];

describe("assignPartIds", () => {
  test("issues one id per block and keeps the toolCall id", () => {
    const { ids, calls } = fixedIdFactory();
    const out = assignPartIds(
      { itemId: ITEM, kinds: KINDS, toolCallIds: TOOL_IDS, existing: [] },
      ids,
    );
    expect(out.length).toBe(3);
    expect(calls()).toBe(3);
    expect(out.every((a) => a.issued)).toBe(true);
    expect(out.map((a) => a.record.toolCallId)).toEqual([null, null, "call_1"]);
    expect(new Set(out.map((a) => a.record.partId)).size).toBe(3);
    for (const a of out) expect(parse(PartRecordSchema, a.record).ok).toBe(true);
  });

  test("is deterministic when the first result is passed back as existing", () => {
    const first = fixedIdFactory();
    const out1 = assignPartIds(
      { itemId: ITEM, kinds: KINDS, toolCallIds: TOOL_IDS, existing: [] },
      first.ids,
    );
    const second = fixedIdFactory();
    const existing = out1.map((a) => a.record);
    const out2 = assignPartIds(
      { itemId: ITEM, kinds: KINDS, toolCallIds: TOOL_IDS, existing },
      second.ids,
    );
    expect(second.calls()).toBe(0);
    expect(out2.every((a) => !a.issued)).toBe(true);
    expect(out2.map((a) => a.record.partId)).toEqual(out1.map((a) => a.record.partId));
  });

  test("only issues ids for blocks that do not exist yet", () => {
    const first = fixedIdFactory();
    const [head] = assignPartIds(
      { itemId: ITEM, kinds: ["text"], toolCallIds: [null], existing: [] },
      first.ids,
    );
    expect(head).toBeDefined();
    const second = fixedIdFactory();
    const out = assignPartIds(
      {
        itemId: ITEM,
        kinds: ["text", "toolCall"],
        toolCallIds: [null, "call_9"],
        existing: head === undefined ? [] : [head.record],
      },
      second.ids,
    );
    expect(second.calls()).toBe(1);
    expect(out.map((a) => a.issued)).toEqual([false, true]);
  });

  test("ignores existing records of another item", () => {
    const { ids, calls } = fixedIdFactory();
    const foreign: PartRecord = {
      partId: PART,
      itemId: OTHER_ITEM,
      contentIndex: 0,
      kind: "text",
      toolCallId: null,
    };
    assignPartIds({ itemId: ITEM, kinds: ["text"], toolCallIds: [null], existing: [foreign] }, ids);
    expect(calls()).toBe(1);
  });

  test("rejects mismatched lengths, kind conflicts and missing toolCall ids as bugs", () => {
    const { ids } = fixedIdFactory();
    expect(() =>
      assignPartIds({ itemId: ITEM, kinds: ["text"], toolCallIds: [], existing: [] }, ids),
    ).toThrow(Bug);
    const conflict: PartRecord = {
      partId: PART,
      itemId: ITEM,
      contentIndex: 0,
      kind: "text",
      toolCallId: null,
    };
    expect(() =>
      assignPartIds(
        { itemId: ITEM, kinds: ["thinking"], toolCallIds: [null], existing: [conflict] },
        ids,
      ),
    ).toThrow(Bug);
    expect(() =>
      assignPartIds({ itemId: ITEM, kinds: ["toolCall"], toolCallIds: [null], existing: [] }, ids),
    ).toThrow(Bug);
  });
});

describe("partIdAt", () => {
  test("returns the same id on every call and undefined when missing", () => {
    const { ids } = fixedIdFactory();
    const records = assignPartIds(
      { itemId: ITEM, kinds: KINDS, toolCallIds: TOOL_IDS, existing: [] },
      ids,
    ).map((a) => a.record);
    for (let round = 0; round < 3; round += 1) {
      expect(partIdAt(records, ITEM, 1)).toBe(records[1]?.partId);
    }
    expect(partIdAt(records, ITEM, 9)).toBeUndefined();
    expect(partIdAt(records, OTHER_ITEM, 0)).toBeUndefined();
  });
});

describe("part schemas", () => {
  test("PartDelta phases", () => {
    const base = {
      partId: PART,
      itemId: ITEM,
      contentIndex: 0,
      kind: "text",
      delta: "",
    };
    for (const phase of ["start", "delta", "end"]) {
      expect(parse(PartDeltaSchema, { ...base, phase }).ok).toBe(true);
    }
    expect(parse(PartDeltaSchema, { ...base, phase: "middle" }).ok).toBe(false);
  });

  test("PartRecord is closed and index must be a non-negative integer", () => {
    const base = {
      partId: PART,
      itemId: ITEM,
      contentIndex: 0,
      kind: "text",
      toolCallId: null,
    };
    expect(parse(PartRecordSchema, base).ok).toBe(true);
    expect(parse(PartRecordSchema, { ...base, contentIndex: -1 }).ok).toBe(false);
    expect(parse(PartRecordSchema, { ...base, extra: 1 }).ok).toBe(false);
  });
});
