import { afterEach, describe, expect, test } from "bun:test";
import { WorkGoals, WorkPlans, WorkReports, WorkTasks } from "@xeon/contracts/capabilities";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rejection } from "./support/assertions.ts";
import { asCaller, gid } from "./support/goals.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { PlanId } from "./support/plans.ts";
import { tid } from "./support/tasks.ts";

// M3-REQ-88·89, ADR-0015 §3.6, L2.work.spec §3.1: 멱등 쓰기 아홉 개는 같은 requestId를 두 번 불러도 효과가 한 번이고 결과가 같다.
// 두 번째 호출은 저장소를 닫았다 다시 연 새 프로세스에서 한다. 이벤트 수와 투영 표의 내용이 그대로여야 한다.
// plans.enterMode·exitMode(권한 모드는 L1.tools 소유)와 plans.approve·reject·revise(결정은 승인 해결 하나에 기록됨)는
// requestId를 기억하지 않아 선언 없음이다(spec §3.9). 이 적합성 시험이 뒤의 세 메서드를 드러냈다.

const dirs: string[] = [];
const harnesses: Harness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h[Symbol.asyncDispose]()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Case {
  readonly name: string;
  /** 앞선 상태를 만들고 시험할 호출을 돌려준다. 호출은 대상 하네스와 requestId를 받는다 */
  readonly setup: (h: Harness) => Promise<(target: Harness, requestId: string) => Promise<unknown>>;
}

const PLAN = { title: "Refactor", body: "1. split\n2. test" };

const CLASSES: readonly string[] = [
  ...Object.entries(WorkTasks.service.methods),
  ...Object.entries(WorkPlans.service.methods),
  ...Object.entries(WorkGoals.service.methods),
  ...Object.entries(WorkReports.service.methods),
].map(([name, method]) => {
  const effect =
    method.readOnly === true ? "readOnly" : method.idempotent === true ? "idempotent" : "none";
  return `${name} ${effect} ${method.replay ?? "unsafe"}`;
});

async function withPlan(h: Harness): Promise<void> {
  await h.plans.submit(PLAN, h.opts("setup-plan"));
}

const CASES: readonly Case[] = [
  {
    name: "work.tasks.create",
    setup: () => Promise.resolve((t, key) => t.api.create({ content: "write tests" }, t.opts(key))),
  },
  {
    name: "work.tasks.update",
    setup: async (h) => {
      await h.api.create({ content: "write tests" }, h.opts("setup-1"));
      return (t, key) => t.api.update({ id: tid("t1"), status: "in_progress" }, t.opts(key));
    },
  },
  {
    name: "work.tasks.link",
    setup: async (h) => {
      await h.api.create({ content: "a" }, h.opts("setup-1"));
      await h.api.create({ content: "b" }, h.opts("setup-2"));
      return (t, key) =>
        t.api.link({ id: tid("t2"), blockedBy: [tid("t1")], op: "add" }, t.opts(key));
    },
  },
  {
    name: "work.tasks.write",
    setup: () =>
      Promise.resolve((t, key) =>
        t.api.write(
          {
            ops: [
              { op: "create", ref: "@a", content: "design" },
              { op: "create", content: "build", blockedBy: ["@a"] },
            ],
          },
          t.opts(key),
        ),
      ),
  },
  {
    name: "work.plans.submit",
    setup: () => Promise.resolve((t, key) => t.plans.submit(PLAN, t.opts(key))),
  },
  {
    name: "work.goals.set",
    setup: () => Promise.resolve((t, key) => t.goals.set({ condition: "tests pass" }, t.opts(key))),
  },
  {
    name: "work.goals.clear",
    setup: async (h) => {
      await h.goals.set({ condition: "tests pass" }, h.opts("setup-goal"));
      return (t, key) => t.goals.clear({}, t.opts(key));
    },
  },
  {
    name: "work.goals.judge",
    setup: async (h) => {
      await h.goals.set(
        { condition: "checked by a group", judge: { kind: "delegated", owner: "checker" } },
        h.opts("setup-goal"),
      );
      const turnId = h.completeTurn();
      return (t, key) =>
        t.goals.judge(
          { goalId: gid("g1"), turnId, verdict: { met: true, reason: "shown", missing: [] } },
          asCaller(t.opts(key), { kind: "host" }, t.threadId),
        );
    },
  },
  {
    name: "work.reports.build",
    setup: async (h) => {
      const turnId = h.completeTurn();
      return (t, key) => t.reports.build({ subject: { kind: "turn", turnId } }, t.opts(key));
    },
  },
];

describe("work effect classes", () => {
  test("the declared classes follow the spec table", () => {
    expect(CLASSES).toEqual([
      "create idempotent safe",
      "update idempotent safe",
      "link idempotent safe",
      "list readOnly safe",
      "write idempotent safe",
      "enterMode none unsafe",
      "exitMode none unsafe",
      "submit idempotent safe",
      "approve none unsafe",
      "reject none unsafe",
      "revise none unsafe",
      "versions readOnly safe",
      "set idempotent safe",
      "status readOnly safe",
      "clear idempotent safe",
      "judge idempotent safe",
      "build idempotent safe",
    ]);
  });
});

describe("work writes dedupe on requestId across a store reopen", () => {
  for (const { name, setup } of CASES) {
    test(name, async () => {
      const dir = mkdtempSync(join(tmpdir(), "xeon-work-idem-"));
      dirs.push(dir);
      const path = join(dir, "xeon.db");
      const first = await openHarness({ path });
      harnesses.push(first);
      const call = await setup(first);

      const before = first.eventCount();
      const applied = await call(first, "idem-key");
      const events = first.eventCount();
      expect(events).toBeGreaterThan(before);
      const digests = await first.workDigests();
      const thread = first.threadId;
      await first[Symbol.asyncDispose]();
      harnesses.splice(harnesses.indexOf(first), 1);

      const reopened = await openHarness({ path, thread, idSeed: 2 });
      harnesses.push(reopened);
      const replayed = await call(reopened, "idem-key");

      expect(replayed).toEqual(applied);
      expect(reopened.eventCount()).toBe(events);
      expect(await reopened.workDigests()).toEqual(digests);
    });
  }

  test("a plan decision does not remember its requestId, so a repeat with the same key is plan_closed", async () => {
    const h = await openHarness();
    harnesses.push(h);
    await withPlan(h);
    const first = await h.plans.approve({ planId: PlanId("p1") }, h.opts("decide-1"));
    expect(first.plan.status).toBe("approved");
    const repeated = await rejection(h.plans.approve({ planId: PlanId("p1") }, h.opts("decide-1")));
    expect(repeated.data.code).toBe("plan_closed");
  });

  test("a different requestId is a new write", async () => {
    const h = await openHarness();
    harnesses.push(h);
    await h.goals.set({ condition: "one" }, h.opts("a"));
    const events = h.eventCount();
    await h.goals.clear({}, h.opts("b"));
    expect(h.eventCount()).toBeGreaterThan(events);
  });
});
