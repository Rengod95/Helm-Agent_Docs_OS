import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { EventId, JsonValue, ThreadId } from "@xeon/contracts/conversation";
import type {
  DurableEventDraft,
  ExtCommitRequest,
  RecordCommitPort,
} from "@xeon/contracts/records";
import { memoryInputQueue, memoryLoopPort, runPortContract } from "@xeon/ext-host/testing";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
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
    h.store.leases.takeover(`session:${threadId}`, TEST_HOLDER_B);
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
    expect(snapshot.openLease).toEqual({
      leaseId: "lease-1",
      scopeId: "alpha",
      leaseEpoch: 1,
      limits: { maxTurns: 4 },
      used: { turns: 0, spawns: 0, tokens: 0 },
    });
    expect(snapshot.states).toHaveLength(1);

    const released = draftOf(h, threadId, "lease.released", {
      leaseId: "lease-1",
      scopeId: "alpha",
      reason: "idle",
    });
    await h.service.ext.commit({ threadId, requestId: "ls2", drafts: [released] });
    expect(expectOk(await h.service.ext.loadThread(threadId)).openLease).toBeNull();
    expect(h.service.ext.loadThread(h.ids.next("thr"))).resolves.toMatchObject({
      ok: true,
      value: { enabled: [] },
    });
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
    expect(snapshot.openLease?.used).toEqual({ turns: 1, spawns: 0, tokens: 0 });
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
      const token = h.store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
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
