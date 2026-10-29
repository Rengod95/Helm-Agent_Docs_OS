import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { DurableEventEnvelope, Projector, ProjectorFailure } from "@xeon/contracts/records";
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

/** 이벤트마다 행 하나(event id, kind)를 쓰는 확장 투영기. `failWhen`이 참인 이벤트에서 던진다 */
function logProjector(options: {
  readonly name: string;
  readonly table: string;
  readonly failWhen?: (event: DurableEventEnvelope) => boolean;
}): { readonly projector: Projector; readonly calls: () => number } {
  let calls = 0;
  const projector: Projector = {
    name: options.name,
    version: 1,
    tables: [options.table],
    ddl: [`CREATE TABLE ${options.table} (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL) STRICT`],
    kinds: "all",
    apply(tx, event) {
      calls += 1;
      if (options.failWhen?.(event) === true) {
        throw new Error(`${options.name} exploded on ${event.kind}`);
      }
      tx.run(`INSERT INTO ${options.table} (event_id, kind) VALUES (?, ?)`, [event.id, event.kind]);
    },
  };
  return { projector, calls: () => calls };
}

const FLAKY = { name: "ext.flaky", table: "x_flaky_log" } as const;
const STEADY = { name: "ext.steady", table: "x_steady_log" } as const;

/** item.recorded 이벤트(턴의 user item)에서 던지게 하는 조건 */
const failsOnItem = (event: DurableEventEnvelope): boolean => event.kind === "item.recorded";

function eventKinds(h: Harness): readonly string[] {
  return h.store.raw
    .query<{ kind: string }, []>("SELECT kind FROM events ORDER BY seq")
    .all()
    .map((row) => row.kind);
}

function loggedKinds(h: Harness, table: string): readonly string[] {
  return h.store.raw
    .query<{ kind: string }, []>(`SELECT kind FROM ${table} ORDER BY rowid`)
    .all()
    .map((row) => row.kind);
}

// spec §4.5.2, M3-REQ-36: 확장 투영기 예외는 롤백, 정지, 알림, 같은 요청 재시도로 격리한다
describe("extension projector isolation (M3-REQ-36)", () => {
  test("extension_failure_suspends_rolls_back_and_retries", async () => {
    const h = await openHarness();
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    expectOk(
      h.service.projectors.register(logProjector({ ...FLAKY, failWhen: failsOnItem }).projector),
    );
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const key = `turn:${turn.turnId}:start`;

    // 코어 행은 모두 있다: 이벤트 세 개(thread.started는 생성 때), thread, turn, item
    expect(eventKinds(h)).toEqual(["thread.started", "turn.started", "item.recorded"]);
    expect(h.store.rowCounts()).toMatchObject({ p_threads: 1, p_turns: 1, p_items: 1 });
    // 확장 테이블에는 정지 전의 thread.started 행만 있다. 실패한 커밋의 행은 없다
    expect(loggedKinds(h, FLAKY.table)).toEqual(["thread.started"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ projector: "ext.flaky", requestId: key });
    expect(failures[0]?.event.kind).toBe("item.recorded");
    // 정지한 투영기는 목록에 남는다
    expect(h.service.projectors.list().map((entry) => entry.name)).toEqual(["core", "ext.flaky"]);
    expect(h.logs).toContain("error:session.projector_suspended");

    // 재시도는 같은 키로 처음 커밋으로 남는다(key_reused나 중복이 아니다). build는 다시 불리지 않는다
    const replay = expectOk(
      h.service.commit({
        threadId,
        requestId: key,
        fingerprintSource: { key },
        build: () => {
          throw new Bug("store.test_build_rerun: a replayed request must not call build");
        },
      }),
    );
    expect(replay).toMatchObject({ status: "committed", replayed: true });
    expectProjectionsRebuildable(h.store.db);
  });

  test("suspended_projector_is_not_applied_or_notified_again", async () => {
    const h = await openHarness();
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    const flaky = logProjector({ ...FLAKY, failWhen: failsOnItem });
    expectOk(h.service.projectors.register(flaky.projector));
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    const callsAfterFailure = flaky.calls();

    endTurn(h, turn);

    expect(flaky.calls()).toBe(callsAfterFailure);
    expect(failures).toHaveLength(1);
    expect(eventKinds(h)).toEqual([
      "thread.started",
      "turn.started",
      "item.recorded",
      "turn.completed",
    ]);
    expect(loggedKinds(h, FLAKY.table)).toEqual(["thread.started"]);
    expectProjectionsRebuildable(h.store.db);
  });

  test("healthy_projector_keeps_rows_while_failing_one_is_suspended", async () => {
    const h = await openHarness();
    expectOk(
      h.service.projectors.register(logProjector({ ...FLAKY, failWhen: failsOnItem }).projector),
    );
    expectOk(h.service.projectors.register(logProjector(STEADY).projector));
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    endTurn(h, turn);

    expect(loggedKinds(h, STEADY.table)).toEqual([
      "thread.started",
      "turn.started",
      "item.recorded",
      "turn.completed",
    ]);
    expect(loggedKinds(h, FLAKY.table)).toEqual(["thread.started"]);
    expect(h.service.projectors.list().map((entry) => entry.name)).toEqual([
      "core",
      "ext.flaky",
      "ext.steady",
    ]);
    expectProjectionsRebuildable(h.store.db);
  });

  test("restart_registration_rebuilds_suspended_projector", async () => {
    const h = await openHarness();
    expectOk(
      h.service.projectors.register(logProjector({ ...FLAKY, failWhen: failsOnItem }).projector),
    );
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    endTurn(h, turn);
    // 정지한 뒤 커밋한 turn.completed까지 표에 없다
    expect(loggedKinds(h, FLAKY.table)).toEqual(["thread.started"]);

    // 프로세스를 다시 연다. 같은 DB에 새 서비스를 올리고 등록부는 비어 있다
    const reopened = await reopenHarness(h);
    expectOk(reopened.service.projectors.register(logProjector(FLAKY).projector));

    expect(loggedKinds(reopened, FLAKY.table)).toEqual([
      "thread.started",
      "turn.started",
      "item.recorded",
      "turn.completed",
    ]);
    expect(loggedKinds(reopened, FLAKY.table)).toEqual(eventKinds(reopened));
    expectProjectionsRebuildable(reopened.store.db);
  });

  test("next_write_open_rebuilds_suspended_projector", async () => {
    const h = await openHarness();
    let poisoned = true;
    const flaky = logProjector({
      ...FLAKY,
      failWhen: (event) => poisoned && failsOnItem(event),
    });
    expectOk(h.service.projectors.register(flaky.projector));
    const { threadId, token } = newThread(h);
    const turn = startTurn(h, threadId);
    endTurn(h, turn);
    expect(loggedKinds(h, FLAKY.table)).toEqual(["thread.started"]);

    // 원인을 고친 뒤 다음 쓰기 열기(ensure)가 이벤트에서 다시 만든다
    poisoned = false;
    expectOk(h.service.openForWrite(threadId, token));
    expect(loggedKinds(h, FLAKY.table)).toEqual(eventKinds(h));

    // 다시 활성이므로 다음 커밋에 들어간다
    startTurn(h, threadId);
    expect(loggedKinds(h, FLAKY.table)).toEqual(eventKinds(h));
    expectProjectionsRebuildable(h.store.db);
  });

  test("one_later_event_failure_does_not_stop_session", async () => {
    const h = await openHarness();
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    let items = 0;
    const flaky = logProjector({
      ...FLAKY,
      // 두 번째 user item에서만 던진다
      failWhen: (event) => {
        if (!failsOnItem(event)) return false;
        items += 1;
        return items === 2;
      },
    });
    expectOk(h.service.projectors.register(flaky.projector));
    const { threadId } = newThread(h);
    const first = startTurn(h, threadId);
    const second = startTurn(h, threadId);
    const third = startTurn(h, threadId);
    endTurn(h, third);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      projector: "ext.flaky",
      requestId: `turn:${second.turnId}:start`,
    });
    // 첫 턴의 행만 있다. 정지 뒤의 턴은 확장 테이블에 들어가지 않는다
    expect(loggedKinds(h, FLAKY.table)).toEqual([
      "thread.started",
      "turn.started",
      "item.recorded",
    ]);
    expect(h.store.rowCounts()).toMatchObject({ p_turns: 3, p_items: 3 });
    expect(first.turnId).not.toBe(second.turnId);
    expectProjectionsRebuildable(h.store.db);
  });

  test("two_failing_extensions_take_two_retries", async () => {
    const h = await openHarness();
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    expectOk(
      h.service.projectors.register(
        logProjector({
          name: "ext.early",
          table: "x_early_log",
          failWhen: (event) => event.kind === "turn.started",
        }).projector,
      ),
    );
    expectOk(
      h.service.projectors.register(logProjector({ ...FLAKY, failWhen: failsOnItem }).projector),
    );
    const { threadId } = newThread(h);
    startTurn(h, threadId);

    expect(failures.map((failure) => failure.projector)).toEqual(["ext.early", "ext.flaky"]);
    expect(h.service.projectors.list().map((entry) => entry.name)).toEqual([
      "core",
      "ext.early",
      "ext.flaky",
    ]);
    expect(loggedKinds(h, "x_early_log")).toEqual(["thread.started"]);
    expect(loggedKinds(h, FLAKY.table)).toEqual(["thread.started"]);
    expect(eventKinds(h)).toEqual(["thread.started", "turn.started", "item.recorded"]);
    expectProjectionsRebuildable(h.store.db);
  });

  test("core_projection_failure_stays_a_bug", async () => {
    const h = await openHarness();
    const failures: ProjectorFailure[] = [];
    h.service.projectors.onFailure((failure) => {
      failures.push(failure);
    });
    expectOk(h.service.projectors.register(logProjector(FLAKY).projector));
    const { threadId } = newThread(h);
    // 같은 requestId의 두 번째 turn은 코어 투영의 색인 위반이다
    startTurn(h, threadId, { requestId: "dup" });
    const before = h.store.tableHashes();

    expect(() => startTurn(h, threadId, { requestId: "dup" })).toThrow("store.projection_failed");

    expect(h.store.tableHashes()).toEqual(before);
    expect(failures).toHaveLength(0);
    expect(h.service.projectors.list().map((entry) => entry.name)).toEqual(["core", "ext.flaky"]);
    expect(h.logs).not.toContain("error:session.projector_suspended");
    expectProjectionsRebuildable(h.store.db);
  });
});
