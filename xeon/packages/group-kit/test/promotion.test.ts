import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import { ToolsPortKey } from "@xeon/contracts/extensions";
import type { DurableEventDraft } from "@xeon/contracts/records";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import {
  buildPromotionReport,
  createGroupService,
  defineGroup,
  gatherPromotionInput,
  runGroupCommand,
  type PromotionHostView,
} from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

/** 도구를 등록하는 그룹. 소유 scope id는 그룹 이름이다 */
function toolGroup(name: string, tool: string) {
  return defineGroup({
    manifest: groupManifestOf({ name }),
    setup(g) {
      g.registerTool({
        name: tool,
        description: tool,
        parameters: Type.Object({}),
        replay: "safe",
        execute: () => Promise.resolve("ok"),
      });
    },
  });
}

/** 도구 등록부가 있는 테스트 호스트. 그룹 a가 a_tool을 등록한다 */
async function ownedToolHost(): Promise<{ t: TestHost; thread: ThreadId }> {
  const t = await createTestHost();
  await t.host.registerPlatform({
    name: "promotion-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, { register: () => ok(() => undefined) });
    },
  });
  await install(t, toolGroup("group-a", "a_tool"));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  return { t, thread };
}

/** 이벤트 초안. 저장소가 seq와 recordedAt을 채운다 */
function draftOf(
  t: TestHost,
  threadId: ThreadId,
  turnId: TurnId,
  kind: DurableEventDraft["kind"],
  payload: DurableEventDraft["payload"],
): DurableEventDraft {
  return {
    id: t.ids.next("evt"),
    kind,
    version: 1,
    threadId,
    turnId,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
  };
}

/** turn 시작. scopeId가 있으면 drive turn, 없으면 origin으로 출처를 정한다 */
function turnStarted(
  t: TestHost,
  threadId: ThreadId,
  turnId: TurnId,
  scopeId: string | null,
  origin: string,
): DurableEventDraft {
  return draftOf(t, threadId, turnId, "turn.started", {
    inputItemIds: [],
    requestId: null,
    scopeId,
    origin,
  });
}

/** 활성 가지의 이벤트 id → 저장소가 붙인 seq. 기대값을 집계 코드가 아니라 저장소에서 읽으려고 쓴다 */
async function readSeqs(t: TestHost, threadId: ThreadId): Promise<ReadonlyMap<string, number>> {
  const seqs = new Map<string, number>();
  for await (const item of t.records.readBranch(threadId)) {
    if (item.ok) seqs.set(item.value.id, item.value.seq);
  }
  return seqs;
}

async function seqOfDraft(t: TestHost, threadId: ThreadId, eventId: string): Promise<number> {
  return (await readSeqs(t, threadId)).get(eventId) ?? -1;
}

/** 도구 호출 한 건. effect.intent 하나가 호출 하나다 */
function intentOf(
  t: TestHost,
  threadId: ThreadId,
  turnId: TurnId,
  toolName: string,
): DurableEventDraft {
  return draftOf(t, threadId, turnId, "effect.intent", {
    effectId: t.ids.next("efx"),
    toolCallId: `call-${toolName}-${t.ids.next("itm")}`,
    toolName,
    itemId: t.ids.next("itm"),
    argsHash: "0".repeat(64),
    args: {},
    replay: "safe",
    idempotencyKey: null,
  });
}

test("promotion.report-table-values", () => {
  // 시나리오 17: 그룹 A의 도구를 그룹 B의 임대 turn이 호출하면 후보이고 소비자는 B다.
  // 사용자 turn의 호출은 userCalls에만 든다. 소유 그룹 자신의 호출과 소유 없는 도구의 호출은 세지 않는다
  const scenario = buildPromotionReport({
    toolOwners: new Map([["a_tool", "A"]]),
    calls: [
      { tool: "a_tool", seq: 3, threadId: "thr_1", origin: "user" },
      { tool: "a_tool", seq: 5, threadId: "thr_1", origin: "B" },
      { tool: "a_tool", seq: 7, threadId: "thr_1", origin: "B" },
      { tool: "a_tool", seq: 9, threadId: "thr_2", origin: "A" },
      { tool: "other", seq: 11, threadId: "thr_2", origin: "B" },
    ],
  });
  expect(scenario).toEqual({
    throughSeq: 9,
    threads: 2,
    candidates: [
      {
        tool: "a_tool",
        owner: "A",
        consumers: [{ scopeId: "B", calls: 2, firstSeq: 5, lastSeq: 7 }],
        userCalls: 1,
        candidate: true,
      },
    ],
  });

  // 사용자 turn만 부른 도구는 후보가 아니다
  expect(
    buildPromotionReport({
      toolOwners: new Map([["a_tool", "A"]]),
      calls: [
        { tool: "a_tool", seq: 1, threadId: "thr_1", origin: "user" },
        { tool: "a_tool", seq: 2, threadId: "thr_1", origin: "user" },
      ],
    }),
  ).toEqual({
    throughSeq: 2,
    threads: 1,
    candidates: [{ tool: "a_tool", owner: "A", consumers: [], userCalls: 2, candidate: false }],
  });

  // 소유 그룹 자신의 호출만 있으면 후보가 아니다
  expect(
    buildPromotionReport({
      toolOwners: new Map([["a_tool", "A"]]),
      calls: [{ tool: "a_tool", seq: 4, threadId: "thr_1", origin: "A" }],
    }),
  ).toEqual({
    throughSeq: 4,
    threads: 1,
    candidates: [{ tool: "a_tool", owner: "A", consumers: [], userCalls: 0, candidate: false }],
  });

  // 소유 없는 도구의 호출만 있거나 호출이 없으면 빈 보고다
  expect(
    buildPromotionReport({
      toolOwners: new Map(),
      calls: [{ tool: "other", seq: 8, threadId: "thr_1", origin: "B" }],
    }),
  ).toEqual({ throughSeq: 0, threads: 0, candidates: [] });
  expect(buildPromotionReport({ toolOwners: new Map(), calls: [] })).toEqual({
    throughSeq: 0,
    threads: 0,
    candidates: [],
  });

  // 도구는 이름순, 소비자는 scope id순이다. 호출이 없는 소유 도구도 한 항목으로 든다
  expect(
    buildPromotionReport({
      toolOwners: new Map([
        ["z_tool", "Z"],
        ["m_tool", "M"],
        ["b_tool", "Y"],
      ]),
      calls: [
        { tool: "z_tool", seq: 1, threadId: "thr_1", origin: "C" },
        { tool: "b_tool", seq: 2, threadId: "thr_1", origin: "C" },
        { tool: "b_tool", seq: 3, threadId: "thr_1", origin: "B" },
        { tool: "b_tool", seq: 4, threadId: "thr_1", origin: "B" },
        { tool: "b_tool", seq: 5, threadId: "thr_2", origin: "user" },
      ],
    }),
  ).toEqual({
    throughSeq: 5,
    threads: 2,
    candidates: [
      {
        tool: "b_tool",
        owner: "Y",
        consumers: [
          { scopeId: "B", calls: 2, firstSeq: 3, lastSeq: 4 },
          { scopeId: "C", calls: 1, firstSeq: 2, lastSeq: 2 },
        ],
        userCalls: 1,
        candidate: true,
      },
      { tool: "m_tool", owner: "M", consumers: [], userCalls: 0, candidate: false },
      {
        tool: "z_tool",
        owner: "Z",
        consumers: [{ scopeId: "C", calls: 1, firstSeq: 1, lastSeq: 1 }],
        userCalls: 0,
        candidate: true,
      },
    ],
  });
});

test("promotion.report-values-from-a-real-event-log", async () => {
  const { t, thread: first } = await ownedToolHost();
  const second = t.newThread();
  const userTurn = t.ids.next("trn");
  const bTurn = t.ids.next("trn");
  const selfTurn = t.ids.next("trn");
  const cTurn = t.ids.next("trn");
  const bTurn2 = t.ids.next("trn");
  const userTurn2 = t.ids.next("trn");

  // 첫 thread: 사용자 turn 호출, 그룹 B의 drive turn 호출 두 건(그 사이에 소유 없는 도구 호출),
  // 그룹 A 자신의 drive turn 호출, 그룹 C의 drive turn 호출
  const intentUser = intentOf(t, first, userTurn, "a_tool");
  await t.records.commit({
    threadId: first,
    requestId: "log:1",
    drafts: [turnStarted(t, first, userTurn, null, "user"), intentUser],
  });
  const intentB = intentOf(t, first, bTurn, "a_tool");
  await t.records.commit({
    threadId: first,
    requestId: "log:2",
    drafts: [turnStarted(t, first, bTurn, "group-b", "drive"), intentB],
  });
  await t.records.commit({
    threadId: first,
    requestId: "log:3",
    drafts: [intentOf(t, first, bTurn, "other_tool")],
  });
  const intentSelf = intentOf(t, first, selfTurn, "a_tool");
  await t.records.commit({
    threadId: first,
    requestId: "log:4",
    drafts: [turnStarted(t, first, selfTurn, "group-a", "drive"), intentSelf],
  });
  const intentC = intentOf(t, first, cTurn, "a_tool");
  await t.records.commit({
    threadId: first,
    requestId: "log:5",
    drafts: [turnStarted(t, first, cTurn, "group-c", "drive"), intentC],
  });
  const intentB2 = intentOf(t, first, bTurn2, "a_tool");
  await t.records.commit({
    threadId: first,
    requestId: "log:6",
    drafts: [turnStarted(t, first, bTurn2, "group-b", "drive"), intentB2],
  });
  // 둘째 thread: 사용자 turn 호출 한 건
  const intentUser2 = intentOf(t, second, userTurn2, "a_tool");
  await t.records.commit({
    threadId: second,
    requestId: "log:7",
    drafts: [turnStarted(t, second, userTurn2, null, "user"), intentUser2],
  });

  // 기대값의 seq는 저장소가 붙인 값에서 읽는다. 집계 코드의 결과로 기대값을 만들지 않는다
  const seqOf = new Map<string, number>();
  for (const branch of await Promise.all([readSeqs(t, first), readSeqs(t, second)])) {
    for (const [id, seq] of branch) seqOf.set(id, seq);
  }
  const seqAt = (draft: DurableEventDraft): number => seqOf.get(draft.id) ?? -1;

  const report = buildPromotionReport(await gatherPromotionInput(t.host, [first, second]));

  // 그룹 B와 C의 호출은 각 turn의 scope로 센다. 그룹 A 자신의 호출은 소비자가 아니고, other_tool은 빠진다
  expect(report).toEqual({
    throughSeq: seqAt(intentUser2),
    threads: 2,
    candidates: [
      {
        tool: "a_tool",
        owner: "group-a",
        consumers: [
          { scopeId: "group-b", calls: 2, firstSeq: seqAt(intentB), lastSeq: seqAt(intentB2) },
          { scopeId: "group-c", calls: 1, firstSeq: seqAt(intentC), lastSeq: seqAt(intentC) },
        ],
        userCalls: 2,
        candidate: true,
      },
    ],
  });
});

test("promotion.gather-skips-a-thread-whose-read-fails-and-delegated-turns", async () => {
  const { t, thread: good } = await ownedToolHost();
  const failing = t.newThread();
  const delegated = t.newThread();
  const userTurn = t.ids.next("trn");
  const delegatedTurn = t.ids.next("trn");
  const goodIntent = intentOf(t, good, userTurn, "a_tool");
  await t.records.commit({
    threadId: good,
    requestId: "skip:1",
    drafts: [turnStarted(t, good, userTurn, null, "user"), goodIntent],
  });
  await t.records.commit({
    threadId: delegated,
    requestId: "skip:2",
    drafts: [
      turnStarted(t, delegated, delegatedTurn, null, "delegation"),
      intentOf(t, delegated, delegatedTurn, "a_tool"),
    ],
  });
  // 읽기가 실패하는 thread는 건너뛴다. 나머지 thread의 값은 그대로 모은다
  const view: PromotionHostView = {
    scopes: () => t.host.scopes(),
    toolOwner: (name) => t.host.toolOwner(name),
    queryEvents: (threadId, query) =>
      threadId === failing
        ? Promise.resolve(err({ kind: "port_unavailable" as const }))
        : t.host.queryEvents(threadId, query),
  };
  const input = await gatherPromotionInput(view, [failing, good, delegated]);
  expect(input.toolOwners).toEqual(new Map([["a_tool", "group-a"]]));
  // 위임 turn은 호출을 만든 scope를 이벤트에서 알 수 없어 집계에서 뺀다(L3.group-kit.spec §10)
  const goodSeq = await seqOfDraft(t, good, goodIntent.id);
  expect(input.calls).toEqual([{ tool: "a_tool", seq: goodSeq, threadId: good, origin: "user" }]);
});

test("promotion.status-line-appears-only-with-candidates", async () => {
  const owner = toolGroup("group-a", "a_tool");
  const t = await createTestHost();
  await t.host.registerPlatform({
    name: "promotion-tools",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, { register: () => ok(() => undefined) });
    },
  });
  await install(t, owner);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf([owner]),
    holder: memoryDriveHolderSettings(),
    currentThread: () => thread,
    report: () => undefined,
  });

  // 호출이 없으면 후보 줄이 없다
  expect((await runGroupCommand(service, { op: "status" })).text).toBe(
    "구동 그룹 설정: auto\ngroup-a  켜짐  drive=없음",
  );
  // 그룹 B의 drive turn이 a_tool을 부르면 후보 줄이 group 줄 뒤에 붙는다
  const bTurn = t.ids.next("trn");
  await t.records.commit({
    threadId: thread,
    requestId: "status:1",
    drafts: [
      turnStarted(t, thread, bTurn, "group-b", "drive"),
      intentOf(t, thread, bTurn, "a_tool"),
    ],
  });
  expect((await runGroupCommand(service, { op: "status" })).text).toBe(
    "구동 그룹 설정: auto\ngroup-a  켜짐  drive=없음\n승격 후보: a_tool (group-a -> group-b)",
  );
});
