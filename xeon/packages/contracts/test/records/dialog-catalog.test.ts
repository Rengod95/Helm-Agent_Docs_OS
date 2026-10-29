import { describe, expect, test } from "bun:test";
import { canonicalJson, parse } from "../../src/base/index.ts";
import { NoticeKindSchema, StatusItemSchema, toJsonSchema } from "../../src/capabilities/index.ts";
import {
  DIALOG_EVENT_CATALOG,
  DialogNotifiedSchema,
  EVENT_CATALOG,
  StatusItemRecordSchema,
  ownerOfKind,
  parseEventKind,
} from "../../src/records/index.ts";
import { rawId } from "../helpers/ids.ts";

function noticeKindJson(): unknown {
  const root: unknown = toJsonSchema(DialogNotifiedSchema);
  const properties: unknown =
    typeof root === "object" && root !== null && "properties" in root ? root.properties : undefined;
  const notice: unknown =
    typeof properties === "object" && properties !== null && "notice" in properties
      ? properties.notice
      : undefined;
  if (typeof notice !== "object" || notice === null) return undefined;
  const noticeProperties: unknown = "properties" in notice ? notice.properties : undefined;
  return typeof noticeProperties === "object" &&
    noticeProperties !== null &&
    "kind" in noticeProperties
    ? noticeProperties.kind
    : undefined;
}

const THREAD = rawId("thr", 2);
const ITEM = { id: "core.turn", text: "작업 중", tone: "busy", order: 10 };

describe("dialog event catalog", () => {
  test("dialog.status is volatile and dialog.notified is durable, both at version 1", () => {
    expect(DIALOG_EVENT_CATALOG.map((e) => [e.kind, e.durable, e.version])).toEqual([
      ["dialog.status", false, 1],
      ["dialog.notified", true, 1],
    ]);
  });

  test("owned by cap.dialog and registered in the merged catalog", () => {
    for (const entry of DIALOG_EVENT_CATALOG) {
      expect(ownerOfKind(entry.kind)).toBe("cap.dialog");
      expect(EVENT_CATALOG.some((e) => e.kind === entry.kind)).toBe(true);
      expect(parseEventKind(entry.kind).ok).toBe(true);
    }
  });

  test("the status data is a snapshot of up to 32 items for one thread", () => {
    const status = DIALOG_EVENT_CATALOG[0];
    expect(status).toBeDefined();
    if (status === undefined) return;
    expect(parse(status.payload, { threadId: THREAD, items: [ITEM] }).ok).toBe(true);
    expect(parse(status.payload, { threadId: THREAD, items: [] }).ok).toBe(true);
    const many = Array.from({ length: 33 }, (_, i) => ({ ...ITEM, id: `core.item${i}` }));
    expect(parse(status.payload, { threadId: THREAD, items: many }).ok).toBe(false);
    expect(parse(status.payload, { threadId: rawId("trn", 1), items: [] }).ok).toBe(false);
    expect(parse(status.payload, { threadId: THREAD, items: [{ ...ITEM, id: "core" }] }).ok).toBe(
      false,
    );
  });

  test("the notified payload nests the notice and rejects unknown kinds", () => {
    const notified = DIALOG_EVENT_CATALOG[1];
    expect(notified).toBeDefined();
    if (notified === undefined) return;
    const notice = {
      kind: "approval_waiting",
      title: "승인 대기",
      body: null,
      origin: "core.tools",
    };
    expect(parse(notified.payload, { notice }).ok).toBe(true);
    expect(parse(notified.payload, { notice: { ...notice, kind: "info" } }).ok).toBe(false);
    expect(parse(notified.payload, { notice: { ...notice, title: "x".repeat(121) } }).ok).toBe(
      false,
    );
    expect(parse(notified.payload, { notice: { ...notice, extra: 1 } }).ok).toBe(false);
  });
});

describe("agreement with capabilities/defs/dialog.ts", () => {
  test("status items and notice kinds are the same JSON Schema on both sides", () => {
    expect(canonicalJson(toJsonSchema(StatusItemRecordSchema))).toBe(
      canonicalJson(toJsonSchema(StatusItemSchema)),
    );
    expect(noticeKindJson()).toEqual(toJsonSchema(NoticeKindSchema));
  });
});
