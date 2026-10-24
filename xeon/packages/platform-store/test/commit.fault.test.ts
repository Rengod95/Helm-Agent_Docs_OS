import { afterEach, describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import type { FaultPoint, LeaseToken } from "@xeon/contracts/records";
import { faultAt, openTestStore, type TestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { disposableWith } from "./support/fixture.ts";
import { applyTables } from "./support/migrate.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const THREAD = "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";
const REQUEST = "in:user:01JA2Z7Q8M3XK4V9TB6N0PRWES";

/** eng.transactions.design §4.2 FaultPoint의 10개 지점(번호가 붙는 셋은 대표로 0번과 1번) */
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

async function openFixture(
  point: FaultPoint,
): Promise<
  { store: TestStore; token: LeaseToken; fault: ReturnType<typeof faultAt> } & AsyncDisposable
> {
  const clock = manualClock();
  const fault = faultAt(point);
  fault.armed = false;
  const store = await openTestStore({
    clock,
    ids: fixedIdFactory(clock),
    faults: fault.injector,
  });
  // core-persistence가 만들 테이블의 모양만 흉내 낸 참조 픽스처
  store.root.write((tx) => {
    tx.run(
      "CREATE TABLE events (seq INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, kind TEXT NOT NULL, request_id TEXT NOT NULL) STRICT",
    );
    tx.run(
      "CREATE TABLE event_seq (id INTEGER PRIMARY KEY CHECK (id = 1), next_seq INTEGER NOT NULL) STRICT",
    );
    tx.run("INSERT INTO event_seq (id, next_seq) VALUES (1, 1)");
    tx.run(
      "CREATE TABLE requests (request_id TEXT PRIMARY KEY, first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL) STRICT",
    );
    tx.run("CREATE TABLE step_checkpoints (seq INTEGER PRIMARY KEY, state TEXT NOT NULL) STRICT");
    tx.run("CREATE TABLE p_probe (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL) STRICT");
  });
  store.service.extensions.register("probe");
  applyTables(store.service, "ext.probe", [
    "CREATE TABLE x_probe_items (seq INTEGER PRIMARY KEY) STRICT",
  ]);
  const token = store.service.leases.acquire(`session:${THREAD}`, {
    holderId: "holder-1",
    kind: "cli",
    pid: process.pid,
    startedAt: 1,
    host: "test-machine",
  });
  if (!token.ok) throw new Error("lease failed");
  return disposableWith(store, { store, token: token.value, fault });
}

/** SessionWriter.commit의 순서를 따른 참조 커밋(eng.transactions.design §4.4). 지점마다 faults.hit을 부른다 */
function referenceCommit(store: TestStore, token: LeaseToken): { replayed: boolean } {
  const faults = store.faults;
  const written = store.root.write((tx) => {
    faults.hit("after_begin");
    const held = store.service.leases.holds(tx, token);
    if (!held.ok || !held.value) throw new Bug("ownership_lost");
    faults.hit("after_lease_check");
    if (tx.get("SELECT request_id FROM requests WHERE request_id = ?", [REQUEST]) !== undefined) {
      return { replayed: true };
    }
    faults.hit("after_request_check");
    const next = Number(tx.get("SELECT next_seq FROM event_seq WHERE id = 1")?.["next_seq"]);
    for (let i = 0; i < 2; i += 1) {
      tx.run(
        "INSERT INTO events (seq, thread_id, kind, request_id) VALUES (?, ?, 'turn.started', ?)",
        [next + i, THREAD, REQUEST],
      );
      faults.hit(`after_event_insert:${i}`);
      tx.run("INSERT INTO p_probe (seq, kind) VALUES (?, 'turn.started')", [next + i]);
      faults.hit(`after_projection:${i}`);
      tx.run("INSERT INTO x_probe_items (seq) VALUES (?)", [next + i]);
      faults.hit(`after_ext_projection:${i}`);
    }
    faults.hit("before_checkpoint");
    tx.run("INSERT INTO step_checkpoints (seq, state) VALUES (?, 'waiting')", [next + 1]);
    faults.hit("before_request_insert");
    tx.run("INSERT INTO requests (request_id, first_seq, last_seq) VALUES (?, ?, ?)", [
      REQUEST,
      next,
      next + 1,
    ]);
    tx.run("UPDATE event_seq SET next_seq = ? WHERE id = 1", [next + 2]);
    faults.hit("before_commit");
    return { replayed: false };
  });
  if (!written.ok) throw new Error(`write failed: ${written.error.kind}`);
  faults.hit("after_commit");
  return written.value;
}

function integrity(store: TestStore): unknown {
  const result = store.root.read((tx) => tx.get("PRAGMA integrity_check"));
  return result.ok ? result.value : undefined;
}

const byName = (a: string, b: string): number => a.localeCompare(b);

describe("fault points keep the store consistent", () => {
  for (const point of BEFORE_COMMIT) {
    test(`${point} leaves no partial commit`, async () => {
      const fixture = own(await openFixture(point));
      const { store, token, fault } = fixture;
      const counts = await store.rowCounts();
      const digests = await store.rowDigests();
      fault.armed = true;
      expect(() => referenceCommit(store, token)).toThrow(`fault:${point}`);
      expect(await store.rowCounts()).toEqual(counts);
      expect(await store.rowDigests()).toEqual(digests);
      expect(integrity(store)).toEqual({ integrity_check: "ok" });
      // 같은 커밋 키로 다시 제출하면 처음 시도와 같은 결과로 성공한다
      fault.armed = false;
      expect(referenceCommit(store, token)).toEqual({ replayed: false });
      expect((await store.rowCounts())["events"]).toBe(2);
    });
  }

  test("after_commit keeps every row and the retry is replayed", async () => {
    const fixture = own(await openFixture("after_commit"));
    const { store, token, fault } = fixture;
    fault.armed = true;
    expect(() => referenceCommit(store, token)).toThrow("fault:after_commit");
    const after = await store.rowCounts();
    expect(after["events"]).toBe(2);
    expect(after["requests"]).toBe(1);
    expect(integrity(store)).toEqual({ integrity_check: "ok" });
    fault.armed = false;
    expect(referenceCommit(store, token)).toEqual({ replayed: true });
    expect(await store.rowCounts()).toEqual(after);
  });

  test("the fixture covers every kind of F fault point", () => {
    const kinds = new Set(BEFORE_COMMIT.map((point) => point.split(":")[0]));
    expect(
      [...kinds, "after_commit"].filter((kind) => kind !== undefined).toSorted(byName),
    ).toEqual(
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
      ].toSorted(byName),
    );
  });

  test("a writer that lost its lease is fenced before any row is written", async () => {
    const fixture = own(await openFixture("after_begin"));
    const { store, token } = fixture;
    store.root.write((tx) =>
      tx.run("UPDATE sys_leases SET epoch = epoch + 1, holder_id = 'other' WHERE resource = ?", [
        token.resource,
      ]),
    );
    const counts = await store.rowCounts();
    expect(() => referenceCommit(store, token)).toThrow("ownership_lost");
    expect(await store.rowCounts()).toEqual(counts);
  });
});
