import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { budgetClassOf, DEFAULT_BUDGETS_MS, extReadViewOf } from "../../src/index.ts";
import { HOOKS } from "@fresnel/contracts/extensions";
import { createTestHost, flushMicrotasks } from "../../src/testing/index.ts";
import { makeGroupUnit } from "./fixtures/support.ts";

// X.primitives.spec §4.4.9: 조립 루트가 wire 확장 읽기에 쓰는 읽기 전용 조회

test("threadStatus: unknown for a thread that is not open, then enabled, disabling after a thread-only disable", async () => {
  const t = await createTestHost();
  await t.host.install(makeGroupUnit({ name: "scp-group", hooks: [] }, () => {}));
  const view = extReadViewOf(t.host);
  const thread = t.newThread();
  expect(view.threadStatus(thread, "scp-group")).toBeUndefined();
  await t.host.openThread(thread);
  await t.settled();
  expect(view.threadStatus(thread, "scp-group")).toBe("enabled");
  expect(view.threadStatus(thread, "no-such-scope")).toBeUndefined();
  t.host.registration("scp-group")?.disable();
  expect(view.threadStatus(thread, "scp-group")).toBe("disabling");
  const other: ThreadId = t.newThread();
  expect(view.threadStatus(other, "scp-group")).toBeUndefined();
});

test("driveLock: no holder and no wait for an idle thread, the holder and its limits once a drive holds the lock", async () => {
  const t = await createTestHost();
  const view = extReadViewOf(t.host);
  const thread = t.newThread();
  expect(view.driveLock(thread)).toBeUndefined();
  await t.host.install(
    makeGroupUnit({ name: "driver", hooks: [] }, (g) => {
      g.drive(async () => {
        await new Promise<void>(() => {});
      });
    }),
  );
  await t.host.openThread(thread);
  // 끝나지 않는 drive 호출은 추적 작업이라 settled를 막는다
  await flushMicrotasks(50);
  const locked = view.driveLock(thread);
  expect(locked?.holder).toBe("driver");
  expect(locked?.used).toEqual({ turns: 0, spawns: 0, tokens: 0 });
  expect(locked?.candidates).toEqual([]);
  expect(locked?.leaseEpoch).toBeGreaterThan(0);
});

test("budgetClassOf and DEFAULT_BUDGETS_MS are public: a first hook uses the first-class default", () => {
  expect(budgetClassOf(HOOKS["tool.call.before"])).toBe("first");
  expect(DEFAULT_BUDGETS_MS.first).toBe(30_000);
  expect(DEFAULT_BUDGETS_MS.streamTap).toBe(1_000);
});
