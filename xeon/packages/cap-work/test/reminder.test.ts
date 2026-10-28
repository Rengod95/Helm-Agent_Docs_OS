import { describe, expect, test } from "bun:test";
import { REMINDER_CUSTOM_TYPE, reminderMessage } from "../src/tasks/reminder.ts";
import { task } from "./support/tasks.ts";

const tasks = [
  task("t1", "completed"),
  task("t2", "in_progress"),
  task("t3", "pending"),
  task("t4", "failed"),
];

describe("reminderMessage", () => {
  test("reminderTurns 0 never reminds", () => {
    expect(
      reminderMessage(tasks, { turnsCompleted: 99, lastTaskChangeTurn: 0 }, 0),
    ).toBeUndefined();
  });

  test("it fires when the idle turns reach the setting and lists the open tasks only", () => {
    expect(reminderMessage(tasks, { turnsCompleted: 3, lastTaskChangeTurn: 2 }, 2)).toBeUndefined();
    const message = reminderMessage(tasks, { turnsCompleted: 4, lastTaskChangeTurn: 2 }, 2);
    expect(message?.customType).toBe(REMINDER_CUSTOM_TYPE);
    expect(message?.display).toBe(false);
    const text = typeof message?.content === "string" ? message.content : "";
    expect(text).toContain("2턴");
    expect(text).toContain("t2 [진행 중]");
    expect(text).toContain("t3 [대기]");
    expect(text).not.toContain("t1");
    expect(text).not.toContain("t4");
  });

  test("a list with nothing open stays quiet", () => {
    expect(
      reminderMessage(
        [task("t1", "completed"), task("t2", "failed")],
        { turnsCompleted: 9, lastTaskChangeTurn: 0 },
        1,
      ),
    ).toBeUndefined();
  });
});
