import { expect, test } from "bun:test";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import {
  GroupSettingsSourceKey,
  createGroupService,
  defineGroup,
  type GroupApi,
  type MetricsRecordedPayload,
} from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const KEY = "l3.group-kit.instrumentation";

/** 경계 신호 하나. 턴 id를 돌려주어 기록의 stepId와 맞춰 본다 */
async function boundary(t: TestHost, thread: ThreadId, key: string): Promise<TurnId> {
  const turnId = t.ids.next("trn");
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId, aborted: false },
    { threadId: thread, dispatchKey: key },
  );
  await t.settled();
  return turnId;
}

/** post는 핸들러나 drive 안에서만 되므로 tool.call.before 핸들러로 한 건씩 올린다 */
async function postVia(t: TestHost, thread: ThreadId, requestId: string): Promise<void> {
  await t.host.dispatch(
    "tool.call.before",
    { toolCallId: requestId, toolName: "read", input: {} },
    { threadId: thread, dispatchKey: `tc-${requestId}` },
  );
  await t.settled();
}

/** 게시를 올리는 그룹. 경계와 도구 호출 지점을 선언한다 */
function poster(
  name: string,
  points: ("boundary.settle.after" | "tool.call.before")[],
  sink: { api?: GroupApi<never> },
  extra?: (g: GroupApi<never>) => void,
) {
  return defineGroup({
    manifest: groupManifestOf({ name, points, usesPost: true }),
    setup(g) {
      sink.api = g;
      g.on("tool.call.before", async (payload) => {
        await g.post(
          { kind: "user", content: payload.toolCallId },
          { when: "next", requestId: payload.toolCallId },
        );
      });
      extra?.(g);
    },
  });
}

function recordedOf(t: TestHost, thread: ThreadId, groupId: string): readonly unknown[] {
  return t.records
    .events(thread)
    .filter((draft) => draft.kind === `grp.${groupId}.metrics.recorded`)
    .map((draft) => draft.payload);
}

/** 기록 한 건의 delta. 0인 칸도 모두 적는다 */
function delta(part: {
  readonly posts?: number;
  readonly costUsd?: number;
  readonly input?: number;
  readonly output?: number;
  readonly cacheWrite?: number;
}): MetricsRecordedPayload["delta"] {
  return {
    denies: 0,
    chainPatches: 0,
    handlerErrors: 0,
    posts: part.posts ?? 0,
    spawns: 0,
    delegates: 0,
    commits: 0,
    records: 0,
    leases: 0,
    tokens: {
      input: part.input ?? 0,
      output: part.output ?? 0,
      cacheRead: 0,
      cacheWrite: part.cacheWrite ?? 0,
    },
    costUsd: part.costUsd ?? 0,
    leaseMs: 0,
  };
}

test("metrics.recorded-writes-the-increase-at-each-boundary", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const sink: { api?: GroupApi<never> } = {};
  const seen: string[] = [];
  await install(
    t,
    poster("recorder", ["boundary.settle.after", "tool.call.before"], sink, (g) => {
      // 그룹 자신의 boundary.settle.after 핸들러도 계속 불린다
      g.on("boundary.settle.after", () => {
        seen.push("group");
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();

  await postVia(t, thread, "p1");
  sink.api?.metrics.addUsage({ input: 3, output: 1, cacheRead: 0, cacheWrite: 2, costUsd: 0.5 });
  const first = await boundary(t, thread, "b1");
  await postVia(t, thread, "p2");
  const second = await boundary(t, thread, "b2");
  // 바뀐 것이 없는 경계는 아무것도 쓰지 않는다
  await boundary(t, thread, "b3");

  expect(seen).toEqual(["group", "group", "group"]);
  // 두 번째 기록에는 두 번째 경계 사이의 증가분(게시 1건)만 있다. 첫 기록의 값은 반복되지 않는다
  expect(recordedOf(t, thread, "recorder")).toEqual([
    { stepId: first, delta: delta({ posts: 1, input: 3, output: 1, cacheWrite: 2, costUsd: 0.5 }) },
    { stepId: second, delta: delta({ posts: 1 }) },
  ]);
});

test("metrics.recorded-is-absent-when-instrumentation-is-off", async () => {
  const t = await createTestHost();
  const values: Record<string, unknown> = { [KEY]: false };
  await t.host.registerPlatform({
    name: "settings-source",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, { value: (key) => values[key] });
    },
  });
  const thread = t.newThread();
  const sink: { api?: GroupApi<never> } = {};
  await install(t, poster("quiet", ["boundary.settle.after", "tool.call.before"], sink));
  await t.host.openThread(thread);
  await t.settled();

  await postVia(t, thread, "q1");
  sink.api?.metrics.addUsage({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 1 });
  await boundary(t, thread, "q-b1");
  expect(recordedOf(t, thread, "quiet")).toEqual([]);
  // 설정은 실행 중에 바뀔 수 있다. 다시 켜진 첫 경계의 기록에는 마지막 기록 뒤의 증가분 전부가 든다
  values[KEY] = true;
  const resumed = await boundary(t, thread, "q-b2");
  expect(recordedOf(t, thread, "quiet")).toEqual([
    { stepId: resumed, delta: delta({ posts: 1, input: 1, output: 1, costUsd: 1 }) },
  ]);
});

test("metrics.recorded-is-absent-without-the-declared-point", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const sink: { api?: GroupApi<never> } = {};
  await install(t, poster("undeclared", ["tool.call.before"], sink));
  await t.host.openThread(thread);
  await t.settled();

  await postVia(t, thread, "u1");
  await boundary(t, thread, "u-b1");
  expect(sink.api?.metrics.snapshot().posts).toBe(1);
  expect(t.records.events(thread).some((draft) => draft.kind.endsWith(".metrics.recorded"))).toBe(
    false,
  );
});

test("metrics.status-is-null-when-instrumentation-is-off", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const module = defineGroup({
    manifest: groupManifestOf({ name: "status-off" }),
    setup() {},
  });
  await install(t, module);
  await t.host.openThread(thread);
  await t.settled();
  const holder = memoryDriveHolderSettings();
  const off = createGroupService({
    host: t.host,
    catalog: groupCatalogOf([module]),
    holder,
    currentThread: () => thread,
    report: () => {},
    instrumentation: () => false,
  });
  const on = createGroupService({
    host: t.host,
    catalog: groupCatalogOf([module]),
    holder,
    currentThread: () => thread,
    report: () => {},
  });
  expect(off.status("status-off")).toMatchObject({ ok: true, value: { metrics: null } });
  expect(on.status("status-off")).toMatchObject({
    ok: true,
    value: { metrics: { denies: 0, posts: 0, spawns: 0, delegates: 0, costUsd: 0, leaseMs: 0 } },
  });
});
