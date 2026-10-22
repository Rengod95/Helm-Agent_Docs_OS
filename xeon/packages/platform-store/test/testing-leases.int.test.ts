import { afterEach, describe, expect, test } from "bun:test";
import { openTestStore, TEST_HOLDER_A, TEST_HOLDER_B } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { own, releaseOwned } from "./support/own.ts";

// M-04: core-persistence 시험이 쓰던 제자리 저장소 대역(takeover, loseLease)을 실제 저장소 위에서 흉내 내는 도우미.

afterEach(releaseOwned);

const SESSION = "session:thr_01HZZZZZZZZZZZZZZZZZZZZZZZ";

async function open() {
  const clock = manualClock();
  return own(await openTestStore({ clock, scheduler: clock, ids: fixedIdFactory(clock) }));
}

function acquired(
  result: ReturnType<Awaited<ReturnType<typeof open>>["service"]["leases"]["acquire"]>,
) {
  if (!result.ok) throw new Error(`acquire failed: ${result.error.kind}`);
  return result.value;
}

describe("test store lease helpers", () => {
  test("holder fixtures are two different engine instances", () => {
    expect(TEST_HOLDER_A.holderId).not.toBe(TEST_HOLDER_B.holderId);
    expect(TEST_HOLDER_A.pid).not.toBe(TEST_HOLDER_B.pid);
  });

  test("takeover moves the lease to another holder with a higher epoch and fences the old token", async () => {
    const store = await open();
    const first = acquired(store.service.leases.acquire(SESSION, TEST_HOLDER_A));
    const taken = store.takeover(SESSION, TEST_HOLDER_B);
    expect(taken).toEqual({
      resource: SESSION,
      holderId: TEST_HOLDER_B.holderId,
      epoch: first.epoch + 1,
    });
    const owner = store.service.leases.inspect(SESSION);
    expect(owner.ok && owner.value?.holderId).toBe(TEST_HOLDER_B.holderId);
    const holds = store.root.write((tx) => store.service.leases.holds(tx, first));
    expect(holds.ok && holds.value.ok && holds.value.value).toBe(false);
    const holdsNew = store.root.write((tx) => store.service.leases.holds(tx, taken));
    expect(holdsNew.ok && holdsNew.value.ok && holdsNew.value.value).toBe(true);
  });

  test("takeover of a resource nobody holds starts at epoch 1", async () => {
    const store = await open();
    expect(store.takeover(SESSION, TEST_HOLDER_B).epoch).toBe(1);
  });

  test("loseLease calls the keepAlive callback once and stops after dispose", async () => {
    const store = await open();
    const token = acquired(store.service.leases.acquire(SESSION, TEST_HOLDER_A));
    const lost: string[] = [];
    const watch = store.leases.keepAlive(token, (resource) => {
      lost.push(resource);
    });
    store.loseLease(SESSION);
    expect(lost).toEqual([SESSION]);
    watch[Symbol.dispose]();
    store.loseLease(SESSION);
    expect(lost).toEqual([SESSION]);
  });
});
