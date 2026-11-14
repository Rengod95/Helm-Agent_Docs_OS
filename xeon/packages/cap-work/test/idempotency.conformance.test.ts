import { afterEach, describe, expect, test } from "bun:test";
import { WorkGoals, WorkPlans, WorkReports, WorkTasks } from "@fresnel/contracts/capabilities";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asCaller, gid } from "./support/goals.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { tid } from "./support/tasks.ts";

// M3-REQ-88·89, ADR-0015 §3.6, L2.work.spec §3.1: 멱등 쓰기 여덟 개는 같은 requestId를 두 번 불러도 효과가 한 번이고 결과가 같다.
// 두 번째 호출은 저장소를 닫았다 다시 연 새 프로세스에서 한다. 이벤트 수와 투영 표의 내용이 그대로여야 한다.
// 계획 쓰기(submit, approve, reject, revise, enterMode, exitMode)는 계획 모드와 함께 없앴다 [결정: 2026-11-13 사용자].
// work.plans는 옛 기록을 읽는 versions뿐이라 쓰기가 없다.

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
      const dir = mkdtempSync(join(tmpdir(), "fresnel-work-idem-"));
      dirs.push(dir);
      const path = join(dir, "fresnel.db");
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

  test("a different requestId is a new write", async () => {
    const h = await openHarness();
    harnesses.push(h);
    await h.goals.set({ condition: "one" }, h.opts("a"));
    const events = h.eventCount();
    await h.goals.clear({}, h.opts("b"));
    expect(h.eventCount()).toBeGreaterThan(events);
  });
});
