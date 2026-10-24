import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import type { TaskOp, WorkTask } from "@xeon/contracts/capabilities";
import {
  WorkTaskChangedSchema,
  WorkTaskCreatedSchema,
  WorkTaskLinkSchema,
} from "@xeon/contracts/records";
import { planWrite, type WritePlan } from "../src/tasks/write.ts";
import type { OpFailure } from "../src/tasks/failure.ts";
import { ids, task, tid } from "./support/tasks.ts";

function plan(
  tasks: readonly WorkTask[],
  ops: readonly TaskOp[],
  options: { autoStart?: boolean } = {},
): WritePlan {
  const planned = planWrite(
    { tasks, nextOrd: tasks.length + 1, autoStart: options.autoStart ?? false },
    ops,
  );
  if (!planned.ok) throw new Bug(`plan failed: ${JSON.stringify(planned.error)}`);
  return planned.value;
}

function failure(
  tasks: readonly WorkTask[],
  ops: readonly TaskOp[],
  options: { autoStart?: boolean } = {},
): OpFailure {
  const planned = planWrite(
    { tasks, nextOrd: tasks.length + 1, autoStart: options.autoStart ?? false },
    ops,
  );
  if (planned.ok) throw new Bug("expected the plan to fail");
  return planned.error;
}

describe("write is all or nothing", () => {
  test("the third operation failing yields no events and opIndex 2", () => {
    const error = failure(
      [],
      [
        { op: "create", content: "a" },
        { op: "create", content: "b" },
        { op: "update", id: "t9", status: "completed" },
      ],
    );
    expect(error.opIndex).toBe(2);
    expect(error.failure).toEqual({ kind: "not_found", id: "t9" });
  });

  test("operations see the effect of earlier operations in the same call", () => {
    const planned = plan(
      [],
      [
        { op: "create", content: "a" },
        { op: "update", id: "t1", status: "completed" },
        { op: "create", content: "b", blockedBy: ["t1"], status: "in_progress" },
      ],
    );
    expect(planned.tasks.map((t) => `${t.id} ${t.status}`)).toEqual([
      "t1 completed",
      "t2 in_progress",
    ]);
  });
});

describe("temporary refs", () => {
  test("a ref made by create resolves in later link and update operations", () => {
    const planned = plan(
      [],
      [
        { op: "create", ref: "@a", content: "a" },
        { op: "create", ref: "@b", content: "b" },
        { op: "link", id: "@b", blockedBy: ["@a"] },
        { op: "update", id: "@a", owner: "main" },
      ],
    );
    expect(planned.created).toEqual([
      { ref: "@a", id: tid("t1") },
      { ref: "@b", id: tid("t2") },
    ]);
    expect(
      planned.tasks.map((t) => `${t.id} by=${t.blockedBy.join(",")} owner=${t.owner}`),
    ).toEqual(["t1 by= owner=main", "t2 by=t1 owner=null"]);
  });

  test("an unknown ref is task_ref_unknown and a repeated ref is invalid input", () => {
    expect(failure([], [{ op: "update", id: "@a", status: "completed" }]).failure).toEqual({
      kind: "task_ref_unknown",
      ref: "@a",
    });
    expect(
      failure(
        [],
        [
          { op: "create", ref: "@a", content: "a" },
          { op: "create", ref: "@a", content: "b" },
        ],
      ).failure.kind,
    ).toBe("invalid_input");
  });

  test("a malformed id is invalid input and an unknown id is not_found", () => {
    expect(
      failure([task("t1")], [{ op: "update", id: "x1", status: "completed" }]).failure.kind,
    ).toBe("invalid_input");
    expect(failure([task("t1")], [{ op: "link", id: "t1", blockedBy: ["t2"] }]).failure).toEqual({
      kind: "not_found",
      id: "t2",
    });
  });
});

describe("state rules", () => {
  test("an update with no change yields no event", () => {
    const planned = plan(
      [task("t1")],
      [{ op: "update", id: "t1", status: "pending", content: "task t1" }],
    );
    expect(planned.events).toEqual([]);
  });

  test("only the changed fields are recorded, with the previous status", () => {
    const planned = plan(
      [task("t1", "in_progress")],
      [{ op: "update", id: "t1", status: "completed", content: "task t1", owner: "main" }],
    );
    expect(planned.events).toEqual([
      {
        kind: "work.task_changed",
        payload: {
          taskId: tid("t1"),
          from: "in_progress",
          set: { status: "completed", owner: "main" },
          cause: "call",
        },
      },
    ]);
  });

  test("a forbidden transition is rejected with both statuses", () => {
    expect(failure([task("t1")], [{ op: "update", id: "t1", status: "failed" }]).failure).toEqual({
      kind: "task_transition_invalid",
      from: "pending",
      to: "failed",
    });
    expect(
      failure([task("t1", "completed")], [{ op: "update", id: "t1", status: "in_progress" }])
        .failure.kind,
    ).toBe("task_transition_invalid");
  });

  test("a blocked task cannot start unless forced; a failed blocker keeps blocking", () => {
    const tasks = [task("t1", "failed"), task("t2", "pending", ["t1"])];
    expect(failure(tasks, [{ op: "update", id: "t2", status: "in_progress" }]).failure).toEqual({
      kind: "task_blocked",
      blockers: ids("t1"),
    });
    const forced = plan(tasks, [{ op: "update", id: "t2", status: "in_progress", force: true }]);
    expect(forced.tasks[1]?.status).toBe("in_progress");
  });

  test("a failed task restarts only when its own blockers are resolved", () => {
    const tasks = [task("t1"), task("t2", "failed", ["t1"])];
    expect(failure(tasks, [{ op: "update", id: "t2", status: "in_progress" }]).failure.kind).toBe(
      "task_blocked",
    );
    const ready = [task("t1", "completed"), task("t2", "failed", ["t1"])];
    expect(plan(ready, [{ op: "update", id: "t2", status: "in_progress" }]).tasks[1]?.status).toBe(
      "in_progress",
    );
  });

  test("create can start a task only when its blockers are resolved", () => {
    expect(
      failure(
        [task("t1")],
        [{ op: "create", content: "x", status: "in_progress", blockedBy: ["t1"] }],
      ).failure.kind,
    ).toBe("task_blocked");
  });
});

describe("links", () => {
  test("an edge already present is not recorded again and unlinking an absent edge is a no-op", () => {
    const tasks = [task("t1"), task("t2", "pending", ["t1"])];
    expect(plan(tasks, [{ op: "link", id: "t2", blockedBy: ["t1"] }]).events).toEqual([]);
    expect(plan(tasks, [{ op: "unlink", id: "t1", blockedBy: ["t2"] }]).events).toEqual([]);
  });

  test("an edge added earlier in the same call counts for the cycle check", () => {
    const tasks = [task("t1"), task("t2"), task("t3")];
    const error = failure(tasks, [
      { op: "link", id: "t2", blockedBy: ["t1"] },
      { op: "link", id: "t3", blockedBy: ["t2"] },
      { op: "link", id: "t1", blockedBy: ["t3"] },
    ]);
    expect(error.opIndex).toBe(2);
    expect(error.failure).toEqual({ kind: "task_cycle", path: ids("t1", "t3", "t2", "t1") });
  });

  test("a task takes at most 32 blockers", () => {
    const blockers = Array.from({ length: 33 }, (_, index) => task(`t${index + 1}`));
    const target = task("t34");
    const error = failure(
      [...blockers, target],
      [{ op: "link", id: "t34", blockedBy: blockers.map((b) => b.id) }],
    );
    expect(error.failure.kind).toBe("invalid_input");
  });

  test("unlink removes the edge and records only the removed ones", () => {
    const tasks = [task("t1"), task("t2"), task("t3", "pending", ["t1", "t2"])];
    const planned = plan(tasks, [{ op: "unlink", id: "t3", blockedBy: ["t2", "t1"] }]);
    expect(planned.events).toEqual([
      { kind: "work.task_unlinked", payload: { taskId: tid("t3"), blockedBy: ids("t2", "t1") } },
    ]);
    expect(planned.tasks[2]?.blockedBy).toEqual([]);
  });
});

const board = (): WorkTask[] => [
  task("t1", "in_progress"),
  task("t2", "pending", ["t1"], "main"),
  task("t3", "pending", ["t1"], null),
  task("t4", "pending", ["t1", "t5"], "main"),
  task("t5", "pending"),
];

describe("auto start", () => {
  test("completing the blocker starts only owned tasks that become unblocked", () => {
    const planned = plan(board(), [{ op: "update", id: "t1", status: "completed" }], {
      autoStart: true,
    });
    expect(planned.tasks.map((t) => `${t.id} ${t.status}`)).toEqual([
      "t1 completed",
      "t2 in_progress",
      "t3 pending",
      "t4 pending",
      "t5 pending",
    ]);
    expect(planned.events).toHaveLength(2);
    expect(planned.events[1]).toEqual({
      kind: "work.task_changed",
      payload: {
        taskId: tid("t2"),
        from: "pending",
        set: { status: "in_progress" },
        cause: "auto_start",
      },
    });
  });

  test("cancelling the blocker also releases it", () => {
    const planned = plan(board(), [{ op: "update", id: "t1", status: "cancelled" }], {
      autoStart: true,
    });
    expect(planned.tasks[1]?.status).toBe("in_progress");
  });

  test("a failed blocker does not release anything and the setting off starts nothing", () => {
    expect(
      plan(board(), [{ op: "update", id: "t1", status: "failed" }], { autoStart: true }).tasks[1]
        ?.status,
    ).toBe("pending");
    expect(
      plan(board(), [{ op: "update", id: "t1", status: "completed" }], { autoStart: false }).events,
    ).toHaveLength(1);
  });

  test("the last blocker finishing in one call starts the task once", () => {
    const planned = plan(
      board(),
      [
        { op: "update", id: "t1", status: "completed" },
        { op: "update", id: "t5", status: "completed" },
      ],
      { autoStart: true },
    );
    expect(planned.tasks.map((t) => `${t.id} ${t.status}`)).toEqual([
      "t1 completed",
      "t2 in_progress",
      "t3 pending",
      "t4 in_progress",
      "t5 completed",
    ]);
  });
});

describe("limits and payloads", () => {
  test("the 501st task is task_limit", () => {
    const full = Array.from({ length: 500 }, (_, index) => task(`t${index + 1}`));
    expect(failure(full, [{ op: "create", content: "x" }]).failure).toEqual({ kind: "task_limit" });
  });

  test("every event payload passes its catalog schema", () => {
    const planned = plan(
      [],
      [
        { op: "create", ref: "@a", content: "a", activeForm: "doing a", owner: "main" },
        { op: "create", content: "b", blockedBy: ["@a"] },
        {
          op: "update",
          id: "t1",
          activeForm: null,
          owner: null,
          content: "A",
          status: "in_progress",
        },
        { op: "unlink", id: "t2", blockedBy: ["t1"] },
        { op: "link", id: "t2", blockedBy: ["t1"] },
      ],
    );
    const schemas = {
      "work.task_created": WorkTaskCreatedSchema,
      "work.task_changed": WorkTaskChangedSchema,
      "work.task_linked": WorkTaskLinkSchema,
      "work.task_unlinked": WorkTaskLinkSchema,
    } as const;
    expect(planned.events.map((e) => e.kind)).toEqual([
      "work.task_created",
      "work.task_created",
      "work.task_changed",
      "work.task_unlinked",
      "work.task_linked",
    ]);
    for (const event of planned.events) {
      expect(parse(schemas[event.kind], event.payload).ok).toBe(true);
    }
  });
});
