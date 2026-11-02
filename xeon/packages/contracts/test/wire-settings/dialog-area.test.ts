import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { parse } from "../../src/base/index.ts";
import { ThreadSummarySchema, WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";

function roundTrip(schema: TSchema, value: unknown): void {
  const result = parse(schema, value);
  expect(result.ok ? result.value : result.error).toEqual(value);
}

describe("M4 dialog area methods", () => {
  test("review.get returns hunk bodies by value", () => {
    const result = {
      reviewId: "rev_1",
      files: [
        {
          path: "a.ts",
          hunks: [
            {
              hunkId: "h1",
              header: "@@ -1,2 +1,2 @@",
              oldStart: 1,
              newStart: 1,
              lines: [
                { kind: "context", text: "x" },
                { kind: "del", text: "y" },
                { kind: "add", text: "z" },
              ],
            },
          ],
        },
      ],
    };
    roundTrip(WIRE_METHODS["review.get"].result, result);
    expect(parse(WIRE_METHODS["review.get"].params, { reviewId: "rev_1" }).ok).toBe(true);
    expect(parse(WIRE_METHODS["review.get"].params, {}).ok).toBe(false);
    const badLine = {
      ...result,
      files: [
        {
          path: "a",
          hunks: [{ ...result.files[0]?.hunks[0], lines: [{ kind: "mod", text: "" }] }],
        },
      ],
    };
    expect(parse(WIRE_METHODS["review.get"].result, badLine).ok).toBe(false);
  });

  test("goal.status carries judged and max judgments, null without a goal", () => {
    const goal = {
      goal: {
        condition: "tests pass",
        status: "active",
        judged: 2,
        maxJudgments: 3,
        lastVerdict: { met: false, reason: "one failing" },
      },
    };
    roundTrip(WIRE_METHODS["goal.status"].result, goal);
    roundTrip(WIRE_METHODS["goal.status"].result, { goal: null });
    expect(parse(WIRE_METHODS["goal.status"].params, { threadId: "thr_1" }).ok).toBe(true);
  });

  test("work.tasks.list and schedule update and runs round trip", () => {
    roundTrip(WIRE_METHODS["work.tasks.list"].result, {
      tasks: [{ taskId: "t1", content: "do", status: "in_progress", blockedBy: null }],
    });
    expect(
      parse(WIRE_METHODS["schedule.update"].params, { scheduleId: "s", enabled: true }).ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["schedule.update"].params, { scheduleId: "s", bogus: 1 }).ok).toBe(
      false,
    );
    roundTrip(WIRE_METHODS["schedule.update"].result, {
      scheduleId: "s",
      enabled: true,
      nextRunAt: null,
    });
    roundTrip(WIRE_METHODS["schedule.runs"].result, {
      runs: [
        {
          runId: "r1",
          startedAt: "2026-10-31T00:00:00.000Z",
          endedAt: null,
          outcome: "running",
          threadId: null,
          error: null,
        },
      ],
    });
    expect(parse(WIRE_METHODS["schedule.runs"].params, { scheduleId: "s", limit: 0 }).ok).toBe(
      false,
    );
  });

  test("thread.read accepts around, ThreadSummary accepts origin", () => {
    expect(
      parse(WIRE_METHODS["thread.read"].params, {
        threadId: "thr_01HZZZZZZZZZZZZZZZZZZZZZZZ",
        around: "itm_01HZZZZZZZZZZZZZZZZZZZZZZZ",
      }).ok,
    ).toBe(true);
    const origins = [{ kind: "user" }, { kind: "schedule", scheduleId: "s1" }, { kind: "remote" }];
    for (const origin of origins) {
      expect(parse(ThreadSummarySchema.properties.origin, origin).ok).toBe(true);
    }
    expect(parse(ThreadSummarySchema.properties.origin, { kind: "schedule" }).ok).toBe(false);
  });
});
