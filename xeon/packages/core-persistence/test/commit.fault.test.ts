import { describe, expect, test } from "bun:test";
import { canonicalJson } from "@xeon/contracts";
import type { CommitRequest, FaultPoint } from "@xeon/contracts/records";
import { expectProjectionsRebuildable, faultAt } from "../src/testing/index.ts";
import {
  checkpointInput,
  draftOf,
  expectOk,
  newThread,
  openHarness,
  startTurn,
  type Harness,
  type TurnIds,
} from "./support/harness.ts";

// 같은 요청을 시도마다 새로 만들면 id가 달라진다. 생산자가 id를 미리 발급해(F.records.spec §3.1) 요청을 한 번만 만든다
function stepEndRequest(h: Harness, turn: TurnIds): CommitRequest {
  const stepId = h.ids.next("stp");
  const draft = draftOf(
    h,
    h.loop,
    "step.completed",
    turn.threadId,
    { turnId: turn.turnId, stepId },
    {
      stepIndex: 0,
      status: "completed",
      stopReason: "stop",
      assistantItemId: null,
      toolResultItemIds: [],
    },
  );
  return {
    threadId: turn.threadId,
    requestId: `step:${turn.turnId}:0:end`,
    fingerprintSource: { turnId: turn.turnId, stepIndex: 0 },
    build: () => ({
      kind: "append",
      drafts: [draft],
      checkpoint: checkpointInput(turn.turnId, stepId, 0, "turn_end"),
    }),
  };
}

// C5는 step.completed와 checkpoint.step 두 이벤트라 인덱스 0과 1이 있다
const BEFORE_COMMIT: readonly FaultPoint[] = [
  "after_begin",
  "after_lease_check",
  "after_request_check",
  "after_event_insert:0",
  "after_event_insert:1",
  "after_projection:0",
  "after_projection:1",
  "after_ext_projection:0",
  "after_ext_projection:1",
  "before_checkpoint",
  "before_request_insert",
  "before_commit",
];

async function setup(point: FaultPoint) {
  const fault = faultAt(point);
  fault.armed = false;
  const h = await openHarness({ faults: fault.injector });
  const { threadId } = newThread(h);
  const turn = startTurn(h, threadId);
  const request = stepEndRequest(h, turn);
  return { fault, h, request };
}

/** 장애 뒤 재시도한 커밋의 저장 행. 저장소가 낸 checkpoint 이벤트 id(IdFactory가 앞서간다)만 가린다 */
function normalizedEvents(h: Harness): readonly string[] {
  return h.store.raw
    .query<{ envelope: string; kind: string }, []>("SELECT envelope, kind FROM events ORDER BY seq")
    .all()
    .map((row) => {
      if (row.kind !== "checkpoint.step") return row.envelope;
      const parsed: { id: string; payload: { checkpointId: string } } = JSON.parse(row.envelope);
      return canonicalJson({
        ...parsed,
        id: "<ckp-event>",
        payload: { ...parsed.payload, checkpointId: "<ckp>" },
      });
    });
}

// spec §9.1
describe("commit_atomic_under_fault_at_every_point", () => {
  for (const point of BEFORE_COMMIT) {
    test(point, async () => {
      const { fault, h, request } = await setup(point);
      const before = h.store.tableHashes();
      const counts = h.store.rowCounts();
      let notified = 0;
      h.service.feed.onCommit(() => {
        notified += 1;
      });
      fault.armed = true;
      expect(() => h.service.commit(request)).toThrow(`fault:${point}`);
      expect(h.store.tableHashes()).toEqual(before);
      expect(h.store.rowCounts()).toEqual(counts);
      expect(notified).toBe(0);
      // 같은 요청을 다시 보내면 처음 시도처럼 처리된다(TX-05)
      fault.armed = false;
      const retried = expectOk(h.service.commit(request));
      expect(retried.status).toBe("committed");
      if (retried.status === "committed") expect(retried.replayed).toBe(false);
      expect(notified).toBe(1);
      expectProjectionsRebuildable(h.store.db);
    });
  }

  test("after_commit keeps every row, emits nothing, and the retry is replayed", async () => {
    const { fault, h, request } = await setup("after_commit");
    let notified = 0;
    h.service.feed.onCommit(() => {
      notified += 1;
    });
    fault.armed = true;
    expect(() => h.service.commit(request)).toThrow("fault:after_commit");
    const after = h.store.tableHashes();
    expect(notified).toBe(0);
    fault.armed = false;
    const retried = expectOk(h.service.commit(request));
    expect(retried.status === "committed" && retried.replayed).toBe(true);
    expect(h.store.tableHashes()).toEqual(after);
    // 방출을 놓친 구독자는 readFrom으로 따라잡는다
    expect(notified).toBe(0);
  });

  test("the fault list covers every FaultPoint kind of eng.transactions.design §4.6", () => {
    const kinds = new Set(
      [...BEFORE_COMMIT, "after_commit" as const].map((point) => point.split(":")[0]),
    );
    expect([...kinds].toSorted((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(
      [
        "after_begin",
        "after_commit",
        "after_event_insert",
        "after_ext_projection",
        "after_lease_check",
        "after_projection",
        "after_request_check",
        "before_checkpoint",
        "before_commit",
        "before_request_insert",
      ].toSorted((a, b) => a.localeCompare(b)),
    );
  });
});

// spec §9.2
for (const point of BEFORE_COMMIT) {
  test(`commit_retry_after_fault_matches_clean_commit at ${point}`, async () => {
    const faulty = await setup(point);
    faulty.fault.armed = true;
    expect(() => faulty.h.service.commit(faulty.request)).toThrow(`fault:${point}`);
    faulty.fault.armed = false;
    expectOk(faulty.h.service.commit(faulty.request));

    const clean = await setup("after_commit");
    expectOk(clean.h.service.commit(clean.request));
    expect(normalizedEvents(faulty.h)).toEqual(normalizedEvents(clean.h));
  });
}
