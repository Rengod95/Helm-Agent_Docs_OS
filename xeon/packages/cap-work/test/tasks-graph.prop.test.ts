import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import { Type } from "typebox";
import type { TaskOp, WorkTask } from "@xeon/contracts/capabilities";
import { planWrite } from "../src/tasks/write.ts";
import seedsJson from "./property/seeds.json" with { type: "json" };
import { seededRandom } from "./support/clock.ts";
import { tid } from "./support/tasks.ts";

const SeedsSchema = Type.Array(Type.Integer({ minimum: 0, maximum: 2 ** 32 - 1 }), {
  maxItems: 1024,
});
const seeds = parse(SeedsSchema, seedsJson);
if (!seeds.ok)
  throw new Bug("property/seeds.json does not match SeedsSchema", { cause: seeds.error });

const NODES = 30;

/** 순환이 없는지 위상 정렬로 확인한다 */
function isAcyclic(tasks: readonly WorkTask[]): boolean {
  const indegree = new Map<string, number>(tasks.map((t) => [t.id, t.blockedBy.length]));
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    for (const blocker of t.blockedBy) {
      const list = dependents.get(blocker) ?? [];
      list.push(t.id);
      dependents.set(blocker, list);
    }
  }
  const ready: string[] = tasks.filter((t) => t.blockedBy.length === 0).map((t) => t.id);
  let seen = 0;
  while (ready.length > 0) {
    const next = ready.pop();
    if (next === undefined) break;
    seen += 1;
    for (const dependent of dependents.get(next) ?? []) {
      const left = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }
  return seen === tasks.length;
}

describe("link never leaves a cycle", () => {
  for (const seed of seeds.value) {
    test(`1000 random edges keep the graph acyclic (seed ${seed})`, () => {
      const random = seededRandom(seed);
      const creates: TaskOp[] = Array.from({ length: NODES }, (_, index) => ({
        op: "create",
        content: `node ${index}`,
      }));
      const created = planWrite({ tasks: [], nextOrd: 1, autoStart: false }, creates);
      if (!created.ok) throw new Bug("setup failed");
      let tasks: readonly WorkTask[] = created.value.tasks;
      let rejected = 0;
      for (let step = 0; step < 1000; step += 1) {
        const a = tid(`t${1 + Math.floor(random() * NODES)}`);
        const b = tid(`t${1 + Math.floor(random() * NODES)}`);
        const op: TaskOp =
          random() < 0.8
            ? { op: "link", id: a, blockedBy: [b] }
            : { op: "unlink", id: a, blockedBy: [b] };
        const planned = planWrite({ tasks, nextOrd: NODES + 1, autoStart: false }, [op]);
        if (planned.ok) tasks = planned.value.tasks;
        else {
          expect(
            planned.error.failure.kind === "task_cycle" ||
              planned.error.failure.kind === "invalid_input",
          ).toBe(true);
          rejected += 1;
        }
        expect(isAcyclic(tasks)).toBe(true);
      }
      // 거부가 한 번도 없으면 이 시험은 순환 검사를 건드리지 못한 것이다
      expect(rejected).toBeGreaterThan(0);
    });
  }
});
