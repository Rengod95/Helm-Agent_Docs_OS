import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ThreadId, TurnId, UserMessage } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, EventKind } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import {
  createGroupService,
  defineGroup,
  runGroupCommand,
  type GroupApi,
  type GroupHostView,
} from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { serviceRig } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const ids = fixedIdFactory(500);

function envelope(
  seq: number,
  kind: EventKind,
  threadId: ThreadId,
  payload: unknown,
  recordedAt: number,
  turnId: TurnId | null = null,
): DurableEventEnvelope {
  return {
    id: ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId,
    stepId: null,
    recordedAt,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

/** helm이 임대를 한 번 받아 600ms 쓰고, turn 하나가 0.5달러를 썼다는 이벤트열 */
function helmEvents(threadId: ThreadId): readonly DurableEventEnvelope[] {
  const turn = ids.next("trn");
  return [
    envelope(
      1,
      "lease.acquired",
      threadId,
      { leaseId: "lease-1", scopeId: "helm", limits: {} },
      1_000,
    ),
    envelope(
      2,
      "turn.started",
      threadId,
      { inputItemIds: [], requestId: null, scopeId: "helm" },
      1_100,
      turn,
    ),
    envelope(
      3,
      "turn.completed",
      threadId,
      {
        status: "completed",
        stepCount: 1,
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.5 },
        },
        error: null,
      },
      1_500,
      turn,
    ),
    envelope(
      4,
      "lease.released",
      threadId,
      { leaseId: "lease-1", scopeId: "helm", reason: "budget" },
      1_600,
    ),
  ];
}

const user: UserMessage = { role: "user", content: "hi", timestamp: 1_700_000_000_001 };

/** helm을 설치하고 게시 1건과 카운터 비용 0.25를 올린 시험 묶음 */
async function helmRig() {
  const sink: { api?: GroupApi<never> } = {};
  const helm = defineGroup({
    manifest: groupManifestOf({ name: "helm", points: ["boundary.message.after"], usesPost: true }),
    setup(g) {
      sink.api = g;
      g.on("boundary.message.after", async () => {
        await g.post({ kind: "user", content: "hello" }, { when: "next", requestId: "status-1" });
        return undefined;
      });
    },
  });
  const rig = await serviceRig([helm]);
  await rig.t.host.dispatch(
    "boundary.message.after",
    { message: user },
    { threadId: rig.thread, dispatchKey: "status-post", initial: { message: user } },
  );
  await rig.t.settled();
  sink.api?.metrics.addUsage({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.25 });
  return { ...rig, helm, api: sink.api };
}

test("metrics.status-merges-counters-with-thread-usage-after-the-status-command", async () => {
  const rig = await helmRig();
  const queried: string[] = [];
  const events = helmEvents(rig.thread);
  const view: GroupHostView = {
    ...rig.t.host,
    queryEvents: async (_threadId, query) => {
      queried.push(query.kindPrefix);
      return ok(events.filter((event) => event.kind.startsWith(query.kindPrefix)));
    },
  };
  const service = createGroupService({
    host: view,
    catalog: groupCatalogOf([rig.helm]),
    holder: memoryDriveHolderSettings(),
    currentThread: () => rig.thread,
    report: () => {},
  });
  const counted = { denies: 0, posts: 1, spawns: 0, delegates: 0 };
  // 명령을 치기 전에는 카운터 값만 보인다
  expect(service.status("helm")).toMatchObject({
    ok: true,
    value: { metrics: { ...counted, costUsd: 0.25, leaseMs: 0 } },
  });
  expect((await runGroupCommand(service, { op: "status" })).ok).toBe(true);
  // 명령이 현재 thread의 lease.*와 turn.* 이벤트를 읽어 임대 시간 600ms와 비용 0.5를 더한다
  expect(queried).toEqual(["lease.", "turn."]);
  expect(service.status("helm")).toMatchObject({
    ok: true,
    value: { metrics: { ...counted, costUsd: 0.75, leaseMs: 600 } },
  });
});

test("metrics.status-keeps-the-last-usage-when-a-query-fails", async () => {
  const rig = await helmRig();
  let failing = false;
  const events = helmEvents(rig.thread);
  const view: GroupHostView = {
    ...rig.t.host,
    queryEvents: async (_threadId, query) => {
      if (failing) return err({ kind: "port_unavailable" });
      return ok(events.filter((event) => event.kind.startsWith(query.kindPrefix)));
    },
  };
  const service = createGroupService({
    host: view,
    catalog: groupCatalogOf([rig.helm]),
    holder: memoryDriveHolderSettings(),
    currentThread: () => rig.thread,
    report: () => {},
  });
  await runGroupCommand(service, { op: "status" });
  expect(service.status("helm")).toMatchObject({
    ok: true,
    value: { metrics: { costUsd: 0.75, leaseMs: 600 } },
  });
  // 조회가 실패하면 명령은 그대로 끝나고 이전 캐시가 남는다
  failing = true;
  expect((await runGroupCommand(service, { op: "status", id: "helm" })).ok).toBe(true);
  expect(service.status("helm")).toMatchObject({
    ok: true,
    value: { metrics: { costUsd: 0.75, leaseMs: 600 } },
  });
});

test("metrics.status-real-host-has-no-turn-usage", async () => {
  const rig = await helmRig();
  const service = createGroupService({
    host: rig.t.host,
    catalog: groupCatalogOf([rig.helm]),
    holder: memoryDriveHolderSettings(),
    currentThread: () => rig.thread,
    report: () => {},
  });
  expect((await runGroupCommand(service, { op: "status" })).ok).toBe(true);
  // 시험 호스트의 기록 저장소는 recordedAt을 0으로 돌려주고 turn.* 이벤트를 쓰지 않는다
  expect(service.status("helm")).toMatchObject({
    ok: true,
    value: { metrics: { posts: 1, costUsd: 0.25, leaseMs: 0 } },
  });
});
