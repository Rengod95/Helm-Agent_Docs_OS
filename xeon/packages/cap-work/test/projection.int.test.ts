import { afterEach, describe, expect, test } from "bun:test";
import { Bug, eachAsync, parse } from "@xeon/contracts";
import { Type } from "typebox";
import type { TaskOp, WorkTask } from "@xeon/contracts/capabilities";
import { readMeta, readTasks } from "../src/projection/read.ts";
import { planWrite } from "../src/tasks/write.ts";
import { rejection } from "./support/assertions.ts";
import { seededRandom } from "./support/clock.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { DEFAULT_WORK_SETTINGS } from "../src/settings.ts";
import { tid } from "./support/tasks.ts";
import seedsJson from "./property/seeds.json" with { type: "json" };

const SeedsSchema = Type.Array(Type.Integer({ minimum: 0, maximum: 2 ** 32 - 1 }), {
  maxItems: 1024,
});
const seeds = parse(SeedsSchema, seedsJson);
if (!seeds.ok)
  throw new Bug("property/seeds.json does not match SeedsSchema", { cause: seeds.error });

let opened: Harness | undefined;

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

const STATUSES = ["pending", "in_progress", "completed", "failed", "cancelled"] as const;
const NODES = 12;

/** 모든 연산 종류를 섞은 무작위 연산 하나. 대부분 유효하고 일부는 규칙에 걸린다 */
function randomOp(random: () => number, count: number): TaskOp {
  const pick = (): string => `t${1 + Math.floor(random() * Math.max(count, 1))}`;
  const roll = random();
  if (roll < 0.25 && count < NODES) {
    const blocked = count > 0 && random() < 0.5 ? [pick()] : undefined;
    return {
      op: "create",
      content: `task ${count + 1}`,
      ...(random() < 0.3 ? { activeForm: `doing ${count + 1}` } : {}),
      ...(random() < 0.5 ? { owner: random() < 0.5 ? "main" : "helper" } : {}),
      ...(blocked === undefined ? {} : { blockedBy: blocked }),
    };
  }
  if (count === 0) return { op: "create", content: "first" };
  if (roll < 0.6) {
    return {
      op: "update",
      id: pick(),
      status: STATUSES[Math.floor(random() * STATUSES.length)] ?? "pending",
      ...(random() < 0.2 ? { force: true } : {}),
      ...(random() < 0.2 ? { owner: random() < 0.5 ? null : "main" } : {}),
    };
  }
  if (roll < 0.65)
    return {
      op: "update",
      id: pick(),
      content: `renamed ${Math.floor(random() * 9)}`,
      activeForm: null,
    };
  return { op: random() < 0.75 ? "link" : "unlink", id: pick(), blockedBy: [pick()] };
}

function describeBoard(tasks: readonly WorkTask[]): string[] {
  return tasks.map(
    (t) => `${t.id}|${t.content}|${t.activeForm}|${t.status}|${t.owner}|${t.blockedBy.join(",")}`,
  );
}

describe("cap.work projection", () => {
  for (const seed of seeds.value.slice(0, 3)) {
    test(`rows equal the planned state and a rebuild gives identical rows (seed ${seed})`, async () => {
      opened = await openHarness({
        settings: { ...DEFAULT_WORK_SETTINGS, tasks: { autoStart: true, reminderTurns: 0 } },
      });
      const h = opened;
      const random = seededRandom(seed);
      let model: readonly WorkTask[] = [];
      let accepted = 0;
      let rejected = 0;
      await eachAsync(
        Array.from({ length: 120 }, (_, index) => index),
        async (step) => {
          const op = randomOp(random, model.length);
          const planned = planWrite({ tasks: model, nextOrd: model.length + 1, autoStart: true }, [
            op,
          ]);
          const call = h.api.write({ ops: [op] }, h.opts());
          if (planned.ok) {
            await call;
            model = planned.value.tasks;
            accepted += 1;
          } else {
            const error = await rejection(call);
            expect(error.data.code).toBe(planned.error.failure.kind);
            rejected += 1;
          }
          if (step % 20 === 19) h.completeTurn();
          return undefined;
        },
      );
      expect(accepted).toBeGreaterThan(30);
      expect(rejected).toBeGreaterThan(0);

      const live = readTasks(h.store.service.scoped("cap.work"), h.threadId);
      if (!live.ok) throw new Bug("projection read failed", { cause: live.error });
      expect(describeBoard(live.value)).toEqual(describeBoard(model));

      const before = await h.workDigests();
      expect(Object.keys(before).toSorted()).toEqual([
        "cap_work_meta",
        "cap_work_task_edges",
        "cap_work_tasks",
      ]);
      await h.rebuild();
      expect(await h.workDigests()).toEqual(before);
    });
  }

  test("meta counts completed turns and restarts the idle count on every task change", async () => {
    opened = await openHarness();
    const h = opened;
    const reader = h.store.service.scoped("cap.work");
    const meta = () => {
      const read = readMeta(reader, h.threadId);
      if (!read.ok) throw new Bug("meta read failed", { cause: read.error });
      return read.value;
    };
    expect(meta()).toEqual({ turnsCompleted: 0, lastTaskChangeTurn: 0 });
    await h.api.create({ content: "a" }, h.opts());
    h.completeTurn();
    h.completeTurn();
    expect(meta()).toEqual({ turnsCompleted: 2, lastTaskChangeTurn: 0 });
    await h.api.update({ id: tid("t1"), status: "in_progress" }, h.opts());
    expect(meta()).toEqual({ turnsCompleted: 2, lastTaskChangeTurn: 2 });
    h.completeTurn();
    await h.api.create({ content: "b" }, h.opts());
    expect(meta()).toEqual({ turnsCompleted: 3, lastTaskChangeTurn: 3 });
    // 효과 없는 호출은 변경이 아니다
    h.completeTurn();
    await h.api.update({ id: tid("t1"), status: "in_progress" }, h.opts());
    expect(meta()).toEqual({ turnsCompleted: 4, lastTaskChangeTurn: 3 });
  });

  test("another thread's turns do not count", async () => {
    opened = await openHarness();
    const h = opened;
    const other = h.newThread();
    h.completeTurn(other);
    const read = readMeta(h.store.service.scoped("cap.work"), h.threadId);
    expect(read.ok && read.value.turnsCompleted).toBe(0);
  });
});
