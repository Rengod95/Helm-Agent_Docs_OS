import { expect, test } from "bun:test";
import type { GroupRecord } from "@xeon/contracts/extensions";
import { Type } from "typebox";
import { PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit, unsafeInput, snapshotOf } from "./fixtures/support.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const counterDef = { state: { schema: CounterSchema, initial: { n: 0 }, version: 1 } };

type Host = Awaited<ReturnType<typeof createTestHost>>;

function fire(t: Host, thread: ReturnType<Host["newThread"]>, key: string) {
  return t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

async function codeOf(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : String(error);
  }
  return undefined;
}

test("commit schema and conflict", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "st-basic", points: ["agent_settled"], def: counterDef }, (g) => {
      g.on("agent_settled", async () => {
        // 스키마를 어긴 값
        codes.push(await codeOf(() => g.commit({ n: -1 })));
        // 같은 판에 대한 두 커밋: 앞의 것이 이기고 뒤의 것은 충돌이다
        const first = g.commit({ n: 1 });
        const second = g.commit({ n: 2 });
        codes.push(await codeOf(() => first));
        codes.push(await codeOf(() => second));
      });
    }),
  );
  await fire(t, thread, "k1");
  expect(codes).toEqual(["state_schema", undefined, "state_conflict"]);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ scopeId: "st-basic", rev: 1, doc: { n: 1 } }]);
});

test("rerun handler commit is idempotent", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: { state: unknown; returned: unknown }[] = [];
  await t.host.install(
    makeUnit({ name: "st-rerun", points: ["agent_settled"], def: counterDef }, (g) => {
      g.on("agent_settled", async (_payload, ctx) => {
        const returned = await g.commit({ n: ctx.state.n + 1 });
        seen.push({ state: ctx.state, returned });
      });
    }),
  );
  await fire(t, thread, "same-key");
  // 소비 커밋 전에 죽었다가 같은 키로 다시 실행된 핸들러를 흉내 낸다
  await fire(t, thread, "same-key");
  expect(seen).toEqual([
    { state: { n: 0 }, returned: { n: 1 } },
    { state: { n: 1 }, returned: { n: 1 } },
  ]);
  const snapshot = await snapshotOf(t.records, thread);
  expect(snapshot.states).toMatchObject([{ rev: 1, doc: { n: 1 } }]);
  const stateEvents = t.records
    .events(thread)
    .filter((event) => event.kind.endsWith(".state.committed"));
  expect(stateEvents).toHaveLength(1);
  // 다른 키의 커밋은 새 판이다
  await fire(t, thread, "other-key");
  expect((await snapshotOf(t.records, thread)).states).toMatchObject([{ rev: 2, doc: { n: 2 } }]);
});

test("state is frozen, undeclared state and size are rejected", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const codes: (string | undefined)[] = [];
  let frozen = false;
  await t.host.install(
    makeUnit({ name: "st-none", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", async () => {
        codes.push(await codeOf(() => g.state()));
        codes.push(await codeOf(() => g.commit(unsafeInput({}))));
      });
    }),
  );
  await t.host.install(
    makeUnit(
      {
        name: "st-big",
        points: ["agent_settled"],
        loadIndex: 1,
        def: {
          state: {
            schema: Type.Object({ text: Type.String() }),
            initial: { text: "" },
            version: 1,
          },
        },
      },
      (g) => {
        g.on("agent_settled", async () => {
          frozen = Object.isFrozen(g.state());
          codes.push(await codeOf(() => g.commit({ text: "x".repeat(262_144) })));
        });
      },
    ),
  );
  await fire(t, thread, "k");
  expect(codes).toEqual(["state_undeclared", "state_undeclared", "state_too_large"]);
  expect(frozen).toBe(true);
});

test("state outside a thread context is no_thread", async () => {
  const t = await createTestHost();
  const result = await t.host.install(
    makeUnit({ name: "st-setup", def: counterDef }, (g) => {
      g.state();
    }),
  );
  expect(result.setups[0]).toMatchObject({
    status: "failed",
    failure: { kind: "threw", code: "no_thread" },
  });
});

const notePayloadSchema: Record<string, unknown> = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
  additionalProperties: false,
};

test("record and read declarations", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const results: unknown[] = [];
  const rows: GroupRecord[] = [];
  await t.host.install(
    makeUnit(
      {
        name: "rec-group",
        kind: "group",
        points: ["agent_settled"],
        recordKinds: [
          {
            kind: "grp.rec-group.note.recorded",
            version: 1,
            description: "note",
            payload: notePayloadSchema,
          },
        ],
      },
      (g) => {
        g.on("agent_settled", async () => {
          const subject = { type: "thread" as const, id: thread };
          results.push(
            await codeOf(() => g.record("grp.rec-group.other.recorded", subject, { text: "x" })),
          );
          results.push(
            await codeOf(() => g.record("grp.rec-group.note.recorded", subject, { text: 5 })),
          );
          await g.record("grp.rec-group.note.recorded", subject, { text: "hello" });
          results.push(
            await codeOf(() => g.readRecords({ kind: "grp.other-group.note.recorded" })),
          );
          rows.push(...(await g.readRecords({ kind: "grp.rec-group.note.recorded" })));
        });
      },
    ),
  );
  await fire(t, thread, "k");
  expect(results).toEqual(["record_kind_undeclared", "record_invalid", "read_kind_undeclared"]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    groupId: "rec-group",
    kind: "grp.rec-group.note.recorded",
    payload: { text: "hello" },
  });
});

test("recordPrivate is hidden from other extensions", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: Record<string, number> = {};
  const invalid: (string | undefined)[] = [];
  await t.host.install(
    makeUnit(
      {
        name: "prv-learning",
        kind: "group",
        points: ["agent_settled"],
        recordKinds: [
          {
            kind: "grp.prv-learning.skill.proposed",
            version: 1,
            description: "public",
            payload: {},
          },
        ],
      },
      (g) => {
        g.on("agent_settled", async () => {
          await g.recordPrivate("grp.prv-learning.proposal.created", { id: "p1" });
          seen.own = (await g.readRecords({ kind: "grp.prv-learning.*" })).length;
          invalid.push(
            await codeOf(() => g.recordPrivate("grp.other.proposal.created", { id: "x" })),
          );
          invalid.push(
            await codeOf(() => g.recordPrivate("grp.prv-learning.state.committed", { id: "x" })),
          );
          invalid.push(
            await codeOf(() => g.recordPrivate("grp.prv-learning.skill.proposed", { id: "x" })),
          );
          invalid.push(await codeOf(() => g.recordPrivate(unsafeInput("not-a-kind"), { id: "x" })));
        });
      },
    ),
  );
  await t.host.install(
    makeUnit(
      {
        name: "prv-other",
        kind: "group",
        points: ["agent_settled"],
        loadIndex: 1,
        readsRecordKinds: ["grp.prv-learning.*"],
      },
      (g) => {
        g.on("agent_settled", async () => {
          seen.other = (await g.readRecords({ kind: "grp.prv-learning.*" })).length;
        });
      },
    ),
  );
  await fire(t, thread, "k");
  const privateEvent = t.records
    .events(thread)
    .find((event) => event.kind === "grp.prv-learning.proposal.created");
  expect(privateEvent).toBeDefined();
  expect(seen).toEqual({ own: 1, other: 0 });
  expect(invalid).toEqual([
    "record_private_invalid",
    "record_private_invalid",
    "record_private_invalid",
    "record_private_invalid",
  ]);
});

test("rewind restores the state of the active branch", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "st-rewind", points: ["agent_settled"], def: counterDef }, (g) => {
      g.on("agent_settled", async (_payload, ctx) => {
        await g.commit({ n: ctx.state.n + 1 });
      });
    }),
  );
  await fire(t, thread, "k1");
  await fire(t, thread, "k2");
  const stateEvents = t.records
    .events(thread)
    .filter((event) => event.kind.endsWith(".state.committed"));
  expect(stateEvents).toHaveLength(2);
  const first = stateEvents[0];
  expect(first).toBeDefined();
  // 판 1 이벤트 뒤로 되감고 thread를 다시 연다
  t.records.rewindTo(thread, first?.id ?? null);
  await t.host.openThread(thread);
  await t.settled();
  const seen: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "st-peek", points: ["agent_settled"], loadIndex: 1 }, (g) => {
      g.on("agent_settled", (_payload, ctx) => {
        seen.push(ctx.threadId);
      });
    }),
  );
  await fire(t, thread, "k3");
  const branch = t.records
    .branch(thread)
    .filter((event) => event.kind.endsWith(".state.committed"));
  expect(branch.map((event) => event.payload)).toMatchObject([
    { rev: 1, doc: { n: 1 } },
    { rev: 2, doc: { n: 2 }, prevEventId: first?.id },
  ]);
  expect(branch[1]?.id).not.toBe(stateEvents[1]?.id);
});
