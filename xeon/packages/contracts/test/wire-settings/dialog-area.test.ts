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

  test("host.clients lists connections with the client name only after hello, and bounds the list", () => {
    const clients = [
      {
        connectionId: "c1",
        transport: "stdio",
        name: "fresnel-cli",
        version: "0.1.0",
        writeThreads: 1,
        observedThreads: 0,
        self: true,
      },
      { connectionId: "c2", transport: "socket", writeThreads: 0, observedThreads: 2, self: false },
    ];
    roundTrip(WIRE_METHODS["host.clients"].result, { clients });
    roundTrip(WIRE_METHODS["host.clients"].result, { clients: [] });
    expect(parse(WIRE_METHODS["host.clients"].params, {}).ok).toBe(true);
    expect(parse(WIRE_METHODS["host.clients"].params, { bogus: 1 }).ok).toBe(false);
    const transport = { ...clients[0], transport: "tcp" };
    expect(parse(WIRE_METHODS["host.clients"].result, { clients: [transport] }).ok).toBe(false);
    const crowded = Array.from({ length: 257 }, (_, index) => ({
      ...clients[1],
      connectionId: `c${String(index)}`,
    }));
    expect(parse(WIRE_METHODS["host.clients"].result, { clients: crowded }).ok).toBe(false);
  });

  test("turn.withdraw takes a thread and a request key, and answers whether it withdrew", () => {
    const params = WIRE_METHODS["turn.withdraw"].params;
    expect(parse(params, { threadId: "thr_1", requestId: "req-1" }).ok).toBe(true);
    expect(parse(params, { threadId: "thr_1", requestId: "" }).ok).toBe(false);
    expect(parse(params, { threadId: "thr_1", requestId: "r".repeat(65) }).ok).toBe(false);
    expect(parse(params, { threadId: "thr_1" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["turn.withdraw"].result, { withdrawn: true });
    roundTrip(WIRE_METHODS["turn.withdraw"].result, { withdrawn: false });
    expect(parse(WIRE_METHODS["turn.withdraw"].result, { withdrawn: "yes" }).ok).toBe(false);
  });

  test("knowledge.skills.view takes a name and an optional thread, and returns the body with its truncation flag", () => {
    const params = WIRE_METHODS["knowledge.skills.view"].params;
    expect(parse(params, { name: "deploy" }).ok).toBe(true);
    expect(parse(params, { name: "deploy", threadId: "thr_1" }).ok).toBe(true);
    expect(parse(params, { name: "" }).ok).toBe(false);
    expect(parse(params, { name: "x".repeat(129) }).ok).toBe(false);
    const view = {
      name: "deploy",
      scope: "project",
      description: "Ships the build.",
      body: "# Deploy\n",
      bodyTruncated: false,
      files: ["scripts/run.sh", "references/notes.md"],
      treeHash: "a".repeat(64),
    };
    roundTrip(WIRE_METHODS["knowledge.skills.view"].result, view);
    roundTrip(WIRE_METHODS["knowledge.skills.view"].result, {
      ...view,
      body: "x".repeat(20_000),
      bodyTruncated: true,
    });
    expect(
      parse(WIRE_METHODS["knowledge.skills.view"].result, { ...view, scope: "global" }).ok,
    ).toBe(false);
    expect(
      parse(WIRE_METHODS["knowledge.skills.view"].result, { ...view, treeHash: "abc" }).ok,
    ).toBe(false);
    expect(
      parse(WIRE_METHODS["knowledge.skills.view"].result, { ...view, body: "x".repeat(20_001) }).ok,
    ).toBe(false);
  });

  test("work.plans.versions takes a thread and a plan id, and returns every version of the plan", () => {
    expect(
      parse(WIRE_METHODS["work.plans.versions"].params, { threadId: "thr_1", planId: "p1" }).ok,
    ).toBe(true);
    expect(parse(WIRE_METHODS["work.plans.versions"].params, { threadId: "thr_1" }).ok).toBe(false);
    roundTrip(WIRE_METHODS["work.plans.versions"].result, {
      versions: [
        {
          planId: "p1",
          version: 1,
          title: "Migrate the store",
          body: "1. Back up\n2. Migrate",
          status: "superseded",
          artifact: null,
          approvalId: null,
          feedback: null,
        },
        {
          planId: "p1",
          version: 2,
          title: "Migrate the store",
          body: "1. Back up\n2. Migrate\n3. Verify",
          status: "submitted",
          artifact: null,
          approvalId: null,
          feedback: null,
        },
      ],
    });
    roundTrip(WIRE_METHODS["work.plans.versions"].result, { versions: [] });
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
