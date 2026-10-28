import { afterEach, describe, expect, test } from "bun:test";
import { eachAsync, parse } from "@xeon/contracts";
import { TaskWriteOutput, renderTaskList, type WorkTaskView } from "@xeon/contracts/capabilities";
import { DEFAULT_WORK_SETTINGS } from "../src/settings.ts";
import { rejection } from "./support/assertions.ts";
import { tid } from "./support/tasks.ts";
import { openHarness, type Harness } from "./support/harness.ts";

let opened: Harness | undefined;

async function harness(...args: Parameters<typeof openHarness>): Promise<Harness> {
  opened = await openHarness(...args);
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

function join(ids: readonly string[]): string {
  return ids.length === 0 ? "-" : ids.join(",");
}

function describeTask(t: WorkTaskView): string {
  return `${t.id} ${t.status} blocked=${t.blocked} by=${join(t.blockedBy)} blocks=${join(t.blocks)}`;
}

describe("work.tasks service on a real store", () => {
  test("write creates tasks with temporary refs and returns the full list", async () => {
    const h = await harness();
    const out = await h.api.write(
      {
        ops: [
          { op: "create", ref: "@a", content: "design" },
          { op: "create", ref: "@b", content: "build", blockedBy: ["@a"] },
          { op: "link", id: "@b", blockedBy: ["@a"] },
        ],
      },
      h.opts(),
    );
    expect(out.created).toEqual([
      { ref: "@a", id: tid("t1") },
      { ref: "@b", id: tid("t2") },
    ]);
    expect(out.tasks.map(describeTask)).toEqual([
      "t1 pending blocked=false by=- blocks=t2",
      "t2 pending blocked=true by=t1 blocks=-",
    ]);
    expect(parse(TaskWriteOutput, out).ok).toBe(true);
    expect(renderTaskList(out).content[0]).toMatchObject({ type: "text" });
  });

  test("the same requestId writes no events and returns the first output", async () => {
    const h = await harness();
    const input = {
      ops: [
        { op: "create" as const, ref: "@a", content: "one" },
        { op: "create" as const, content: "two", blockedBy: ["@a"] },
      ],
    };
    const first = await h.api.write(input, h.opts("req-fixed"));
    const events = h.eventCount();
    const second = await h.api.write(input, h.opts("req-fixed"));
    expect(h.eventCount()).toBe(events);
    expect(second).toEqual(first);
    // 처음 호출 뒤에 상태가 바뀌어도 created는 처음 결과를 되풀이한다
    await h.api.update({ id: first.created[0]?.id ?? tid("t1"), status: "completed" }, h.opts());
    const third = await h.api.write(input, h.opts("req-fixed"));
    expect(third.created).toEqual(first.created);
    expect(h.eventCount()).toBe(events + 1);
  });

  test("a rejected call is rejected again with the same error and writes nothing", async () => {
    const h = await harness();
    await h.api.create({ content: "a" }, h.opts());
    const input = { id: tid("t1"), status: "failed" as const };
    const first = await rejection(h.api.update(input, h.opts("req-bad")));
    expect(first.data.code).toBe("task_transition_invalid");
    const events = h.eventCount();
    const again = await rejection(h.api.update(input, h.opts("req-bad")));
    expect(again.data).toEqual(first.data);
    expect(h.eventCount()).toBe(events);
  });

  test("a different input under the same requestId is an internal error and is logged", async () => {
    const h = await harness();
    await h.api.create({ content: "a" }, h.opts("req-x"));
    const error = await rejection(h.api.create({ content: "b" }, h.opts("req-x")));
    expect(error.data.code).toBe("internal");
    expect(h.logs.some((line) => line.event === "work.tasks.key_reused")).toBe(true);
  });

  test("write methods need a requestId and a thread context", async () => {
    const h = await harness();
    const noRequest = await rejection(
      h.api.create(
        { content: "a" },
        { context: { threadId: h.threadId, caller: { kind: "host" } } },
      ),
    );
    expect(noRequest.data.code).toBe("invalid_input");
    const noThread = await rejection(h.api.create({ content: "a" }, { requestId: "r" }));
    expect(noThread.data.code).toBe("invalid_input");
    const noOptions = await rejection(h.api.list({}));
    expect(noOptions.data.code).toBe("invalid_input");
  });

  test("an operation with no effect commits nothing and answers like a normal call", async () => {
    const h = await harness();
    await h.api.create({ content: "a" }, h.opts());
    const events = h.eventCount();
    const out = await h.api.write(
      { ops: [{ op: "update", id: "t1", status: "pending", content: "a" }] },
      h.opts("req-noop"),
    );
    expect(h.eventCount()).toBe(events);
    expect(out.created).toEqual([]);
    expect(out.tasks).toHaveLength(1);
    const again = await h.api.write(
      { ops: [{ op: "update", id: "t1", status: "pending", content: "a" }] },
      h.opts("req-noop"),
    );
    expect(again).toEqual(out);
  });

  test("a failing operation in the middle commits nothing and reports its index", async () => {
    const h = await harness();
    const events = h.eventCount();
    const error = await rejection(
      h.api.write(
        {
          ops: [
            { op: "create", content: "a" },
            { op: "create", content: "b" },
            { op: "update", id: "t9", status: "completed" },
          ],
        },
        h.opts(),
      ),
    );
    expect(error.data.code).toBe("not_found");
    expect(error.data.detail).toMatchObject({ opIndex: 2 });
    expect(h.eventCount()).toBe(events);
    expect((await h.api.list({}, h.opts())).tasks).toEqual([]);
  });

  test("a cycle through link leaves the event count unchanged", async () => {
    const h = await harness();
    await h.api.write(
      {
        ops: [
          { op: "create", content: "one" },
          { op: "create", content: "two", blockedBy: ["t1"] },
          { op: "create", content: "three", blockedBy: ["t2"] },
        ],
      },
      h.opts(),
    );
    const events = h.eventCount();
    const error = await rejection(
      h.api.link({ id: tid("t1"), blockedBy: [tid("t3")], op: "add" }, h.opts()),
    );
    expect(error.data.code).toBe("task_cycle");
    expect(error.data.detail).toEqual({ path: ["t1", "t3", "t2", "t1"] });
    expect(h.eventCount()).toBe(events);
    const self = await rejection(
      h.api.link({ id: tid("t2"), blockedBy: [tid("t2")], op: "add" }, h.opts()),
    );
    expect(self.data.detail).toEqual({ path: ["t2", "t2"] });
  });

  test("starting a blocked task needs force", async () => {
    const h = await harness();
    await h.api.write(
      {
        ops: [
          { op: "create", content: "one" },
          { op: "create", content: "two", blockedBy: ["t1"] },
        ],
      },
      h.opts(),
    );
    const blocked = await rejection(
      h.api.update({ id: tid("t2"), status: "in_progress" }, h.opts()),
    );
    expect(blocked.data.code).toBe("task_blocked");
    expect(blocked.data.detail).toEqual({ blockers: ["t1"] });
    const forced = await h.api.update(
      { id: tid("t2"), status: "in_progress", force: true },
      h.opts(),
    );
    expect(forced.task.status).toBe("in_progress");
  });

  test("autoStart marks an unblocked owned task in the same commit", async () => {
    const h = await harness({
      settings: { ...DEFAULT_WORK_SETTINGS, tasks: { autoStart: true, reminderTurns: 0 } },
    });
    await h.api.write(
      {
        ops: [
          { op: "create", content: "one", owner: "main" },
          { op: "create", content: "two", owner: "main", blockedBy: ["t1"] },
          { op: "create", content: "three", blockedBy: ["t1"] },
        ],
      },
      h.opts(),
    );
    const before = h.eventCount();
    const out = await h.api.update({ id: tid("t1"), status: "completed" }, h.opts());
    expect(out.task.status).toBe("completed");
    expect(h.eventCount()).toBe(before + 2);
    const listed = await h.api.list({}, h.opts());
    expect(listed.tasks.map((t) => `${t.id} ${t.status}`)).toEqual([
      "t1 completed",
      "t2 in_progress",
      "t3 pending",
    ]);
  });

  test("list filters by status and owner and sees finished writes", async () => {
    const h = await harness();
    await h.api.write(
      {
        ops: [
          { op: "create", content: "one", owner: "main" },
          { op: "create", content: "two", status: "completed" },
          { op: "create", content: "three", owner: "helper" },
        ],
      },
      h.opts(),
    );
    expect(
      (await h.api.list({ status: ["completed"] }, h.opts())).tasks.map((t) => String(t.id)),
    ).toEqual(["t2"]);
    expect(
      (await h.api.list({ owner: "helper" }, h.opts())).tasks.map((t) => String(t.id)),
    ).toEqual(["t3"]);
  });

  test("concurrent writes on one thread are applied in call order", async () => {
    const h = await harness();
    const calls = Array.from({ length: 8 }, (_, index) =>
      h.api.create({ content: `task ${index}` }, h.opts()),
    );
    const results = await Promise.all(calls);
    expect(results.map((r) => String(r.task.id))).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
    ]);
  });

  test("tasks of two threads do not mix", async () => {
    const h = await harness();
    const other = h.newThread();
    await h.api.create({ content: "mine" }, h.opts());
    await h.api.create({ content: "theirs" }, h.opts(undefined, other));
    expect((await h.api.list({}, h.opts())).tasks.map((t) => t.content)).toEqual(["mine"]);
    expect(
      (await h.api.list({}, h.opts(undefined, other))).tasks.map((t) => `${t.id} ${t.content}`),
    ).toEqual(["t1 theirs"]);
  });

  test("the task limit is enforced", async () => {
    const h = await harness();
    const ops = Array.from({ length: 50 }, (_, index) => ({
      op: "create" as const,
      content: `task ${index}`,
    }));
    await eachAsync(Array.from({ length: 10 }), async () => {
      await h.api.write({ ops }, h.opts());
      return undefined;
    });
    const error = await rejection(h.api.create({ content: "one too many" }, h.opts()));
    expect(error.data.code).toBe("task_limit");
  });
});
