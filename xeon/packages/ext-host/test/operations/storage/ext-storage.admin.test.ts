// 제거 미리 보기와 삭제(X.operations.spec §4.4.7). 가짜 세션 위에서 소유 장부, 행 수, 장부 정리를 본다.
import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  ExtensionTablesPortKey,
  ProjectorRegistryPortKey,
  ScopedStorePortKey,
  StoreMigrationsPortKey,
  type PortKey,
  type PortLookup,
} from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { fixedIdFactory } from "../../../src/testing/index.ts";
import { portAs } from "../../../src/erase.ts";
import {
  createExtStorageManager,
  type ExtProjection,
  type ExtStorageManager,
} from "../../../src/operations/index.ts";
import { recordOf, textOf } from "../../support/guards.ts";
import { createFakeSession, envelope, type FakeSession } from "../support/fake-session.ts";

const PinRow = Type.Object({ id: Type.String(), title: Type.String() });
const MarkRow = Type.Object({ id: Type.String(), label: Type.String() });
const DEFS = {
  pins: { row: PinRow, key: ["id"], perThread: false },
  marks: { row: MarkRow, key: ["id"], perThread: false },
} as const;

const PROJECTION: ExtProjection<typeof DEFS> = {
  version: 1,
  kinds: ["x.notes.pin.added", "x.notes.mark.added"],
  apply(event, tables) {
    const payload = recordOf(event.payload);
    if (event.kind === "x.notes.pin.added") {
      return tables.pins.upsert({ id: textOf(payload.id), title: textOf(payload.title) });
    }
    return tables.marks.upsert({ id: textOf(payload.id), label: textOf(payload.label) });
  },
};

const ids = fixedIdFactory(8100);

function setup(options: { readonly withTables?: boolean } = {}): {
  readonly session: FakeSession;
  readonly manager: ExtStorageManager;
} {
  const session = createFakeSession();
  const ports: PortLookup = {
    get<Api>(key: PortKey<Api>): Api | undefined {
      if (
        key.name === ProjectorRegistryPortKey.name &&
        key.member === ProjectorRegistryPortKey.member
      ) {
        return portAs(key, session.registry);
      }
      if (
        key.name === ExtensionTablesPortKey.name &&
        key.member === ExtensionTablesPortKey.member
      ) {
        return options.withTables === false ? undefined : portAs(key, session.tables);
      }
      if (
        key.name === StoreMigrationsPortKey.name &&
        key.member === StoreMigrationsPortKey.member
      ) {
        return portAs(key, session.store.migrations);
      }
      if (key.name === ScopedStorePortKey.name && key.member === undefined) {
        return portAs(key, session.store);
      }
      return undefined;
    },
  };
  const manager = createExtStorageManager({
    ports,
    now: () => 1_767_571_200_000,
    guard: true,
    onProjectionFailure: () => {},
  });
  return { session, manager };
}

/** `notes` 확장의 두 테이블을 정의하고, 핀 2개와 표식 1개를 커밋한다 */
function defineWithRows(): { readonly session: FakeSession; readonly manager: ExtStorageManager } {
  const { session, manager } = setup();
  const thread = ids.next("thr");
  const defined = manager.storageFor("notes", { isolated: false }).defineTables(DEFS, PROJECTION);
  expect(defined.ok).toBe(true);
  session.commit([
    envelope(thread, "x.notes.pin.added", { id: "a", title: "first" }),
    envelope(thread, "x.notes.pin.added", { id: "b", title: "second" }),
    envelope(thread, "x.notes.mark.added", { id: "m", label: "mark" }),
  ]);
  return { session, manager };
}

test("preview is empty when no extension table was ever defined", () => {
  const { manager } = setup();
  expect(manager.preview("notes")).toEqual(ok({ tables: [] }));
});

test("preview lists the owned tables with their row counts, in name order", () => {
  const { manager } = defineWithRows();
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

test("preview skips a ledger name whose table is already gone", () => {
  const { session, manager } = defineWithRows();
  session.sql.run('DROP TABLE "x_notes_marks"');
  expect(manager.preview("notes")).toEqual(ok({ tables: [{ name: "x_notes_pins", rows: 2 }] }));
});

test("drop removes the owned tables and their ledger rows, and keeps the events", () => {
  const { session, manager } = defineWithRows();
  expect(manager.drop("notes")).toEqual(ok({ dropped: ["x_notes_marks", "x_notes_pins"] }));
  expect(session.sql.tableNames()).not.toContain("x_notes_pins");
  expect(session.sql.tableNames()).not.toContain("x_notes_marks");
  expect(session.sql.rowsOf("xh_ext_tables")).toEqual([]);
  expect(session.projectors()).toEqual([]);
  expect(session.log).toHaveLength(3);
  expect(manager.preview("notes")).toEqual(ok({ tables: [] }));
});

test("drop refuses a ledger name owned by another extension and deletes nothing", () => {
  const { session, manager } = defineWithRows();
  // 장부에 다른 확장의 테이블 이름이 `notes` 이름으로 올라 있다(장부가 깨진 경우)
  session.store.scoped("xh").write((tx) => {
    tx.run(
      'INSERT INTO "xh_ext_tables" ("table", "extension", "local", "projection_version", "created_at") VALUES (?, ?, ?, ?, ?)',
      ["x_other_pins", "notes", "pins", 1, 1],
    );
  });
  expect(manager.drop("notes")).toEqual(err({ kind: "table_not_owned", table: "x_other_pins" }));
  expect(session.sql.tableNames()).toContain("x_notes_pins");
  expect(session.sql.tableNames()).toContain("x_notes_marks");
  expect(session.sql.rowsOf("xh_ext_tables")).toHaveLength(3);
});

test("drop of an extension without a ledger succeeds with nothing dropped", () => {
  const { manager } = setup();
  expect(manager.drop("ghost")).toEqual(ok({ dropped: [] }));
});

test("drop without the table port is port_unavailable", () => {
  const { manager } = setup({ withTables: false });
  expect(manager.drop("notes")).toEqual(err({ kind: "port_unavailable", port: "fresnel.store" }));
});
