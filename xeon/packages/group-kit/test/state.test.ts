import { expect, test } from "bun:test";
import type { StateDecl } from "@xeon/contracts/extensions";
import { PrimitiveError } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import {
  STATE_DOC_MAX_BYTES,
  checkStateCommit,
  defineGroup,
  stateUpcasters,
  type GroupModule,
} from "../src/index.ts";
import { fireSettled, install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const counterDecl: StateDecl<{ readonly n: number }> = {
  schema: CounterSchema,
  initial: { n: 0 },
  version: 1,
};

/** 시험용 좁히기: 객체면 키-값 사본, 아니면 빈 객체 */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

test("state.check-commit-covers-schema-size-and-unchanged", () => {
  expect(checkStateCommit(counterDecl, { n: 1 }, { n: 2 })).toMatchObject({
    ok: true,
    unchanged: false,
  });
  expect(checkStateCommit(counterDecl, { n: 1 }, { n: 1 })).toMatchObject({
    ok: true,
    unchanged: true,
  });
  expect(checkStateCommit(counterDecl, { n: 1 }, { n: -1 })).toMatchObject({
    ok: false,
    kind: "state.schema",
  });
  const textDecl = { schema: Type.Object({ s: Type.String() }), initial: { s: "" }, version: 1 };
  const exact = "x".repeat(STATE_DOC_MAX_BYTES - '{"s":""}'.length);
  expect(checkStateCommit(textDecl, { s: "" }, { s: exact })).toMatchObject({ ok: true });
  expect(checkStateCommit(textDecl, { s: "" }, { s: `${exact}y` })).toMatchObject({
    ok: false,
    kind: "state.tooLarge",
    limit: STATE_DOC_MAX_BYTES,
  });
  // 키 순서가 달라도 같은 값이다
  const pair = {
    schema: Type.Object({ a: Type.Number(), b: Type.Number() }),
    initial: { a: 1, b: 2 },
    version: 1,
  };
  expect(checkStateCommit(pair, { a: 1, b: 2 }, { b: 2, a: 1 })).toMatchObject({ unchanged: true });
});

function countingGroup(name: string, seen: number[]): GroupModule {
  return defineGroup({
    manifest: groupManifestOf({ name, points: ["boundary.settle.after"] }),
    state: counterDecl,
    setup(g) {
      g.on("boundary.settle.after", async (_payload, ctx) => {
        seen.push(ctx.state.n);
        await g.commit({ n: ctx.state.n + 1 });
      });
    },
  });
}

test("state.restore-on-branch", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const seen: number[] = [];
  await install(t, countingGroup("branchy", seen));
  await fireSettled(t, thread, "k1");
  await fireSettled(t, thread, "k2");
  expect(seen).toEqual([0, 1]);
  const stateEvents = t.records
    .events(thread)
    .filter((event) => event.kind.endsWith(".state.committed"));
  expect(stateEvents).toHaveLength(2);

  // v1 직후로 분기하고 thread를 다시 열면 상태는 v1이다
  t.records.rewindTo(thread, stateEvents[0]?.id ?? null);
  await t.host.openThread(thread);
  await t.settled();
  await fireSettled(t, thread, "k3");
  expect(seen).toEqual([0, 1, 1]);
});

const driven = (name: string, sink: number[]): GroupModule =>
  defineGroup({
    manifest: groupManifestOf({ name, usesDrive: true }),
    state: counterDecl,
    setup(g) {
      g.drive(async (loop, state) => {
        sink.push(state.n);
        if (state.n >= 2) return;
        await loop.turn({ input: { kind: "user", content: "go" } });
        await g.commit({ n: state.n + 1 });
      });
    },
  });

test("state.restore-on-resume", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  const driveStates: number[] = [];
  await install(first, driven("resumer", driveStates));
  await first.host.openThread(thread);
  await first.settled();
  await first.boundary(thread).turnSettled();
  await first.settled();
  const loaded = await first.records.loadThread(thread);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.value.states.map((state) => state.doc)).toEqual([{ n: 2 }]);

  // 프로세스 재시작을 흉내 낸다: 같은 저장소를 새 호스트에 넘긴다
  const second = await first.restart();
  const resumed: number[] = [];
  await install(second, driven("resumer", resumed));
  await second.host.openThread(thread);
  await second.settled();
  expect(resumed[0]).toBe(2);
});

async function errorCodeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : String(error);
  }
  return undefined;
}

test("state.rejects-oversize-and-skips-unchanged", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const outcomes: (string | undefined)[] = [];
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "big-state", points: ["boundary.settle.after"] }),
      state: {
        schema: Type.Object({ s: Type.String({ pattern: "^[a-z]*$" }) }),
        initial: { s: "" },
        version: 1,
      },
      setup(g) {
        g.on("boundary.settle.after", async () => {
          outcomes.push(await errorCodeOf(() => g.commit({ s: "x".repeat(STATE_DOC_MAX_BYTES) })));
          outcomes.push(await errorCodeOf(() => g.commit({ s: "small" })));
          outcomes.push(await errorCodeOf(() => g.commit({ s: "small" })));
          outcomes.push(await errorCodeOf(() => g.commit({ s: "UPPER" })));
        });
      },
    }),
  );
  await fireSettled(t, thread, "k1");
  expect(outcomes).toEqual(["state_too_large", undefined, undefined, "state_schema"]);
  // 64 KiB 초과와 같은 값 재커밋은 이벤트를 쓰지 않는다. 쓴 이벤트는 "small" 한 번이다
  const committed = t.records
    .events(thread)
    .filter((event) => event.kind.endsWith(".state.committed"));
  expect(committed).toHaveLength(1);
});

test("state.migration-upgrades-a-lower-stored-version", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.openThread(thread);
  await install(first, countingGroup("migrating", []));
  await fireSettled(first, thread, "k1");
  await fireSettled(first, thread, "k2");

  const V2Schema = Type.Object({ n: Type.Integer({ minimum: 0 }), label: Type.String() });
  const v2 = defineGroup({
    manifest: groupManifestOf({ name: "migrating", points: ["boundary.settle.after"] }),
    state: { schema: V2Schema, initial: { n: 0, label: "" }, version: 2 },
    migrations: {
      1: (previous) => {
        return { n: recordOf(previous)["n"], label: "migrated" };
      },
    },
    setup() {},
  });
  const second = await first.restart();
  await install(second, v2);
  await second.host.openThread(thread);
  await second.settled();
  const loaded = await second.records.loadThread(thread);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.value.states).toMatchObject([
    { scopeId: "migrating", version: 2, doc: { n: 2, label: "migrated" } },
  ]);
  // GroupModule은 같은 마이그레이션을 F Upcaster로도 내놓는다
  expect(v2.stateUpcasters).toHaveLength(1);
  expect(
    v2.stateUpcasters[0]?.({
      scopeId: "migrating",
      rev: 1,
      prevEventId: null,
      version: 1,
      doc: { n: 5 },
    }),
  ).toEqual({
    scopeId: "migrating",
    rev: 1,
    prevEventId: null,
    version: 2,
    doc: { n: 5, label: "migrated" },
  });
});

test("state.upcasters-chain-one-step-per-version", () => {
  const upcasters = stateUpcasters(3, {
    1: (previous) => ({ ...recordOf(previous), a: 1 }),
    2: (previous) => ({ ...recordOf(previous), b: 2 }),
  });
  expect(upcasters).toHaveLength(2);
  const v1 = { scopeId: "x", rev: 1, prevEventId: null, version: 1, doc: {} };
  const v2 = upcasters[0]?.(v1);
  expect(v2).toMatchObject({ version: 2, doc: { a: 1 } });
  expect(upcasters[1]?.(v2)).toMatchObject({ version: 3, doc: { a: 1, b: 2 } });
  // 상태 이벤트가 아닌 payload는 그대로 둔다
  expect(upcasters[0]?.("plain")).toBe("plain");
});
