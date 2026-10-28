import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DurableEventDraft } from "@xeon/contracts/records";
import { Type } from "typebox";
import {
  storageOf,
  type ExtProjection,
  type ExtStorageError,
  type ExtTables,
} from "../../../src/operations/index.ts";
import { createSmokeGroup, type TestHost } from "../../../src/testing/index.ts";
import { assistantStop, makeUnit } from "../../primitives/fixtures/support.ts";
import { recordOf, textOf } from "../../support/guards.ts";
import { envelope } from "../support/fake-session.ts";
import { createStorageHarness } from "../support/harness.ts";

const NoteRow = Type.Object({ id: Type.String(), text: Type.String() });
const NOTE_DEFS = {
  notes: { row: NoteRow, key: ["id"], perThread: false },
} as const;

function projection(extension = "stor-ext"): ExtProjection<typeof NOTE_DEFS> {
  return {
    version: 1,
    kinds: [`x.${extension}.note.added`],
    apply(event, tables) {
      const payload = recordOf(event.payload);
      return tables.notes.upsert({ id: textOf(payload.id), text: textOf(payload.text) });
    },
  };
}

function draftOf(
  t: TestHost,
  thread: ThreadId,
  kind: DurableEventDraft["kind"],
  payload: unknown,
): DurableEventDraft {
  return {
    id: t.ids.next("evt"),
    kind,
    version: 1,
    threadId: thread,
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
  };
}

test("storage: defineTables through storageOf(g) is projected by the core commit", async () => {
  const harness = await createStorageHarness();
  const { t, session } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  const outcomes: (ExtTables<typeof NOTE_DEFS> | ExtStorageError)[] = [];
  await t.host.install(
    makeUnit({ name: "stor-ext" }, (g) => {
      const defined = storageOf(g).defineTables(NOTE_DEFS, projection());
      outcomes.push(defined.ok ? defined.value : defined.error);
    }),
  );
  const tables = outcomes[0];
  expect(tables).toMatchObject({ names: { notes: "x_stor_ext_notes" } });
  expect(session.sql.tableNames()).toContain("x_stor_ext_notes");
  // 소유 장부에 올랐다
  expect(session.sql.rowsOf("xh_ext_tables")).toMatchObject([
    { table: "x_stor_ext_notes", extension: "stor-ext", local: "notes", projection_version: 1 },
  ]);
  expect(session.projectors()).toEqual(["ext.stor-ext"]);

  await harness.port.commit({
    threadId: thread,
    requestId: "add-1",
    drafts: [draftOf(t, thread, "x.stor-ext.note.added", { id: "n1", text: "hello" })],
  });
  expect(session.sql.rowsOf("x_stor_ext_notes")).toMatchObject([{ id: "n1", text: "hello" }]);
  const read =
    tables !== undefined && "read" in tables
      ? tables.read((reader) => reader.notes.list())
      : undefined;
  expect(read).toEqual({ ok: true, value: ok([{ id: "n1", text: "hello" }]) });
});

test("storage: errors from defineTables", async () => {
  const harness = await createStorageHarness();
  const { t } = harness;
  const results: Record<string, ExtStorageError["kind"] | "ok"> = {};
  await t.host.install(
    makeUnit({ name: "stor-err" }, (g) => {
      const storage = storageOf(g);
      const foreign = storage.defineTables(NOTE_DEFS, {
        ...projection(),
        kinds: ["x.other-ext.note.added"],
      });
      results.foreignKind = foreign.ok ? "ok" : foreign.error.kind;
      const reservedDefs = { state: { row: NoteRow, key: ["id"], perThread: false } } as const;
      const reserved = storage.defineTables(reservedDefs, {
        version: 1,
        kinds: [],
        apply: () => ok(undefined),
      });
      results.reserved = reserved.ok ? "ok" : reserved.error.kind;
      const first = storage.defineTables(NOTE_DEFS, projection("stor-err"));
      results.first = first.ok ? "ok" : first.error.kind;
      const second = storage.defineTables(NOTE_DEFS, projection("stor-err"));
      results.second = second.ok ? "ok" : second.error.kind;
    }),
  );
  expect(results).toEqual({
    foreignKind: "kind_not_owned",
    reserved: "reserved_table",
    first: "ok",
    second: "already_defined",
  });
});

test("storage: an isolated extension has no direct storage", async () => {
  const harness = await createStorageHarness();
  const { t } = harness;
  const isolated: string[] = [];
  const base = makeUnit({ name: "stor-iso" }, (g) => {
    const defined = storageOf(g).defineTables(NOTE_DEFS, projection());
    isolated.push(defined.ok ? "ok" : defined.error.kind);
  });
  await t.host.install({ ...base, manifest: { ...base.manifest, isolation: "process" } });
  expect(isolated).toEqual(["isolated"]);
});

test("storage: ports missing means port_unavailable", async () => {
  const harness = await createStorageHarness({ withoutSession: true });
  const { t } = harness;
  const kinds: string[] = [];
  await t.host.install(
    makeUnit({ name: "stor-noport" }, (g) => {
      const defined = storageOf(g).defineTables(NOTE_DEFS, projection());
      kinds.push(defined.ok ? "ok" : defined.error.kind);
    }),
  );
  expect(kinds).toEqual(["port_unavailable"]);
});

test("storage: another extension's table in the ledger is table_owned", async () => {
  const harness = await createStorageHarness();
  const { t, session } = harness;
  // 장부에 같은 테이블 이름을 다른 확장이 이미 올려 두었다
  session.store.scoped("xh").write((tx) => {
    tx.run(
      'CREATE TABLE IF NOT EXISTS "xh_ext_tables" ("table" TEXT NOT NULL, "extension" TEXT NOT NULL, "local" TEXT NOT NULL, "projection_version" INTEGER NOT NULL, "created_at" INTEGER NOT NULL, PRIMARY KEY ("table")) STRICT',
    );
    tx.run(
      'INSERT INTO "xh_ext_tables" ("table", "extension", "local", "projection_version", "created_at") VALUES (?, ?, ?, ?, ?)',
      ["x_stor_ext_notes", "someone-else", "notes", 1, 1],
    );
  });
  const kinds: string[] = [];
  await t.host.install(
    makeUnit({ name: "stor-ext" }, (g) => {
      const defined = storageOf(g).defineTables(NOTE_DEFS, projection());
      kinds.push(defined.ok ? "ok" : defined.error.kind);
    }),
  );
  expect(kinds).toEqual(["table_owned"]);
  expect(session.projectors()).toEqual([]);
});

test("storage: a failing projection rolls the commit back and turns the extension off", async () => {
  const harness = await createStorageHarness();
  const { t, session } = harness;
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "stor-bad" }, (g) => {
      storageOf(g).defineTables(NOTE_DEFS, {
        version: 1,
        kinds: ["x.stor-bad.note.added"],
        apply() {
          throw new Error("projection broke");
        },
      });
    }),
  );
  const result = session.commit([
    envelope(thread, "x.stor-bad.note.added", { id: "n", text: "t" }),
  ]);
  expect(result.committed).toBe(false);
  expect(harness.requests).toEqual(["disable:stor-bad:auto_disable"]);
  expect(harness.policy.autoDisabler.disabled()).toEqual(["ext:stor-bad"]);
});

const NOTE_TABLE = {
  notes: {
    row: Type.Object({ step_id: Type.String(), text: Type.String() }),
    key: ["step_id"],
    perThread: true,
  },
} as const;

function noteProjection(version: number): ExtProjection<typeof NOTE_TABLE> {
  return {
    version,
    kinds: ["grp.smoke-group.note.recorded"],
    apply(event, tables) {
      const record = recordOf(event.payload);
      return tables.notes.upsert({
        step_id: textOf(recordOf(record.subject).id),
        text: textOf(recordOf(record.payload).text),
      });
    },
  };
}

async function fireTurnEnd(t: TestHost, thread: ThreadId, key: string) {
  const stepId = t.ids.next("stp");
  return t.host.dispatch(
    "boundary.step.after",
    {
      stepIndex: 0,
      stepId,
      message: assistantStop,
      toolResults: [],
      messageItemId: t.ids.next("itm"),
      toolResultItemIds: [],
      context: { contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true },
    },
    {
      threadId: thread,
      dispatchKey: key,
      initial: { entries: [], continue: false },
      finalize: (v) => v,
    },
  );
}

test("storage: the smoke group persists its notes in an extension table and keeps them after a restart", async () => {
  const first = await createStorageHarness();
  const thread = first.t.newThread();
  const group = createSmokeGroup({
    ids: first.t.ids,
    extend: (g) => {
      storageOf(g).defineTables(NOTE_TABLE, noteProjection(1));
    },
  });
  await first.t.host.install(group.unit);
  await first.t.host.openThread(thread);
  await first.t.settled();
  const turnEnd = await fireTurnEnd(first.t, thread, "te-1");
  // L1은 boundary chain의 엔트리를 단계 커밋에 넣는다. 같은 일을 연결 포트로 한다
  await first.port.commit({ threadId: thread, requestId: "step-1", drafts: turnEnd.value.entries });
  expect(first.session.sql.rowsOf("x_smoke_group_notes")).toMatchObject([{ text: "step 0" }]);

  // 프로세스 재시작: 투영기 등록만 해제되고 테이블과 이벤트는 남는다
  first.policy.storage.release("smoke-group");
  const second = await createStorageHarness({ session: first.session, records: first.records });
  const group2 = createSmokeGroup({
    ids: second.t.ids,
    extend: (g) => {
      storageOf(g).defineTables(NOTE_TABLE, noteProjection(1));
    },
  });
  await second.t.host.install(group2.unit);
  await second.t.host.openThread(thread);
  await second.t.settled();
  expect(second.session.sql.rowsOf("x_smoke_group_notes")).toHaveLength(1);
  const again = await fireTurnEnd(second.t, thread, "te-2");
  await second.port.commit({ threadId: thread, requestId: "step-2", drafts: again.value.entries });
  const rows = second.session.sql.rowsOf("x_smoke_group_notes");
  expect(rows).toHaveLength(2);
  // 행은 이벤트와 일치한다
  const noteEvents = second.records
    .events(thread)
    .filter((event) => event.kind === "grp.smoke-group.note.recorded");
  expect(noteEvents).toHaveLength(rows.length);
});
