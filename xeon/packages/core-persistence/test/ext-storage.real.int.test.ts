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
import {
  expectOk,
  newThread,
  openHarness,
  reopenHarness,
  type Harness,
} from "./support/harness.ts";

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
  });

  test("reinstalling after drop gives empty tables, later events apply, and it survives a restart", async () => {
    const { h, manager } = await installedWithRows();
    const { threadId } = newThread(h);
    expectOk(manager.drop("notes"));
    // 다시 설치하면 지운 시점 이전 이벤트는 되살아나지 않는다
    expectOk(manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
    expect(manager.preview("notes")).toEqual(
      ok({
        tables: [
          { name: "x_notes_marks", rows: 0 },
          { name: "x_notes_pins", rows: 0 },
        ],
      }),
    );
    // 그 뒤 새 이벤트는 정상 반영된다
    const committed = await h.service.ext.commit({
      threadId,
      requestId: "r2",
      drafts: [draftOf(h, threadId, "x.notes.pin.added", { id: "c", title: "third" })],
    });
    expect(committed).toEqual({ status: "committed" });
    expect(h.store.raw.query("SELECT id, title FROM x_notes_pins ORDER BY id").all()).toEqual([
      { id: "c", title: "third" },
    ]);
    // 이벤트 원본은 남는다
    expect(
      h.store.raw.query("SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'x.notes.%'").get(),
    ).toEqual({ n: 4 });
    // 재시작 뒤에도 같다
    const restarted = await reopenHarness(h);
    const again = managerOf(restarted);
    expectOk(again.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
    expect(
      restarted.store.raw.query("SELECT id, title FROM x_notes_pins ORDER BY id").all(),
    ).toEqual([{ id: "c", title: "third" }]);
    expect(restarted.store.raw.query("SELECT COUNT(*) AS n FROM x_notes_marks").get()).toEqual({
      n: 0,
    });
  });

  test("a projection version bump after a drop still skips events before the drop", async () => {
    const { h, manager } = await installedWithRows();
    expectOk(manager.drop("notes"));
    expectOk(manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
    const restarted = await reopenHarness(h);
    const again = managerOf(restarted);
    expectOk(
      again
        .storageFor("notes", { isolated: false })
        .defineTables(DEFS, { ...PROJECTION, version: 2 }),
    );
    expect(restarted.store.raw.query("SELECT COUNT(*) AS n FROM x_notes_pins").get()).toEqual({
      n: 0,
    });
  });

  test("a database created with ledger step 1 migrates to step 2 on define and keeps its rows", async () => {
    const h = await openHarness();
    // 이전 버전이 만든 장부(적용된 1단계 그대로)
    expectOk(
      h.store.service.migrations.apply({
        owner: "xh",
        version: 1,
        steps: [
          {
            version: 1,
            sql: [
              `CREATE TABLE "xh_ext_tables" ("table" TEXT NOT NULL, "extension" TEXT NOT NULL, "local" TEXT NOT NULL, "projection_version" INTEGER NOT NULL, "created_at" INTEGER NOT NULL, PRIMARY KEY ("table")) STRICT`,
            ],
          },
        ],
      }),
    );
    const manager = managerOf(h);
    const { threadId } = newThread(h);
    expectOk(manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
    const committed = await h.service.ext.commit({
      threadId,
      requestId: "r1",
      drafts: [draftOf(h, threadId, "x.notes.pin.added", { id: "a", title: "first" })],
    });
    expect(committed).toEqual({ status: "committed" });
    expect(h.store.raw.query("SELECT COUNT(*) AS n FROM xh_ext_tables").get()).toEqual({ n: 2 });
    expect(h.store.raw.query("SELECT COUNT(*) AS n FROM xh_ext_tombstones").get()).toEqual({
      n: 0,
    });
    // 옛 장부에서 올린 뒤에도 지우기와 다시 설치가 같게 동작한다
    expectOk(manager.drop("notes"));
    expectOk(manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION));
    expect(h.store.raw.query("SELECT COUNT(*) AS n FROM x_notes_pins").get()).toEqual({ n: 0 });
  });

  test("drop of an extension with no tables succeeds with nothing dropped", async () => {
    const h = await openHarness();
    const manager = managerOf(h);
    expect(manager.drop("notes")).toEqual(ok({ dropped: [] }));
  });
});
