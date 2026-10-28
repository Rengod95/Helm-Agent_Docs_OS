import { afterEach, describe, expect, test } from "bun:test";
import { Bug, parse } from "@xeon/contracts";
import { GoalSchema, WorkReportSchema, type GoalVerdict } from "@xeon/contracts/capabilities";
import { rejection } from "./support/assertions.ts";
import { asCaller, gid, rid, usage } from "./support/goals.ts";
import { openHarness, type Harness } from "./support/harness.ts";
import { readGoals, readJudgments, readReports } from "../src/projection/read.ts";

// L2.work.spec §3.4, §3.5, §4.3, §4.4. work.goals와 work.reports를 실제 SQLite와 세션 서비스 위에서 시험한다.

let opened: Harness | undefined;

async function harness(...args: Parameters<typeof openHarness>): Promise<Harness> {
  opened = await openHarness(...args);
  return opened;
}

afterEach(async () => {
  await opened?.[Symbol.asyncDispose]();
  opened = undefined;
});

const MET: GoalVerdict = { met: true, reason: "All criteria are shown.", missing: [] };
const NOT_MET: GoalVerdict = { met: false, reason: "The tests are missing.", missing: ["tests"] };

function goalsOf(h: Harness) {
  const read = readGoals(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

function reportsOf(h: Harness) {
  const read = readReports(h.store.service.scoped("cap.work"), h.threadId);
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

function judgmentsOf(h: Harness, goal = "g1") {
  const read = readJudgments(h.store.service.scoped("cap.work"), h.threadId, gid(goal));
  if (!read.ok) throw new Bug("read failed", { cause: read.error });
  return read.value;
}

const DELEGATED = { kind: "delegated", owner: "checker" } as const;

describe("work.goals set and status", () => {
  test("a new goal is active with the defaults, the current judge limit and a status of recent judgments", async () => {
    const h = await harness({ maxRuns: 5 });
    const out = await h.goals.set({ condition: "all tests pass" }, h.opts());
    expect(out.goal).toEqual({
      goalId: gid("g1"),
      condition: "all tests pass",
      judge: { kind: "model" },
      maxRuns: 5,
      continuation: "self",
      judgments: 0,
      status: "active",
      lastVerdict: null,
    });
    expect(parse(GoalSchema, out.goal).ok).toBe(true);
    expect(await h.goals.status({}, h.opts())).toEqual({ goal: out.goal, recent: [] });
    expect(await h.goals.status({ goalId: gid("g1") }, h.opts())).toEqual({
      goal: out.goal,
      recent: [],
    });
  });

  test("status with no goal answers null and an unknown id is not_found", async () => {
    const h = await harness();
    expect(await h.goals.status({}, h.opts())).toEqual({ goal: null, recent: [] });
    const missing = await rejection(h.goals.status({ goalId: gid("g9") }, h.opts()));
    expect(missing.data.code).toBe("not_found");
  });

  test("a second goal is refused while one is active unless replace is set", async () => {
    const h = await harness();
    await h.goals.set({ condition: "first" }, h.opts());
    const refused = await rejection(h.goals.set({ condition: "second" }, h.opts()));
    expect(refused.data).toMatchObject({ code: "goal_active", detail: { goalId: "g1" } });
    expect(goalsOf(h)).toHaveLength(1);

    const replaced = await h.goals.set({ condition: "second", replace: true }, h.opts());
    expect(replaced.goal).toMatchObject({ goalId: "g2", condition: "second", status: "active" });
    expect(goalsOf(h).map((row) => [String(row.goal.goalId), row.goal.status])).toEqual([
      ["g1", "cleared"],
      ["g2", "active"],
    ]);
    // 바뀐 목표의 종결 보고가 같은 커밋에 든다
    expect(reportsOf(h).map((report) => [String(report.reportId), report.outcome])).toEqual([
      ["r1", "cleared"],
    ]);
  });

  test("the same requestId returns the first goal and writes nothing; a refusal is repeated", async () => {
    const h = await harness();
    const first = await h.goals.set({ condition: "once" }, h.opts("set-1"));
    const events = h.eventCount();
    const second = await h.goals.set({ condition: "once" }, h.opts("set-1"));
    expect(second).toEqual(first);
    expect(h.eventCount()).toBe(events);

    const refused = await rejection(h.goals.set({ condition: "other" }, h.opts("set-2")));
    const written = h.eventCount();
    const again = await rejection(h.goals.set({ condition: "other" }, h.opts("set-2")));
    expect(again.data).toEqual(refused.data);
    expect(h.eventCount()).toBe(written);
  });

  test("a write needs a requestId and a thread", async () => {
    const h = await harness();
    const noKey = await rejection(
      h.goals.set(
        { condition: "x" },
        { context: h.opts().context ?? { caller: { kind: "host" } } },
      ),
    );
    expect(noKey.data.code).toBe("invalid_input");
    const noThread = await rejection(
      h.goals.set({ condition: "x" }, { requestId: "k", context: { caller: { kind: "host" } } }),
    );
    expect(noThread.data.code).toBe("invalid_input");
  });
});

describe("work.goals clear", () => {
  test("clearing ends the goal as cleared with a report and a second clear is goal_closed", async () => {
    const h = await harness();
    await h.goals.set({ condition: "x" }, h.opts());
    const out = await h.goals.clear({}, h.opts());
    expect(out.goal).toMatchObject({ goalId: "g1", status: "cleared" });
    expect(reportsOf(h)).toMatchObject([
      {
        subject: { kind: "goal", goalId: "g1" },
        outcome: "cleared",
        summary: "Cleared by the user.",
      },
    ]);
    const closed = await rejection(h.goals.clear({ goalId: gid("g1") }, h.opts()));
    expect(closed.data.code).toBe("goal_closed");
    const none = await rejection(h.goals.clear({}, h.opts()));
    expect(none.data.code).toBe("not_found");
  });

  test("the same requestId clears once and answers the same goal", async () => {
    const h = await harness();
    await h.goals.set({ condition: "x" }, h.opts());
    const first = await h.goals.clear({}, h.opts("clear-1"));
    const events = h.eventCount();
    expect(await h.goals.clear({}, h.opts("clear-1"))).toEqual(first);
    expect(h.eventCount()).toBe(events);
    expect(reportsOf(h)).toHaveLength(1);
  });
});

async function delegatedGoal(h: Harness) {
  await h.goals.set({ condition: "checked by a group", judge: DELEGATED }, h.opts());
  return h.completeTurn(h.threadId, usage(100, 20, 0.5));
}

describe("work.goals judge (delegated judge)", () => {
  test("a model goal takes no judge call", async () => {
    const h = await harness();
    await h.goals.set({ condition: "x" }, h.opts());
    const turnId = h.completeTurn();
    const call = await rejection(
      h.goals.judge(
        { goalId: gid("g1"), turnId, verdict: MET },
        asCaller(h.opts(), { kind: "host" }, h.threadId),
      ),
    );
    expect(call.data.code).toBe("goal_not_delegated");
  });

  test("only the owner or the host may judge, and the turn must have finished after the goal was set", async () => {
    const h = await harness();
    const turnId = await delegatedGoal(h);
    const model = await rejection(
      h.goals.judge({ goalId: gid("g1"), turnId, verdict: MET }, h.opts()),
    );
    expect(model.data.code).toBe("denied");
    const other = await rejection(
      h.goals.judge(
        { goalId: gid("g1"), turnId, verdict: MET },
        asCaller(h.opts(), { kind: "extension", extension: "someone-else" }, h.threadId),
      ),
    );
    expect(other.data.code).toBe("denied");
    const stale = await rejection(
      h.goals.judge(
        { goalId: gid("g1"), turnId: h.ids.next("trn"), verdict: MET },
        asCaller(h.opts(), { kind: "extension", extension: "checker" }, h.threadId),
      ),
    );
    expect(stale.data.code).toBe("goal_turn_stale");
    expect(judgmentsOf(h)).toEqual([]);
  });

  test("a not-met verdict is recorded, the goal stays active and the same turn answers the first judgment", async () => {
    const h = await harness();
    const turnId = await delegatedGoal(h);
    const owner = (requestId: string) =>
      asCaller(h.opts(requestId), { kind: "extension", extension: "checker" }, h.threadId);
    const first = await h.goals.judge({ goalId: gid("g1"), turnId, verdict: NOT_MET }, owner("j1"));
    expect(first.judgment).toEqual({
      goalId: gid("g1"),
      n: 1,
      turnId,
      verdict: NOT_MET,
      judgeKind: "delegated",
      failure: null,
    });
    expect(first.goal).toMatchObject({ status: "active", judgments: 1, lastVerdict: NOT_MET });

    const events = h.eventCount();
    const again = await h.goals.judge({ goalId: gid("g1"), turnId, verdict: MET }, owner("j2"));
    expect(again.judgment).toEqual(first.judgment);
    expect(h.eventCount()).toBe(events);
    const status = await h.goals.status({}, h.opts());
    expect(status.recent).toEqual([first.judgment]);
  });

  test("a met verdict closes the goal and builds the report with the usage of the turns and the judgments", async () => {
    const h = await harness();
    const turnId = await delegatedGoal(h);
    const out = await h.goals.judge(
      { goalId: gid("g1"), turnId, verdict: MET },
      asCaller(h.opts("j1"), { kind: "host" }, h.threadId),
    );
    expect(out.goal).toMatchObject({ status: "met", judgments: 1 });
    const [report] = reportsOf(h);
    expect(report).toMatchObject({
      reportId: "r1",
      subject: { kind: "goal", goalId: "g1" },
      outcome: "met",
      summary: MET.reason,
    });
    expect(report?.resources).toMatchObject({
      turns: 1,
      judgments: 1,
      agent: { inputTokens: 100, outputTokens: 20, costUsd: 0.5 },
      judge: { inputTokens: 0, costUsd: null },
    });
    expect(parse(WorkReportSchema, report).ok).toBe(true);
  });

  test("the last allowed run that is not met ends the goal as limit_reached", async () => {
    const h = await harness({ maxRuns: 1 });
    const turnId = await delegatedGoal(h);
    const out = await h.goals.judge(
      { goalId: gid("g1"), turnId, verdict: NOT_MET },
      asCaller(h.opts("j1"), { kind: "host" }, h.threadId),
    );
    expect(out.goal.status).toBe("limit_reached");
    expect(reportsOf(h)[0]).toMatchObject({
      outcome: "limit_reached",
      remaining: { missing: ["tests"] },
    });
  });
});

describe("work.reports build", () => {
  test("a closed goal has a report, an active goal does not, and a report keeps the caller's summary and artifacts", async () => {
    const h = await harness();
    await h.goals.set({ condition: "x" }, h.opts());
    const active = await rejection(
      h.reports.build({ subject: { kind: "goal", goalId: gid("g1") } }, h.opts("r1")),
    );
    expect(active.data.code).toBe("invalid_input");
    await h.goals.clear({}, h.opts());

    const built = await h.reports.build(
      {
        subject: { kind: "goal", goalId: gid("g1") },
        summary: "Done by hand.",
        artifacts: [{ artifactId: "art-1", kind: "diff", title: "Patch" }],
      },
      h.opts("r2"),
    );
    expect(built.report).toMatchObject({
      reportId: "r2",
      outcome: "cleared",
      summary: "Done by hand.",
      artifacts: [{ artifactId: "art-1", kind: "diff", title: "Patch" }],
    });
    const missing = await rejection(
      h.reports.build({ subject: { kind: "goal", goalId: gid("g7") } }, h.opts("r3")),
    );
    expect(missing.data.code).toBe("not_found");
  });

  test("a turn report sums the turn usage, lists the open tasks and refuses an unknown turn", async () => {
    const h = await harness();
    await h.api.create({ content: "write tests" }, h.opts());
    const turnId = h.completeTurn(h.threadId, usage(40, 10, 0.25));
    const built = await h.reports.build({ subject: { kind: "turn", turnId } }, h.opts("r1"));
    expect(built.report).toMatchObject({
      reportId: "r1",
      subject: { kind: "turn", turnId },
      outcome: "turn_completed",
      resources: {
        turns: 1,
        judgments: 0,
        agent: { inputTokens: 40, outputTokens: 10, costUsd: 0.25 },
      },
      remaining: { tasks: [{ id: "t1", content: "write tests", status: "pending" }], missing: [] },
      plan: null,
    });
    const unknown = await rejection(
      h.reports.build({ subject: { kind: "turn", turnId: h.ids.next("trn") } }, h.opts("r2")),
    );
    expect(unknown.data.code).toBe("not_found");
  });

  test("the same requestId builds once and answers the first report", async () => {
    const h = await harness();
    const turnId = h.completeTurn();
    const first = await h.reports.build({ subject: { kind: "turn", turnId } }, h.opts("same"));
    const events = h.eventCount();
    h.completeTurn();
    const eventsAfterTurn = h.eventCount();
    expect(await h.reports.build({ subject: { kind: "turn", turnId } }, h.opts("same"))).toEqual(
      first,
    );
    expect(h.eventCount()).toBe(eventsAfterTurn);
    expect(events).toBeLessThan(eventsAfterTurn);
    expect(reportsOf(h).map((report) => report.reportId)).toEqual([rid("r1")]);
  });
});
