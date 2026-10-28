import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { SessionRetention } from "@xeon/contracts/records";
import { DEFAULT_PERSISTENCE_SETTINGS, type PersistenceSettings } from "../src/index.ts";
import { completeTurn, itemAt } from "./support/branching.ts";
import {
  expectOk,
  newThread,
  openHarness,
  startTurn,
  type Harness,
  type NewThread,
} from "./support/harness.ts";

const DAY = 86_400_000;

function withSettings(overrides: Partial<PersistenceSettings>): () => PersistenceSettings {
  return () => ({ ...DEFAULT_PERSISTENCE_SETTINGS, ...overrides });
}

/** thread를 만들어 한 turn을 끝내고, 쓰기 소유를 놓는다(보관 정리 후보가 되는 상태) */
async function aged(
  h: Harness,
  title: string,
  state: "completed" | "open_turn" = "completed",
): Promise<NewThread> {
  const created = newThread(h, title);
  if (state === "completed") completeTurn(h, created.threadId);
  else startTurn(h, created.threadId);
  await h.service.release(created.threadId, "quit");
  h.store.leases.release(created.token);
  h.clock.advance(DAY);
  return created;
}

function threadIds(h: Harness): ThreadId[] {
  return h.service.threads
    .list({ includeClosed: true, limit: 200 })
    .threads.map((row) => row.threadId);
}

describe("retention", () => {
  // spec plan retention_prunes_only_eligible_threads
  test("retention_prunes_only_eligible_threads: age limit keeps marker, fork-source and owned threads", async () => {
    const h = await openHarness({ settings: withSettings({ retentionMaxAgeDays: 3 }) });
    const old = await aged(h, "old");
    const marker = await aged(h, "marker", "open_turn"); // 열린 turn이 남은 thread
    const source = await aged(h, "source");
    // 오래된 thread에서 포크한 thread가 있으면 그 원본은 남는다
    const owner = newThread(h, "owner");
    const forkSource = newThread(h, "fork-source");
    completeTurn(h, forkSource.threadId);
    const forkId = h.ids.next("thr");
    expectOk(
      await h.service.threads.fork(
        forkSource.threadId,
        itemAt(h, forkSource.threadId, 0).itemId,
        forkId,
      ),
    );
    await h.service.release(forkSource.threadId, "quit");
    h.store.leases.release(forkSource.token);
    h.clock.advance(10 * DAY);
    // 쓰기 소유 중인 thread(owner)도 낡았지만 남는다
    const planned = expectOk(h.retention.preview());
    expect(planned).toEqual([old.threadId, source.threadId, forkId]);
    expect(threadIds(h)).toHaveLength(6);
    expect(expectOk(h.retention.prune())).toEqual(planned);
    const left = threadIds(h);
    expect(left).toContain(marker.threadId);
    expect(left).toContain(owner.threadId);
    // 포크가 지워진 같은 라운드에도 원본은 계획 때 포크가 가리키고 있었으므로 남는다
    expect(left).toContain(forkSource.threadId);
    expect(left).not.toContain(old.threadId);
    expect(left).not.toContain(forkId);
    // 다음 정리는 이제 가리키는 포크가 없는 원본을 지운다
    expect(expectOk(h.retention.prune())).toEqual([forkSource.threadId]);
    expect(expectOk(h.retention.prune())).toEqual([]);
  });

  test("the count limit removes the oldest eligible threads first", async () => {
    const h = await openHarness({ settings: withSettings({ retentionMaxCount: 2 }) });
    const first = await aged(h, "first");
    const second = await aged(h, "second");
    const third = await aged(h, "third");
    const fourth = await aged(h, "fourth");
    expect(expectOk(h.retention.preview())).toEqual([first.threadId, second.threadId]);
    expectOk(h.retention.prune());
    expect(threadIds(h).toSorted()).toEqual([third.threadId, fourth.threadId].toSorted());
  });

  test("SessionService.retention (contract type) previews and prunes the same threads as RetentionApi", async () => {
    const h = await openHarness({ settings: withSettings({ retentionMaxCount: 1 }) });
    const first = await aged(h, "first");
    const second = await aged(h, "second");
    const contract: SessionRetention = h.service.retention;
    expect(expectOk(contract.preview())).toEqual([first.threadId]);
    expect(expectOk(contract.prune())).toEqual([first.threadId]);
    expect(threadIds(h)).toEqual([second.threadId]);
  });

  test("both limits off removes nothing", async () => {
    const h = await openHarness({ settings: withSettings({}) });
    await aged(h, "kept");
    h.clock.advance(1000 * DAY);
    expect(expectOk(h.retention.preview())).toEqual([]);
    expect(expectOk(h.retention.prune())).toEqual([]);
  });
});
