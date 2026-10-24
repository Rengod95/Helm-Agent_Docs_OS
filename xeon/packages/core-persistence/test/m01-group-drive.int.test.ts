// open-issues M-01: 그룹 drive가 실제 영속성 위에서 lease.released reason=error 없이 끝난다.
// ext-host의 시험 호스트에 실제 SessionService.ext를 기록 저장소로 꽂는다.
import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { DurableEventDraft } from "@xeon/contracts/records";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  createSmokeGroup,
  createTestHost,
  memoryRecordStore,
  type MemoryRecordStore,
} from "@xeon/ext-host/testing";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { expectOk, openHarness, type Harness } from "./support/harness.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

function unsupported(name: string): never {
  throw new Bug(`m01: ${name} is not supported by the real-records adapter`);
}

/** 실제 영속성을 MemoryRecordStore 모양으로 감싼다. thread는 처음 쓸 때 만들고 연다 */
function realRecords(h: Harness): MemoryRecordStore {
  const known = new Set<ThreadId>();
  let calls = 0;
  const ensure = (threadId: ThreadId): void => {
    if (known.has(threadId)) return;
    known.add(threadId);
    expectOk(h.service.threads.create({ threadId }));
    const token = h.store.leases.acquire(`session:${threadId}`, TEST_HOLDER_A);
    if (!token.ok) throw new Bug("m01: lease failed", { cause: token.error });
    expectOk(h.service.openForWrite(threadId, token.value));
  };
  return {
    get commitCalls() {
      return calls;
    },
    events(threadId): readonly DurableEventDraft[] {
      const read = expectOk(
        h.service.feed.read(0, Number.MAX_SAFE_INTEGER, { threadIds: [threadId] }, 1000, 100000),
      );
      return read.events;
    },
    branch: () => unsupported("branch"),
    rewindTo: () => unsupported("rewindTo"),
    failNext: () => unsupported("failNext"),
    setLeaseUsage: () => unsupported("setLeaseUsage"),
    commit(request) {
      calls += 1;
      ensure(request.threadId);
      return h.service.ext.commit(request);
    },
    loadThread(threadId) {
      ensure(threadId);
      return h.service.ext.loadThread(threadId);
    },
    queryRecords: (threadId, query, reader) => h.service.ext.queryRecords(threadId, query, reader),
  };
}

async function snapshotAfterDrive(records: MemoryRecordStore): Promise<unknown> {
  const t = await createTestHost({ shared: { records } });
  const thread = t.newThread();
  const { unit } = createSmokeGroup({ ids: t.ids });
  await t.host.install(unit);
  await t.host.openThread(thread);
  await t.settled();
  const snapshot = await records.loadThread(thread);
  return {
    enabled: snapshot.enabled,
    disabled: snapshot.disabled,
    transitions: snapshot.scopeTransitions,
    states: snapshot.states.map((state) => [state.scopeId, state.rev, state.doc]),
    epochs: snapshot.leaseEpochs,
    open: snapshot.openLease?.scopeId ?? null,
  };
}

describe("M-01 group drive on the real session store", () => {
  test("the smoke group drives, commits state and never releases with reason=error", async () => {
    const h = await openHarness();
    const records = realRecords(h);
    const t = await createTestHost({ shared: { records } });
    const thread = t.newThread();
    const { unit } = createSmokeGroup({ ids: t.ids });
    const installed = await t.host.install(unit);
    expect(installed.setups[0]?.status).toBe("applied");
    await t.host.openThread(thread);
    await t.settled();

    const kinds = records.events(thread).map((event) => event.kind);
    expect(kinds).toEqual([
      "thread.started",
      "scope.changed",
      "lease.acquired",
      "grp.smoke-group.state.committed",
    ]);
    // 같은 상태 판으로 두 번 효과 없이 끝나면 idle로 반납한다
    await t.boundary(thread).turnSettled();
    await t.settled();
    await t.boundary(thread).turnSettled();
    await t.settled();
    const released = records
      .events(thread)
      .filter((event) => event.kind === "lease.released")
      .map((event) => event.payload);
    expect(released).toHaveLength(1);
    expect(released[0]).not.toMatchObject({ reason: "error" });
    expect(t.diagnostics.filter((entry) => entry.level === "error")).toEqual([]);

    // 재시작: 활성 가지의 상태와 켜짐을 되살려 같은 임대를 새로 받지 않는다
    const snapshot = await h.service.ext.loadThread(thread);
    expect(snapshot.states[0]).toMatchObject({ scopeId: "smoke-group", rev: 1 });
    expect(snapshot.openLease).toBeNull();
    expectProjectionsRebuildable(h.store.db);
  });

  test("the memory record store and the real store agree on the same snapshot", async () => {
    const h = await openHarness();
    const real = realRecords(h);
    const memory = memoryRecordStore();
    expect(await snapshotAfterDrive(real)).toEqual(await snapshotAfterDrive(memory));
  });
});
