import { describe, expect, test } from "bun:test";
import { findCycle } from "../src/tasks/graph.ts";
import { indexTasks } from "../src/tasks/model.ts";
import { ids, task, tid } from "./support/tasks.ts";

describe("cycle detection", () => {
  test("a self edge is a cycle", () => {
    const tasks = indexTasks([task("t1")]);
    expect(findCycle(tasks, tid("t1"), tid("t1"))).toEqual(ids("t1", "t1"));
  });

  test("two, three and four node cycles return a closed path", () => {
    const two = indexTasks([task("t1"), task("t2", "pending", ["t1"])]);
    expect(findCycle(two, tid("t1"), tid("t2"))).toEqual(ids("t1", "t2", "t1"));

    const three = indexTasks([
      task("t1"),
      task("t2", "pending", ["t1"]),
      task("t3", "pending", ["t2"]),
    ]);
    expect(findCycle(three, tid("t1"), tid("t3"))).toEqual(ids("t1", "t3", "t2", "t1"));

    const four = indexTasks([
      task("t1"),
      task("t2", "pending", ["t1"]),
      task("t3", "pending", ["t2"]),
      task("t4", "pending", ["t3"]),
    ]);
    const path = findCycle(four, tid("t1"), tid("t4"));
    expect(path).toEqual(ids("t1", "t4", "t3", "t2", "t1"));
    expect(path?.[0]).toBe(path?.[path.length - 1]);
  });

  test("a diamond is not a cycle", () => {
    const tasks = indexTasks([
      task("t1"),
      task("t2", "pending", ["t1"]),
      task("t3", "pending", ["t1"]),
      task("t4", "pending", ["t2", "t3"]),
    ]);
    expect(findCycle(tasks, tid("t4"), tid("t1"))).toBeUndefined();
    expect(findCycle(tasks, tid("t1"), tid("t4"))).toBeDefined();
  });

  test("a cycle reachable through the second branch is found", () => {
    const tasks = indexTasks([
      task("t1"),
      task("t2", "pending", ["t1"]),
      task("t3"),
      task("t4", "pending", ["t3", "t2"]),
    ]);
    expect(findCycle(tasks, tid("t1"), tid("t4"))).toEqual(ids("t1", "t4", "t2", "t1"));
  });
});
