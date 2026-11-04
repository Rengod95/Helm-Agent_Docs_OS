// 확장 저장 관리자(`ExtStorageManager`)를 가짜 세션이 아니라 실제 SQLite 저장소와 실제 투영기 등록부 위에서 돌린다.
// 소유 장부 `xh_ext_tables`가 마이그레이션 밖 DDL 없이 만들어지고, 미리 보기·삭제가 실제 표에 닿는지 본다(X.operations §4.4.7).
import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  ExtensionTablesPortKey,
  ProjectorRegistryPortKey,
  ScopedStorePortKey,
  StoreMigrationsPortKey,
  type PortKey,
  type PortLookup,
} from "@fresnel/contracts/extensions";
import type { DurableEventDraft } from "@fresnel/contracts/records";
import {
  createExtStorageManager,
  type ExtProjection,
  type ExtStorageManager,
} from "@fresnel/ext-host";
import { portAs } from "@fresnel/ext-host/testing";
import { Type } from "typebox";
import { expectOk, newThread, openHarness, type Harness } from "./support/harness.ts";

const PinRow = Type.Object({ id: Type.String(), title: Type.String() });
const MarkRow = Type.Object({ id: Type.String(), label: Type.String() });
const DEFS = {
  pins: { row: PinRow, key: ["id"], perThread: false },
  marks: { row: MarkRow, key: ["id"], perThread: false },
} as const;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const PROJECTION: ExtProjection<typeof DEFS> = {
  version: 1,
  kinds: ["x.notes.pin.added", "x.notes.mark.added"],
  apply(event, tables) {
    const payload = event.payload;
    const record = typeof payload === "object" && payload !== null ? payload : {};
    const id = "id" in record ? textOf(record.id) : "";
    if (event.kind === "x.notes.pin.added") {
      return tables.pins.upsert({ id, title: "title" in record ? textOf(record.title) : "" });
    }
    return tables.marks.upsert({ id, label: "label" in record ? textOf(record.label) : "" });
  },
};

function managerOf(h: Harness): ExtStorageManager {
  const ports: PortLookup = {
    get<Api>(key: PortKey<Api>): Api | undefined {
      if (
        key.name === ProjectorRegistryPortKey.name &&
        key.member === ProjectorRegistryPortKey.member
      ) {
        return portAs(key, h.service.projectors);
      }
      if (
        key.name === ExtensionTablesPortKey.name &&
        key.member === ExtensionTablesPortKey.member
      ) {
        return portAs(key, h.store.service.extensions);
      }
      if (
        key.name === StoreMigrationsPortKey.name &&
        key.member === StoreMigrationsPortKey.member
      ) {
        return portAs(key, h.store.service.migrations);
      }
      if (key.name === ScopedStorePortKey.name && key.member === undefined) {
        return portAs(key, h.store.service);
      }
      return undefined;
    },
  };
  return createExtStorageManager({
    ports,
    now: () => 1_767_571_200_000,
    guard: true,
    onProjectionFailure: () => {},
  });
}

function draftOf(
  h: Harness,
  threadId: ThreadId,
  kind: DurableEventDraft["kind"],
  payload: unknown,
): DurableEventDraft {
  return {
    id: h.ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
  };
}

async function installedWithRows(): Promise<{
  readonly h: Harness;
  readonly manager: ExtStorageManager;
}> {
  const h = await openHarness();
  const { threadId } = newThread(h);
  const manager = managerOf(h);
  expectOk(manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
  const committed = await h.service.ext.commit({
    threadId,
    requestId: "r1",
    drafts: [
      draftOf(h, threadId, "x.notes.pin.added", { id: "a", title: "first" }),
      draftOf(h, threadId, "x.notes.pin.added", { id: "b", title: "second" }),
      draftOf(h, threadId, "x.notes.mark.added", { id: "m", label: "mark" }),
    ],
  });
  expect(committed).toEqual({ status: "committed" });
  return { h, manager };
}

describe("ExtStorageManager on the real store", () => {
  test("defineTables records the ledger and the preview lists real tables with row counts", async () => {
    const { h, manager } = await installedWithRows();
    expect(h.store.raw.query('SELECT "table" FROM xh_ext_tables ORDER BY "table"').all()).toEqual([
      { table: "x_notes_marks" },
      { table: "x_notes_pins" },
    ]);
    expect(manager.preview("notes")).toEqual(
      ok({
        tables: [
          { name: "x_notes_marks", rows: 1 },
          { name: "x_notes_pins", rows: 2 },
        ],
      }),
    );
    expect(manager.preview("other")).toEqual(ok({ tables: [] }));
  });

  test("drop removes the real tables and the ledger rows, and keeps the events", async () => {
    const { h, manager } = await installedWithRows();
    expect(manager.drop("notes")).toEqual(ok({ dropped: ["x_notes_marks", "x_notes_pins"] }));
    const names = Object.keys(h.store.rowCounts());
    expect(names).not.toContain("x_notes_pins");
    expect(names).not.toContain("x_notes_marks");
    expect(h.store.rowCounts()["xh_ext_tables"]).toBe(0);
    expect(manager.preview("notes")).toEqual(ok({ tables: [] }));
    const events = h.store.raw
      .query("SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'x.notes.%'")
      .get();
    expect(events).toEqual({ n: 3 });
    // 지운 뒤 다시 정의하면 표가 다시 생기고, 남은 이벤트에서 투영이 다시 만들어진다(되살아남은 행은 사용자 결정 대기)
    expectOk(manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
    expect(manager.preview("notes")).toEqual(
      ok({
        tables: [
          { name: "x_notes_marks", rows: 1 },
          { name: "x_notes_pins", rows: 2 },
        ],
      }),
    );
  });

  test("drop of an extension with no tables succeeds with nothing dropped", async () => {
    const h = await openHarness();
    const manager = managerOf(h);
    expect(manager.drop("notes")).toEqual(ok({ dropped: [] }));
  });
});
