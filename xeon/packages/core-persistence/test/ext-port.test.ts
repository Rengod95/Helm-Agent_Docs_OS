import { describe, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { EventId, JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import type {
  DurableEventDraft,
  ExtCommitRequest,
  RecordCommitPort,
} from "@fresnel/contracts/records";
import { memoryInputQueue, memoryLoopPort, runPortContract } from "@fresnel/ext-host/testing";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { completeTurn, itemAt } from "./support/branching.ts";
import {
  endTurn,
  expectOk,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  type Harness,
} from "./support/harness.ts";
import { TEST_HOLDER_A, TEST_HOLDER_B } from "./support/sqlite-store.ts";

const GROUP = "grp.alpha";

function draftOf(
  h: Harness,
  threadId: ThreadId,
  kind: DurableEventDraft["kind"],
  payload: unknown,
  parentId?: EventId | null,
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
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function statePayload(rev: number, prevEventId: EventId | null, doc: JsonValue): unknown {
  return { scopeId: "alpha", rev, prevEventId, version: 1, doc };
}

function firstDraftId(request: ExtCommitRequest): EventId {
  const draft = request.drafts[0];
  if (draft === undefined) throw new Bug("test: request has no draft");
  return draft.id;
}

/** lease.acquired 또는 lease.released를 커밋한다 */
function leaseCommit(
  h: Harness,
  threadId: ThreadId,
  requestId: string,
  kind: "lease.acquired" | "lease.released" | "lease.requested" | "lease.user_input",
  payload: Record<string, unknown>,
) {
  return h.service.ext.commit({
    threadId,
    requestId,
    drafts: [draftOf(h, threadId, kind, payload)],
  });
}

/** `ext.loadThread`의 열린 임대 목록에서 주도권 스택 필드만 뽑는다(오래된 것부터) */
async function stackOf(h: Harness, threadId: ThreadId) {
  return expectOk(await h.service.ext.loadThread(threadId)).openLeases.map((lease) => ({
    leaseId: lease.leaseId,
    scopeId: lease.scopeId,
    parent: lease.parent,
    depth: lease.depth,
    contentHash: lease.contentHash,
  }));
}

function stateRequest(
  h: Harness,
  threadId: ThreadId,
  key: string,
  rev: number,
  prev: EventId | null,
  doc: JsonValue,
  options: { readonly parentId?: EventId | null } = {},
): ExtCommitRequest {
  return {
    threadId,
    requestId: key,
    fingerprintSource: { scopeId: "alpha", key },
    expectStateRev: { scopeId: "alpha", rev: rev - 1 },
    drafts: [
      draftOf(
        h,
        threadId,
        `${GROUP}.state.committed`,
        statePayload(rev, prev, doc),
        options.parentId,
      ),
    ],
  };
}

function recordDraft(
  h: Harness,
  threadId: ThreadId,
  kind: DurableEventDraft["kind"],
  text: string,
): DurableEventDraft {
  return draftOf(h, threadId, kind, {
    groupId: "alpha",
    kind,
    version: 1,
    subject: { type: "step", id: "s1" },
    payload: { text },
  });
}

describe("ext.commit result mapping", () => {
  // spec §3.3 ext_commit_result_mapping
  test("ext_commit_result_mapping: committed, replayed with stored, state_conflict, invalid", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const first = stateRequest(h, threadId, "st-1", 1, null, { n: 1 });
    expect(await h.service.ext.commit(first)).toEqual({ status: "committed" });

    const replay = await h.service.ext.commit({
      ...first,
      drafts: [draftOf(h, threadId, `${GROUP}.state.committed`, statePayload(1, null, { n: 99 }))],
    });
    expect(replay.status).toBe("replayed");
    if (replay.status === "replayed") {
      expect(replay.stored).toMatchObject({ scopeId: "alpha", rev: 1, version: 1, doc: { n: 1 } });
    }

    const stale = await h.service.ext.commit(stateRequest(h, threadId, "st-2", 1, null, { n: 2 }));
    expect(stale).toEqual({ status: "rejected", code: "state_conflict" });

    // 같은 키, 다른 지문
    const reused = await h.service.ext.commit({ ...first, fingerprintSource: { other: true } });
    expect(reused).toEqual({ status: "rejected", code: "invalid" });
    // 키 형식, 다른 thread의 초안, 코어 kind
    expect(await h.service.ext.commit({ ...first, requestId: "bad key!" })).toEqual({
      status: "rejected",
      code: "invalid",
    });
    const other = h.ids.next("thr");
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "wrong-thread",
        drafts: [recordDraft(h, other, `${GROUP}.note.recorded`, "x")],
      }),
    ).toEqual({ status: "rejected", code: "invalid" });
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "core-kind",
        drafts: [draftOf(h, threadId, "input.queued", {})],
      }),
    ).toEqual({ status: "rejected", code: "invalid" });
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "bad-state",
        drafts: [draftOf(h, threadId, `${GROUP}.state.committed`, { rev: "one" })],
      }),
    ).toEqual({ status: "rejected", code: "invalid" });
    expectProjectionsRebuildable(h.store.db);
  });

  test("a taken-over session maps ownership_lost to lease_lost", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    h.store.leases.takeover(`thread:${threadId}`, TEST_HOLDER_B);
    const result = await h.service.ext.commit({
      threadId,
      requestId: "after-takeover",
      drafts: [recordDraft(h, threadId, `${GROUP}.note.recorded`, "x")],
    });
    expect(result).toEqual({ status: "rejected", code: "lease_lost" });
  });

  test("an unknown or unopened thread is invalid, an observer is storage", async () => {
    const h = await openHarness();
    const missing = h.ids.next("thr");
    expect(
      await h.service.ext.commit({
        threadId: missing,
        requestId: "k1",
        drafts: [recordDraft(h, missing, `${GROUP}.note.recorded`, "x")],
      }),
    ).toEqual({ status: "rejected", code: "invalid" });
    const { threadId } = newThread(h);
    const observer = await reopenHarness(h);
    observer.service.openForRead(threadId);
    expect(
      await observer.service.ext.commit({
        threadId,
        requestId: "k2",
        drafts: [recordDraft(observer, threadId, `${GROUP}.note.recorded`, "x")],
      }),
    ).toEqual({ status: "rejected", code: "storage" });
  });
});

describe("ext.loadThread", () => {
  test("scope, lease and state are computed from the active branch", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const scopeChanged = (scopeId: string, status: "enabled" | "disabled"): DurableEventDraft =>
      draftOf(h, threadId, "scope.changed", { scopeId, status });
    expect(
      (
        await h.service.ext.commit({
          threadId,
          requestId: "sc1",
          drafts: [scopeChanged("alpha", "enabled")],
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await h.service.ext.commit({
          threadId,
          requestId: "sc2",
          drafts: [scopeChanged("beta", "enabled")],
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await h.service.ext.commit({
          threadId,
          requestId: "sc3",
          drafts: [scopeChanged("beta", "disabled")],
        })
      ).status,
    ).toBe("committed");
    const acquired = draftOf(h, threadId, "lease.acquired", {
      leaseId: "lease-1",
      lineageId: "lease-1",
      scopeId: "alpha",
      limits: { maxTurns: 4 },
    });
    expect(
      (await h.service.ext.commit({ threadId, requestId: "ls1", drafts: [acquired] })).status,
    ).toBe("committed");
    const stateCommit = stateRequest(h, threadId, "st-1", 1, null, { n: 1 });
    expect((await h.service.ext.commit(stateCommit)).status).toBe("committed");

    const snapshot = expectOk(await h.service.ext.loadThread(threadId));
    expect(snapshot.enabled).toEqual(["alpha"]);
    expect(snapshot.disabled).toEqual(["beta"]);
    expect(snapshot.scopeTransitions).toEqual({ alpha: 1, beta: 2 });
    expect(Object.keys(snapshot.enabledAtSeq)).toEqual(["alpha"]);
    expect(snapshot.enabledAtSeq["alpha"]).toBe(2);
    expect(snapshot.leaseEpochs).toEqual({ alpha: 1 });
    expect(snapshot.openLeases).toEqual([
      {
        leaseId: "lease-1",
        lineageId: "lease-1",
        scopeId: "alpha",
        leaseEpoch: 1,
        limits: { maxTurns: 4 },
        used: { turns: 0, spawns: 0, tokens: 0 },
        parent: null,
        depth: 0,
        contentHash: null,
        input: null,
        handoffEnd: null,
        // 요청 id도 parent도 없는 부여는 프로필의 시작 주도이고 처리된 사용자 메시지가 아직 없다
        awaitsUser: true,
      },
    ]);
    expect(snapshot.pendingRequests).toEqual([]);
    expect(snapshot.states).toHaveLength(1);

    const released = draftOf(h, threadId, "lease.released", {
      leaseId: "lease-1",
      scopeId: "alpha",
      reason: "idle",
    });
    await h.service.ext.commit({ threadId, requestId: "ls2", drafts: [released] });
    expect(expectOk(await h.service.ext.loadThread(threadId)).openLeases).toEqual([]);
    expect(h.service.ext.loadThread(h.ids.next("thr"))).resolves.toMatchObject({
      ok: true,
      value: { enabled: [] },
    });
  });

  test("a waiting release is an ordinary release; the next acquire keeps the lineage", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const open = async () =>
      expectOk(await h.service.ext.loadThread(threadId)).openLeases.map((lease) => ({
        leaseId: lease.leaseId,
        lineageId: lease.lineageId,
      }));

    await leaseCommit(h, threadId, "a1", "lease.acquired", {
      leaseId: "l1",
      lineageId: "l1",
      scopeId: "alpha",
      limits: {},
    });
    expect(await open()).toEqual([{ leaseId: "l1", lineageId: "l1" }]);
    await leaseCommit(h, threadId, "r1", "lease.released", {
      leaseId: "l1",
      scopeId: "alpha",
      reason: "waiting",
    });
    expect(await open()).toEqual([]);
    // 이어받은 부여: 새 leaseId, 같은 계통
    await leaseCommit(h, threadId, "a2", "lease.acquired", {
      leaseId: "l2",
      lineageId: "l1",
      scopeId: "alpha",
      limits: {},
    });
    expect(await open()).toEqual([{ leaseId: "l2", lineageId: "l1" }]);
    await leaseCommit(h, threadId, "r2", "lease.released", {
      leaseId: "l2",
      scopeId: "alpha",
      reason: "budget",
    });
    expect(await open()).toEqual([]);
  });

  test("the snapshot carries the input of a frame, the end of a handed-off frame for its caller, and the start requests still pending", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const open = async () => expectOk(await h.service.ext.loadThread(threadId));
    await leaseCommit(h, threadId, "q1", "lease.requested", {
      requestId: "rq-user",
      scopeId: "alpha",
      status: "queued",
      trigger: "user",
      input: { topic: "t" },
    });
    await leaseCommit(h, threadId, "a1", "lease.acquired", {
      leaseId: "la",
      lineageId: "la",
      scopeId: "alpha",
      limits: {},
      requestId: "rq-user",
      input: { topic: "t" },
    });
    await leaseCommit(h, threadId, "q2", "lease.requested", {
      requestId: "rq-handoff",
      scopeId: "beta",
      status: "queued",
      trigger: "handoff",
      parent: "la",
      input: { need: 1 },
    });
    await leaseCommit(h, threadId, "q3", "lease.requested", {
      requestId: "rq-dropped",
      scopeId: "gamma",
      status: "queued",
      trigger: "user",
    });
    await leaseCommit(h, threadId, "q4", "lease.requested", {
      requestId: "rq-dropped",
      scopeId: "gamma",
      status: "dropped",
      trigger: "user",
    });
    // rq-user는 부여가 있어 대기에서 빠지고, rq-handoff만 남는다
    const first = await open();
    expect(first.openLeases.map((lease) => [lease.scopeId, lease.input])).toEqual([
      ["alpha", { topic: "t" }],
    ]);
    expect(first.pendingRequests.map((request) => request.requestId)).toEqual(["rq-handoff"]);

    await leaseCommit(h, threadId, "a2", "lease.acquired", {
      leaseId: "lb",
      lineageId: "lb",
      scopeId: "beta",
      limits: {},
      depth: 1,
      parent: "la",
      requestId: "rq-handoff",
      input: { need: 1 },
    });
    const granted = await open();
    expect(granted.pendingRequests).toEqual([]);
    expect(granted.openLeases.at(-1)?.input).toEqual({ need: 1 });
    expect(granted.openLeases[0]?.handoffEnd).toBeNull();

    await leaseCommit(h, threadId, "r1", "lease.released", {
      leaseId: "lb",
      scopeId: "beta",
      reason: "done",
      result: { built: true },
    });
    const finished = await open();
    expect(finished.openLeases.map((lease) => lease.leaseId)).toEqual(["la"]);
    expect(finished.openLeases[0]?.handoffEnd).toEqual({ status: "done", result: { built: true } });

    // 맡긴 프레임이 반납되면 그 프레임이 낸 맡기기 요청은 되살리지 않는다
    await leaseCommit(h, threadId, "q5", "lease.requested", {
      requestId: "rq-orphan",
      scopeId: "beta",
      status: "queued",
      trigger: "handoff",
      parent: "la",
    });
    await leaseCommit(h, threadId, "r2", "lease.released", {
      leaseId: "la",
      scopeId: "alpha",
      reason: "revoked",
    });
    expect((await open()).pendingRequests).toEqual([]);
  });

  test("the snapshot carries the user messages not yet settled and tells a profile start frame that still awaits its first message", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const open = async () => expectOk(await h.service.ext.loadThread(threadId));
    // 프로필의 시작 주도(requestId도 parent도 없다)와 사용자 명령이 시작한 주도(requestId가 있다)
    await leaseCommit(h, threadId, "a1", "lease.acquired", {
      leaseId: "lp",
      lineageId: "lp",
      scopeId: "profile",
      limits: {},
    });
    expect((await open()).openLeases.map((lease) => lease.awaitsUser)).toEqual([true]);
    const held = (requestId: string, content: string) =>
      leaseCommit(h, threadId, `h:${requestId}`, "lease.user_input", {
        requestId,
        scopeId: "profile",
        status: "held",
        input: { kind: "user", content },
      });
    await held("m1", "first");
    await held("m2", "second");
    const pending = await open();
    expect(pending.pendingUserInputs).toEqual([
      { requestId: "m1", scopeId: "profile", input: { kind: "user", content: "first" } },
      { requestId: "m2", scopeId: "profile", input: { kind: "user", content: "second" } },
    ]);
    // 전달만 되고 처리되지 않았으면 아직 첫 메시지를 기다리는 프레임이다(첫 단계의 입력이 그 메시지다)
    expect(pending.openLeases.map((lease) => lease.awaitsUser)).toEqual([true]);

    await leaseCommit(h, threadId, "s:m1", "lease.user_input", {
      requestId: "m1",
      scopeId: "profile",
      status: "settled",
    });
    const settled = await open();
    expect(settled.pendingUserInputs.map((message) => message.requestId)).toEqual(["m2"]);
    expect(settled.openLeases.map((lease) => lease.awaitsUser)).toEqual([false]);

    // 사용자 명령이 시작한 프레임은 기다리지 않는다
    await leaseCommit(h, threadId, "a2", "lease.acquired", {
      leaseId: "lu",
      lineageId: "lu",
      scopeId: "user-started",
      limits: {},
      requestId: "rq-user",
    });
    expect((await open()).openLeases.map((lease) => lease.awaitsUser)).toEqual([false, false]);
  });

  test("a handed-off stack reads oldest first, each frame with its parent, depth and contentHash", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const acquire = (requestId: string, payload: Record<string, unknown>) =>
      leaseCommit(h, threadId, requestId, "lease.acquired", { limits: {}, ...payload });

    expect(
      (
        await acquire("a", {
          leaseId: "A",
          lineageId: "A",
          scopeId: "alpha",
          depth: 0,
          contentHash: "sha256:aa",
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await acquire("b", {
          leaseId: "B",
          lineageId: "B",
          scopeId: "beta",
          parent: "A",
          depth: 1,
          contentHash: "sha256:bb",
        })
      ).status,
    ).toBe("committed");
    expect(
      (
        await acquire("c", {
          leaseId: "C",
          lineageId: "C",
          scopeId: "gamma",
          parent: "B",
          depth: 2,
          contentHash: "sha256:cc",
        })
      ).status,
    ).toBe("committed");
    expect(await stackOf(h, threadId)).toEqual([
      { leaseId: "A", scopeId: "alpha", parent: null, depth: 0, contentHash: "sha256:aa" },
      { leaseId: "B", scopeId: "beta", parent: "A", depth: 1, contentHash: "sha256:bb" },
      { leaseId: "C", scopeId: "gamma", parent: "B", depth: 2, contentHash: "sha256:cc" },
    ]);
  });

  test("releasing the top frame leaves the frames below it, one by one", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const frameA = {
      leaseId: "A",
      scopeId: "alpha",
      parent: null,
      depth: 0,
      contentHash: "sha256:aa",
    };
    const frameB = {
      leaseId: "B",
      scopeId: "beta",
      parent: "A",
      depth: 1,
      contentHash: "sha256:bb",
    };
    await leaseCommit(h, threadId, "a", "lease.acquired", {
      leaseId: "A",
      lineageId: "A",
      scopeId: "alpha",
      limits: {},
      depth: 0,
      contentHash: "sha256:aa",
    });
    await leaseCommit(h, threadId, "b", "lease.acquired", {
      leaseId: "B",
      lineageId: "B",
      scopeId: "beta",
      limits: {},
      parent: "A",
      depth: 1,
      contentHash: "sha256:bb",
    });
    await leaseCommit(h, threadId, "c", "lease.acquired", {
      leaseId: "C",
      lineageId: "C",
      scopeId: "gamma",
      limits: {},
      parent: "B",
      depth: 2,
      contentHash: "sha256:cc",
    });
    await leaseCommit(h, threadId, "rc", "lease.released", {
      leaseId: "C",
      scopeId: "gamma",
      reason: "done",
    });
    expect(await stackOf(h, threadId)).toEqual([frameA, frameB]);
    await leaseCommit(h, threadId, "rb", "lease.released", {
      leaseId: "B",
      scopeId: "beta",
      reason: "done",
    });
    expect(await stackOf(h, threadId)).toEqual([frameA]);
  });

  test("a lease.acquired written before parent, depth and contentHash existed reads as a root frame", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    await leaseCommit(h, threadId, "old", "lease.acquired", {
      leaseId: "old-1",
      lineageId: "old-1",
      scopeId: "alpha",
      limits: { maxTurns: 2 },
    });
    expect(await stackOf(h, threadId)).toEqual([
      { leaseId: "old-1", scopeId: "alpha", parent: null, depth: 0, contentHash: null },
    ]);
  });

  test("a release of a frame below the top removes only that frame", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const frameB = { leaseId: "B", scopeId: "beta", parent: "A", depth: 1, contentHash: null };
    const frameC = { leaseId: "C", scopeId: "gamma", parent: "B", depth: 2, contentHash: null };
    await leaseCommit(h, threadId, "a", "lease.acquired", {
      leaseId: "A",
      lineageId: "A",
      scopeId: "alpha",
      limits: {},
    });
    await leaseCommit(h, threadId, "b", "lease.acquired", {
      leaseId: "B",
      lineageId: "B",
      scopeId: "beta",
      limits: {},
      parent: "A",
      depth: 1,
    });
    await leaseCommit(h, threadId, "c", "lease.acquired", {
      leaseId: "C",
      lineageId: "C",
      scopeId: "gamma",
      limits: {},
      parent: "B",
      depth: 2,
    });
    await leaseCommit(h, threadId, "ra", "lease.released", {
      leaseId: "A",
      scopeId: "alpha",
      reason: "disabled",
    });
    expect(await stackOf(h, threadId)).toEqual([frameB, frameC]);
  });

  test("each open frame counts the turns of its own scope only", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    await leaseCommit(h, threadId, "a", "lease.acquired", {
      leaseId: "A",
      lineageId: "A",
      scopeId: "alpha",
      limits: {},
    });
    await leaseCommit(h, threadId, "b", "lease.acquired", {
      leaseId: "B",
      lineageId: "B",
      scopeId: "beta",
      limits: {},
      parent: "A",
      depth: 1,
    });
    endTurn(h, startTurn(h, threadId, { requestId: "t1", scopeId: "alpha" }));
    endTurn(h, startTurn(h, threadId, { requestId: "t2", scopeId: "beta" }));
    endTurn(h, startTurn(h, threadId, { requestId: "t3", scopeId: "beta" }));
    const snapshot = expectOk(await h.service.ext.loadThread(threadId));
    expect(snapshot.openLeases.map((lease) => [lease.leaseId, lease.used.turns])).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
  });

  test("open lease usage counts turns of the lease scope and its drive spawns", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    await h.service.ext.commit({
      threadId,
      requestId: "ls1",
      drafts: [
        draftOf(h, threadId, "lease.acquired", {
          leaseId: "lease-9",
          lineageId: "lease-9",
          scopeId: "alpha",
          limits: {},
        }),
      ],
    });
    const mine = startTurn(h, threadId, { requestId: "r1", scopeId: "alpha" });
    endTurn(h, mine);
    const theirs = startTurn(h, threadId, { requestId: "r2", scopeId: "other" });
    endTurn(h, theirs);
    startTurn(h, threadId);
    const snapshot = expectOk(await h.service.ext.loadThread(threadId));
    expect(snapshot.openLeases.map((lease) => lease.used)).toEqual([
      { turns: 1, spawns: 0, tokens: 0 },
    ]);
  });

  test("a rewound branch is not seen: states and rev follow the active branch", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const first = stateRequest(h, threadId, "st-1", 1, null, { n: 1 });
    await h.service.ext.commit(first);
    const firstId = firstDraftId(first);
    const second = stateRequest(h, threadId, "st-2", 2, firstId, { n: 2 });
    await h.service.ext.commit(second);
    expect(expectOk(await h.service.ext.loadThread(threadId)).states[0]?.rev).toBe(2);
    // 첫 판 위에서 갈라진 새 가지: 둘째 판은 버려진 가지에 남는다
    const branched = stateRequest(
      h,
      threadId,
      "st-2b",
      2,
      firstId,
      { n: "b" },
      { parentId: firstId },
    );
    expect(
      await h.service.ext.commit({ ...branched, expectStateRev: { scopeId: "alpha", rev: 2 } }),
    ).toEqual({
      status: "committed",
    });
    const state = expectOk(await h.service.ext.loadThread(threadId)).states[0];
    expect(state).toMatchObject({ rev: 2, doc: { n: "b" } });
    expect(state?.eventId).toBe(firstDraftId(branched));
    // 버려진 가지의 판 2가 아니라 활성 가지의 판 2와 비교한다
    const next = stateRequest(h, threadId, "st-3", 3, firstDraftId(branched), { n: 3 });
    expect(await h.service.ext.commit(next)).toEqual({ status: "committed" });
  });
});

describe("ext.queryRecords", () => {
  test("ext_private_records_visible_to_owner_only", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const publicKind = `${GROUP}.note.recorded` as const;
    await h.service.ext.commit({
      threadId,
      requestId: "pub-1",
      drafts: [recordDraft(h, threadId, publicKind, "public note")],
    });
    const privateKind = `${GROUP}.metrics.recorded` as const;
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "priv-1",
        visibility: "private",
        drafts: [draftOf(h, threadId, privateKind, { hits: 3 })],
      }),
    ).toEqual({ status: "committed" });
    const owners = h.store.raw
      .query<{ kind: string; private_owner: string | null }, []>(
        "SELECT kind, private_owner FROM events WHERE kind LIKE 'grp.alpha.%' ORDER BY seq",
      )
      .all();
    expect(owners).toEqual([
      { kind: publicKind, private_owner: null },
      { kind: privateKind, private_owner: "alpha" },
    ]);

    const all = { kind: "grp.alpha.*" as const };
    expect(
      expectOk(await h.service.ext.queryRecords(threadId, all, "alpha")).map((row) => row.kind),
    ).toEqual([publicKind, privateKind]);
    expect(
      expectOk(await h.service.ext.queryRecords(threadId, all, "beta")).map((row) => row.kind),
    ).toEqual([publicKind]);
    const exact = expectOk(
      await h.service.ext.queryRecords(threadId, { kind: privateKind }, "alpha"),
    );
    expect(exact[0]).toMatchObject({ groupId: "alpha", payload: { hits: 3 } });
    const bySubject = expectOk(
      await h.service.ext.queryRecords(
        threadId,
        { kind: "grp.alpha.*", subject: { type: "step", id: "s2" } },
        "alpha",
      ),
    );
    expect(bySubject).toEqual([]);
    expect(
      expectOk(await h.service.ext.queryRecords(threadId, { ...all, limit: 1 }, "alpha")),
    ).toHaveLength(1);
    // 상태 이벤트는 기록 조회에 나오지 않는다
    await h.service.ext.commit(stateRequest(h, threadId, "st-1", 1, null, { n: 1 }));
    expect(expectOk(await h.service.ext.queryRecords(threadId, all, "alpha"))).toHaveLength(2);
  });

  test("private commits of core kinds are invalid; private rows stay hidden after restart", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "priv-core",
        visibility: "private",
        drafts: [draftOf(h, threadId, "scope.changed", { scopeId: "alpha", status: "enabled" })],
      }),
    ).toEqual({ status: "rejected", code: "invalid" });
    await h.service.ext.commit({
      threadId,
      requestId: "priv-1",
      visibility: "private",
      drafts: [draftOf(h, threadId, "grp.alpha.metrics.recorded", { hits: 1 })],
    });
    // 같은 키로 공개 범위만 바꾸면 key_reused
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "priv-1",
        drafts: [draftOf(h, threadId, "grp.alpha.metrics.recorded", { hits: 1 })],
      }),
    ).toEqual({ status: "rejected", code: "invalid" });
  });
});

describe("extension kinds after restart", () => {
  test("events of kinds nobody registered are still readable by readFrom and subscribe", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    await h.service.ext.commit({
      threadId,
      requestId: "pub-1",
      drafts: [recordDraft(h, threadId, "grp.alpha.note.recorded", "kept")],
    });
    const restarted = await reopenHarness(h);
    const seen: string[] = [];
    for await (const read of restarted.service.readFrom(0, { threadId })) {
      seen.push(expectOk(read).kind);
    }
    expect(seen).toEqual(["thread.started", "grp.alpha.note.recorded"]);
    const rows = expectOk(
      await restarted.service.ext.queryRecords(threadId, { kind: "grp.alpha.*" }, "alpha"),
    );
    expect(rows).toHaveLength(1);
  });
});

/** 호출마다 새 저장소. 계약 시나리오가 쓰는 thread는 처음 쓸 때 만들고 연다 */
function freshRecords(): RecordCommitPort {
  const ready = openHarness();
  const known = new Set<ThreadId>();
  const harness = async (threadId: ThreadId): Promise<Harness> => {
    const h = await ready;
    if (!known.has(threadId)) {
      known.add(threadId);
      expectOk(h.service.threads.create({ threadId }));
      const token = h.store.leases.acquire(`thread:${threadId}`, TEST_HOLDER_A);
      if (!token.ok) throw new Bug("contract: lease failed", { cause: token.error });
      expectOk(h.service.openForWrite(threadId, token.value));
    }
    return h;
  };
  return {
    commit: async (request) => (await harness(request.threadId)).service.ext.commit(request),
    loadThread: async (threadId) => (await harness(threadId)).service.ext.loadThread(threadId),
    queryRecords: async (threadId, query, reader) =>
      (await harness(threadId)).service.ext.queryRecords(threadId, query, reader),
  };
}

describe("port contract (X.primitives.plan P-19)", () => {
  runPortContract("core-persistence ext", {
    loop: () => memoryLoopPort(),
    queue: () => memoryInputQueue(),
    records: freshRecords,
  });
});

describe("ext.commit on a forked thread", () => {
  // 갈라진 thread의 첫 상태 커밋은 출처에서 이어받은 판을 기대 판으로 받아야 한다. 저장소가 자기 thread 이벤트만 보면 판 0으로 읽어 충돌한다
  test("forked_thread_state_rev_follows_the_origin_chain", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const first = stateRequest(h, threadId, "st-1", 1, null, { n: 1 });
    expect(await h.service.ext.commit(first)).toEqual({ status: "committed" });
    const secondRequest = stateRequest(h, threadId, "st-2", 2, firstDraftId(first), { n: 2 });
    expect(await h.service.ext.commit(secondRequest)).toEqual({ status: "committed" });
    completeTurn(h, threadId);

    const childId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(threadId, itemAt(h, threadId, 0).itemId, childId));
    const token = h.store.leases.acquire(`thread:${childId}`, TEST_HOLDER_A);
    if (!token.ok) throw new Bug("test: child lease failed");
    expectOk(h.service.openForWrite(childId, token.value));

    const snapshot = expectOk(await h.service.ext.loadThread(childId));
    expect(snapshot.states).toMatchObject([{ scopeId: "alpha", rev: 2, doc: { n: 2 } }]);

    const stale = await h.service.ext.commit(
      stateRequest(h, childId, "child-stale", 1, null, { n: 7 }),
    );
    expect(stale).toEqual({ status: "rejected", code: "state_conflict" });
    const ok3 = await h.service.ext.commit(
      stateRequest(h, childId, "child-3", 3, firstDraftId(secondRequest), { n: 3 }),
    );
    expect(ok3).toEqual({ status: "committed" });
    // 출처 thread는 그대로 판 2다
    const origin = expectOk(await h.service.ext.loadThread(threadId));
    expect(origin.states).toMatchObject([{ rev: 2, doc: { n: 2 } }]);
  });
});
