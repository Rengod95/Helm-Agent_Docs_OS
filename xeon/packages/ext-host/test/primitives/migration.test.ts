import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { Type } from "typebox";
import { hostOf, PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit, snapshotOf } from "./fixtures/support.ts";

const V1 = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const V2 = Type.Object({ count: Type.Integer({ minimum: 0 }), label: Type.String() });

type Host = Awaited<ReturnType<typeof createTestHost>>;

/** 버전 1 상태 { n: 4 }를 저장소에 남기고 재시작에 쓸 저장소를 돌려준다 */
async function storedV1(
  name: string,
): Promise<{ first: Host; thread: ReturnType<Host["newThread"]> }> {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.openThread(thread);
  await first.host.install(
    makeUnit(
      {
        name,
        points: ["boundary.settle.after"],
        def: { state: { schema: V1, initial: { n: 0 }, version: 1 } },
      },
      (g) => {
        g.on("boundary.settle.after", async () => {
          await g.commit({ n: 4 });
        });
      },
    ),
  );
  await first.host.dispatch(
    "boundary.settle.after",
    { turnId: first.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "seed" },
  );
  expect((await snapshotOf(first.records, thread)).states).toMatchObject([
    { version: 1, rev: 1, doc: { n: 4 } },
  ]);
  return { first, thread };
}

function restarted(first: Host): Promise<Host> {
  return createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
}

function v2Unit(
  name: string,
  setup: (g: Parameters<NonNullable<Parameters<typeof makeUnit>[1]>>[0]) => void,
) {
  return makeUnit(
    {
      name,
      points: ["boundary.settle.after"],
      def: { state: { schema: V2, initial: { count: 0, label: "" }, version: 2 } },
    },
    setup,
  );
}

test("a lower stored version is migrated and committed as a new revision", async () => {
  const { first, thread } = await storedV1("mig-ok");
  const second = await restarted(first);
  const calls: unknown[] = [];
  const outcome = await second.host.install(
    v2Unit("mig-ok", (g) => {
      hostOf(g).migrateState((doc, from) => {
        calls.push([doc, from]);
        const old = parse(V1, doc);
        return { count: old.ok ? old.value.n : 0, label: "migrated" };
      });
    }),
  );
  expect(outcome.setups[0]?.status).toBe("applied");
  await second.host.openThread(thread);
  await second.settled();
  expect(calls).toEqual([[{ n: 4 }, 1]]);
  expect(second.host.scopes()[0]).toMatchObject({ status: "enabled" });
  const snapshot = await snapshotOf(second.records, thread);
  expect(snapshot.states).toMatchObject([
    { version: 2, rev: 2, doc: { count: 4, label: "migrated" } },
  ]);
  // 활성 가지의 이력은 판 1 뒤에 판 2가 prevEventId로 이어진다
  const events = second.records.events(thread).filter((e) => e.kind.endsWith(".state.committed"));
  expect(events).toHaveLength(2);
  expect(events[1]?.payload).toMatchObject({ rev: 2, version: 2, prevEventId: events[0]?.id });
});

const twiceUnit = () =>
  v2Unit("mig-twice", (g) => {
    hostOf(g).migrateState(() => ({ count: 1, label: "m" }));
  });

test("migrating again after another restart does nothing", async () => {
  const { first, thread } = await storedV1("mig-twice");
  const second = await restarted(first);
  await second.host.install(twiceUnit());
  await second.host.openThread(thread);
  await second.settled();
  const third = await restarted(first);
  await third.host.install(twiceUnit());
  await third.host.openThread(thread);
  await third.settled();
  const events = third.records.events(thread).filter((e) => e.kind.endsWith(".state.committed"));
  expect(events).toHaveLength(2);
});

test("a lower stored version without a hook keeps the scope off", async () => {
  const { first, thread } = await storedV1("mig-missing");
  const second = await restarted(first);
  const ran: string[] = [];
  await second.host.install(
    v2Unit("mig-missing", (g) => {
      g.on("boundary.settle.after", () => {
        ran.push("handler");
      });
    }),
  );
  await second.host.openThread(thread);
  await second.settled();
  expect(second.host.scopes()[0]?.lastError?.code).toBe("state_migration_missing");
  expect(second.diagnostics.map((d) => d.code)).toContain("state_migration_missing");
  await second.host.dispatch(
    "boundary.settle.after",
    { turnId: second.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  expect(ran).toEqual([]);
  expect((await snapshotOf(second.records, thread)).states).toMatchObject([{ version: 1, rev: 1 }]);
  // 이 thread에서 켜지지 못했으므로 켜짐 기록은 꺼짐으로 정리된다
  expect(
    second.records
      .events(thread)
      .filter((e) => e.kind === "scope.changed")
      .map((e) => e.payload),
  ).toEqual([
    { scopeId: "mig-missing", status: "enabled" },
    { scopeId: "mig-missing", status: "disabled" },
  ]);
});

test("a stored version above the declared one is refused", async () => {
  const { first, thread } = await storedV1("mig-future");
  // 선언 버전을 0이 아니라 낮춘 확장을 켜면 저장된 버전 1이 더 높다
  const second = await restarted(first);
  await second.host.install(
    makeUnit(
      {
        name: "mig-future",
        def: { state: { schema: V1, initial: { n: 0 }, version: 0 } },
      },
      () => {},
    ),
  );
  await second.host.openThread(thread);
  await second.settled();
  expect(second.host.scopes()[0]?.lastError?.code).toBe("state_future_version");
});

test("a migration result that breaks the schema or throws is refused", async () => {
  const bad = await storedV1("mig-schema");
  const second = await restarted(bad.first);
  await second.host.install(
    v2Unit("mig-schema", (g) => {
      hostOf(g).migrateState(() => ({ count: -1, label: "x" }));
    }),
  );
  await second.host.openThread(bad.thread);
  await second.settled();
  expect(second.host.scopes()[0]?.lastError?.code).toBe("state_schema");

  const thrown = await storedV1("mig-throw");
  const third = await restarted(thrown.first);
  await third.host.install(
    v2Unit("mig-throw", (g) => {
      hostOf(g).migrateState(() => {
        throw new Error("boom");
      });
    }),
  );
  await third.host.openThread(thrown.thread);
  await third.settled();
  expect(third.host.scopes()[0]?.lastError?.code).toBe("state_migration_failed");
});

test("migrateState is only allowed once, inside setup, for a scope with state", async () => {
  const t = await createTestHost();
  const codes: (string | undefined)[] = [];
  let leaked: ((fn: () => never) => void) | undefined;
  const attempt = (run: () => void): void => {
    try {
      run();
      codes.push(undefined);
    } catch (error) {
      codes.push(error instanceof PrimitiveError ? error.code : "other");
    }
  };
  await t.host.install(
    v2Unit("mig-misuse", (g) => {
      const host = hostOf(g);
      host.migrateState((doc) => doc);
      attempt(() => {
        host.migrateState((doc) => doc);
      });
      leaked = (fn) => {
        host.migrateState(fn);
      };
    }),
  );
  await t.host.install(
    makeUnit({ name: "mig-stateless", loadIndex: 1 }, (g) => {
      attempt(() => {
        hostOf(g).migrateState((doc) => doc);
      });
    }),
  );
  attempt(() => {
    leaked?.(() => {
      throw new Error("unused");
    });
  });
  expect(codes).toEqual([
    "state_migration_duplicate",
    "state_undeclared",
    "state_migration_outside_setup",
  ]);
});
