import { expect, test } from "bun:test";
import { Type } from "typebox";
import { hostOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit, rejectionOf, snapshotOf, type ManifestInput } from "./fixtures/support.ts";

// M3-REQ-23(커밋 직렬화, CAS)과 M3-REQ-24(상태와 레코드의 원자 커밋)

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const counterDef = { state: { schema: CounterSchema, initial: { n: 0 }, version: 1 } };
const noteKinds: ManifestInput["recordKinds"] = [
  {
    kind: "grp.sq-rec.note.made",
    version: 1,
    description: "note",
    payload: {
      type: "object",
      properties: { n: { type: "integer" } },
      required: ["n"],
      additionalProperties: false,
    },
  },
];

type Host = Awaited<ReturnType<typeof createTestHost>>;

function fire(t: Host, thread: ReturnType<Host["newThread"]>, key: string) {
  return t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

test("updateState queues overlapping updates, so none is lost", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "sq-update", points: ["boundary.settle.after"], def: counterDef }, (g) => {
      g.on("boundary.settle.after", async () => {
        const host = hostOf(g);
        await Promise.all([1, 2, 3].map(() => host.updateState((prev) => ({ n: prev.n + 1 }))));
      });
    }),
  );
  await fire(t, thread, "k");
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ scopeId: "sq-update", rev: 3, doc: { n: 3 } }]);
});

test("overlapping commits keep CAS: the first wins and the second sees state_conflict", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const outcomes: string[] = [];
  await t.host.install(
    makeUnit({ name: "sq-cas", points: ["boundary.settle.after"], def: counterDef }, (g) => {
      g.on("boundary.settle.after", async () => {
        const first = g.commit({ n: 1 });
        const second = g.commit({ n: 2 });
        const third = g.commit({ n: 3 });
        const failures = await Promise.all(
          [first, second, third].map((pending) => rejectionOf(() => pending)),
        );
        outcomes.push(
          ...failures.map((failure) => (failure instanceof Error ? failure.message : "ok")),
        );
      });
    }),
  );
  await fire(t, thread, "k");
  expect(outcomes).toEqual([
    "ok",
    "state of sq-cas changed; read it again",
    "state of sq-cas changed; read it again",
  ]);
  // 저장소는 첫 커밋 하나만 받았다
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ rev: 1, doc: { n: 1 } }]);
});

test("a store-level conflict is retried once by updateState and surfaces from commit", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: { update?: unknown; commit?: string } = {};
  await t.host.install(
    makeUnit({ name: "sq-store", points: ["boundary.settle.after"], def: counterDef }, (g) => {
      g.on("boundary.settle.after", async () => {
        t.records.failNext("state_conflict");
        const updated = await hostOf(g).updateState((prev) => ({ n: prev.n + 10 }));
        seen.update = updated.ok ? updated.value : updated.error.kind;
        t.records.failNext("state_conflict");
        const failure = await rejectionOf(() => g.commit({ n: 99 }));
        seen.commit = failure instanceof Error ? failure.message : "ok";
      });
    }),
  );
  await fire(t, thread, "k");
  expect(seen).toEqual({ update: { n: 10 }, commit: "state of sq-store changed; read it again" });
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ rev: 1, doc: { n: 10 } }]);
});

test("updateState returns state_conflict as a value when the retry conflicts too", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  let kind = "";
  await t.host.install(
    makeUnit({ name: "sq-twice", points: ["boundary.settle.after"], def: counterDef }, (g) => {
      g.on("boundary.settle.after", async () => {
        let calls = 0;
        const done = await hostOf(g).updateState((prev) => {
          calls += 1;
          // 첫 적용 안에서 다음 커밋도 거부하도록 걸어 둔다
          t.records.failNext("state_conflict");
          return { n: prev.n + calls };
        });
        kind = done.ok ? "ok" : done.error.kind;
      });
    }),
  );
  await fire(t, thread, "k");
  expect(kind).toBe("state_conflict");
});

test("commitWith writes the state and the records in one transaction", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const subject = { type: "thread" as const, id: thread };
  await t.host.install(
    makeUnit(
      {
        name: "sq-rec",
        kind: "group",
        points: ["boundary.settle.after"],
        def: counterDef,
        recordKinds: noteKinds,
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          await hostOf(g).commitWith({ n: 1 }, [
            { kind: "grp.sq-rec.note.made", subject, payload: { n: 1 } },
          ]);
        });
      },
    ),
  );
  await t.settled();
  const before = t.records.commitCalls;
  await fire(t, thread, "k");
  expect(t.records.commitCalls - before).toBe(1);
  expect(
    t.records
      .events(thread)
      .map((event) => event.kind)
      .filter((kind) => kind !== "scope.changed"),
  ).toEqual(["grp.sq-rec.state.committed", "grp.sq-rec.note.made"]);
});

test("a conflicting commitWith leaves no record behind", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const subject = { type: "thread" as const, id: thread };
  let message = "";
  await t.host.install(
    makeUnit(
      {
        name: "sq-rec",
        kind: "group",
        points: ["boundary.settle.after"],
        def: counterDef,
        recordKinds: noteKinds,
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          t.records.failNext("state_conflict");
          const failure = await rejectionOf(() =>
            hostOf(g).commitWith({ n: 1 }, [
              { kind: "grp.sq-rec.note.made", subject, payload: { n: 1 } },
            ]),
          );
          message = failure instanceof Error ? failure.message : "ok";
        });
      },
    ),
  );
  await t.settled();
  await fire(t, thread, "k");
  expect(message).toBe("state of sq-rec changed; read it again");
  expect(t.records.events(thread).filter((event) => event.kind !== "scope.changed")).toEqual([]);
});

test("commitWith validates the record like record() does", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const subject = { type: "thread" as const, id: thread };
  let message = "";
  await t.host.install(
    makeUnit(
      {
        name: "sq-rec",
        kind: "group",
        points: ["boundary.settle.after"],
        def: counterDef,
        recordKinds: noteKinds,
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          const failure = await rejectionOf(() =>
            hostOf(g).commitWith({ n: 1 }, [
              { kind: "grp.sq-rec.note.made", subject, payload: { n: "x" } },
            ]),
          );
          message = failure instanceof Error ? failure.message : "ok";
        });
      },
    ),
  );
  await t.settled();
  await fire(t, thread, "k");
  expect(message).toContain("record grp.sq-rec.note.made is invalid");
  expect(t.records.events(thread).filter((event) => event.kind !== "scope.changed")).toEqual([]);
});
