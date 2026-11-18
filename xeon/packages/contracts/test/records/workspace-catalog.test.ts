import { describe, expect, test } from "bun:test";
import { Bug, parse } from "../../src/base/index.ts";
import {
  EVENT_CATALOG,
  WORKSPACE_EVENT_CATALOG,
  ownerOfKind,
  type CatalogEntry,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

// F.records.spec §3.3.3(파일 되감기, 영역 workspace). 다섯 kind의 목록, 버전, 내구 값과 payload 모양을 값으로 확인한다.
const SHA = "a".repeat(64);
const SHA2 = "b".repeat(64);
const blob = { type: "blob", sha256: SHA, size: 12, mediaType: null };
const REWIND = "rwd_k3m9p2qx";
const ITEM = rawId("itm", 1);
const EVENT = rawId("evt", 1);
const EVENT2 = rawId("evt", 2);

const SAMPLES: Readonly<Record<string, Record<string, unknown>>> = {
  "workspace.files_captured": {
    toolCallId: "call_1",
    entries: [
      {
        path: "/w/a.ts",
        first: true,
        before: { state: "saved", blob, mode: 420 },
        afterSha256: SHA2,
      },
      { path: "/w/b.ts", first: true, before: { state: "absent" }, afterSha256: SHA2 },
      {
        path: "/w/c.ts",
        first: true,
        before: { state: "unrestorable", reason: "too_large", size: 17000000 },
        afterSha256: SHA2,
      },
      { path: "/w/d.ts", first: false, before: null, afterSha256: SHA },
    ],
  },
  "workspace.rewind_started": {
    rewindId: REWIND,
    scope: "both",
    targetItemId: ITEM,
    targetEventId: EVENT,
    oldLeafEventId: EVENT2,
    entries: [
      {
        path: "/w/a.ts",
        action: "restore",
        expectedSha256: SHA2,
        targetBefore: { state: "saved", blob, mode: null },
        undoBefore: { state: "absent" },
        outcome: "planned",
        reason: null,
      },
      {
        path: "/w/b.ts",
        action: "delete",
        expectedSha256: SHA2,
        targetBefore: { state: "absent" },
        undoBefore: { state: "saved", blob, mode: 420 },
        outcome: "kept_changed",
        reason: "changed_outside",
      },
    ],
  },
  "workspace.rewind_applied": {
    rewindId: REWIND,
    results: [
      { path: "/w/a.ts", outcome: "restored", reason: null },
      { path: "/w/b.ts", outcome: "failed", reason: "disk_full" },
    ],
  },
  "workspace.rewind_undone": {
    rewindId: REWIND,
    results: [{ path: "/w/a.ts", outcome: "kept_changed", reason: "changed_outside" }],
    conversation: "not_included",
  },
  "workspace.rewind_overwritten": {
    rewindId: REWIND,
    results: [{ path: "/w/b.ts", outcome: "deleted", reason: null }],
  },
};

function capturedWithMode(mode: number): unknown {
  return {
    toolCallId: null,
    entries: [
      {
        path: "/w/a.ts",
        first: true,
        before: { state: "saved", blob, mode },
        afterSha256: SHA2,
      },
    ],
  };
}

function entryOf(kind: string): CatalogEntry {
  const found = WORKSPACE_EVENT_CATALOG.find((entry) => entry.kind === kind);
  if (found === undefined) throw new Bug(`workspace catalog has no ${kind}`);
  return found;
}

function accepts(kind: string, value: unknown): boolean {
  return parse(entryOf(kind).payload, value).ok;
}

describe("workspace catalog", () => {
  test("five kinds, each durable at version 1, owned by cap.workspace", () => {
    expect(WORKSPACE_EVENT_CATALOG.map((e) => [e.kind, e.durable, e.version])).toEqual([
      ["workspace.files_captured", true, 1],
      ["workspace.rewind_started", true, 1],
      ["workspace.rewind_applied", true, 1],
      ["workspace.rewind_undone", true, 1],
      ["workspace.rewind_overwritten", true, 1],
    ]);
    for (const entry of WORKSPACE_EVENT_CATALOG)
      expect(ownerOfKind(entry.kind)).toBe("cap.workspace");
  });

  test("the merged catalog holds the five kinds once", () => {
    const merged: string[] = EVENT_CATALOG.filter((e) => e.kind.startsWith("workspace.")).map(
      (e) => e.kind,
    );
    expect(merged.toSorted()).toEqual(Object.keys(SAMPLES).toSorted());
  });

  test.each(Object.keys(SAMPLES))("%s accepts its sample payload", (kind) => {
    expect(accepts(kind, SAMPLES[kind])).toBe(true);
  });

  test("files_captured: the first write carries the old state, a later write carries null", () => {
    const kind = "workspace.files_captured";
    const first = { path: "/w/a.ts", first: true, before: null, afterSha256: SHA };
    const later = { path: "/w/a.ts", first: false, before: { state: "absent" }, afterSha256: SHA };
    expect(accepts(kind, { toolCallId: null, entries: [first] })).toBe(false);
    expect(accepts(kind, { toolCallId: null, entries: [later] })).toBe(false);
    expect(accepts(kind, { toolCallId: null, entries: [] })).toBe(false);
    expect(
      accepts(kind, {
        toolCallId: null,
        entries: [{ path: "/w/a.ts", first: false, before: null, afterSha256: SHA }],
      }),
    ).toBe(true);
  });

  test("the payloads carry no file content, only paths, hashes and blob references", () => {
    const kind = "workspace.files_captured";
    const base = SAMPLES[kind];
    expect(accepts(kind, { ...base, content: "secret" })).toBe(false);
    const withText = {
      toolCallId: null,
      entries: [{ path: "/w/a.ts", first: false, before: null, afterSha256: SHA, text: "x" }],
    };
    expect(accepts(kind, withText)).toBe(false);
  });

  test("hashes are lowercase hex of 64 characters, paths are 1 to 4096 characters", () => {
    const kind = "workspace.rewind_applied";
    const base = SAMPLES[kind];
    expect(accepts(kind, { ...base, rewindId: "rwd_K3M9P2QX" })).toBe(false);
    expect(accepts(kind, { ...base, rewindId: "rwd_short" })).toBe(false);
    expect(
      accepts(kind, { ...base, results: [{ path: "", outcome: "restored", reason: null }] }),
    ).toBe(false);
    expect(
      accepts(kind, {
        ...base,
        results: [{ path: "x".repeat(4097), outcome: "restored", reason: null }],
      }),
    ).toBe(false);
    const capture = "workspace.files_captured";
    expect(
      accepts(capture, {
        toolCallId: null,
        entries: [{ path: "/w/a.ts", first: false, before: null, afterSha256: SHA.toUpperCase() }],
      }),
    ).toBe(false);
  });

  test("a saved file mode is a permission value from 0 to 4095", () => {
    const kind = "workspace.files_captured";
    expect(accepts(kind, capturedWithMode(420))).toBe(true);
    expect(accepts(kind, capturedWithMode(4095))).toBe(true);
    expect(accepts(kind, capturedWithMode(4096))).toBe(false);
    expect(accepts(kind, capturedWithMode(-1))).toBe(false);
  });

  test("undone reports the conversation state as one of three values", () => {
    const kind = "workspace.rewind_undone";
    for (const conversation of ["restored", "not_included", "moved_on"]) {
      expect(accepts(kind, { ...SAMPLES[kind], conversation })).toBe(true);
    }
    expect(accepts(kind, { ...SAMPLES[kind], conversation: "reverted" })).toBe(false);
  });
});
