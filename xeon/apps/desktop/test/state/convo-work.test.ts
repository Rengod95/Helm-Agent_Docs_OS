import { describe, expect, test } from "bun:test";
import { Bug, parse } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  GoalRecordSchema,
  WorkTaskRecordSchema,
  type GoalRecord,
  type WorkTaskRecord,
} from "@fresnel/contracts/records";
import {
  convoApply,
  convoLeaseAcquired,
  convoLeaseReleased,
  type Convo,
  type ConvoAt,
  type ConvoEvent,
} from "../../src/state/engine/convo.ts";
import { evt, thr, trn } from "./helpers.ts";

const T = thr(1);
const CHILD = thr(2);
const TURN = trn(1);

/** 사건 위치. 시험은 seq를 오름차순으로 주는 것이 기본이고, 늦게 온 사건은 작은 seq를 직접 준다 */
function pos(seq: number): ConvoAt {
  return {
    seq,
    eventId: evt(seq),
    turnId: TURN,
    at: `2026-10-24T00:00:${String(seq).padStart(2, "0")}.000Z`,
  };
}

function step(convo: Convo, seq: number, event: ConvoEvent): Convo {
  return convoApply(convo, T, pos(seq), event);
}

// 값 모양은 스키마 검증을 거쳐 만든다(브랜드 id를 as 없이 얻는다)
function goalRecord(goalId = "g1"): GoalRecord {
  const parsed = parse(GoalRecordSchema, {
    goalId,
    condition: "all green",
    judge: { kind: "model" },
    maxRuns: 5,
    continuation: "self",
    judgments: 0,
    status: "active",
    lastVerdict: null,
  });
  if (!parsed.ok) throw new Bug("test goal is not a valid goal record");
  return parsed.value;
}

function taskRecord(id: string): WorkTaskRecord {
  const parsed = parse(WorkTaskRecordSchema, {
    id,
    content: `task ${id}`,
    activeForm: null,
    status: "pending",
    owner: null,
    blockedBy: [],
  });
  if (!parsed.ok) throw new Bug(`test task ${id} is not a valid task record`);
  return parsed.value;
}

// ── 목표 ──────────────────────────────────────────────────────────────

const GOAL = goalRecord();
const OTHER = goalRecord("g2");

function goalSet(): ConvoEvent {
  return { kind: "work.goal_set", payload: { goal: GOAL } };
}

function judged(n: number, met: boolean, reason: string): ConvoEvent {
  return {
    kind: "work.goal_judged",
    payload: {
      goalId: GOAL.goalId,
      n,
      turnId: TURN,
      verdict: { met, reason, missing: met ? [] : ["fix test a"] },
      judgeKind: "model",
      failure: null,
      usage: null,
    },
  };
}

function goalSettled(status: GoalRecord["status"], judgments: number): ConvoEvent {
  return { kind: "work.goal_settled", payload: { goalId: GOAL.goalId, status, judgments } };
}

describe("work goal projection", () => {
  test("goal_set puts an active goal with no judgments into the thread", () => {
    const convo = step({}, 1, goalSet());
    expect(convo[T]?.goal?.goal).toEqual(GOAL);
    expect(convo[T]?.goal?.goal.status).toBe("active");
    expect(convo[T]?.goal?.goal.judgments).toBe(0);
    expect(convo[T]?.goal?.goal.lastVerdict).toBeNull();
  });

  test("goal_judged n=1 sets the judgment count to 1 and records the verdict", () => {
    const convo = step(step({}, 1, goalSet()), 2, judged(1, false, "one failing"));
    expect(convo[T]?.goal?.goal.judgments).toBe(1);
    expect(convo[T]?.goal?.judgments.map((j) => j.n)).toEqual([1]);
    expect(convo[T]?.goal?.goal.lastVerdict).toEqual({
      met: false,
      reason: "one failing",
      missing: ["fix test a"],
    });
  });

  test("lastVerdict follows n=2 even when n=1 (other verdict) arrives after it", () => {
    const afterTwo = step(step({}, 1, goalSet()), 2, judged(2, false, "two failing"));
    const late = step(afterTwo, 3, judged(1, true, "late first"));
    expect(late[T]?.goal?.goal.judgments).toBe(2);
    expect(late[T]?.goal?.judgments.map((j) => j.n)).toEqual([1, 2]);
    expect(late[T]?.goal?.goal.lastVerdict).toEqual({
      met: false,
      reason: "two failing",
      missing: ["fix test a"],
    });
  });

  test("lastVerdict is the n=2 verdict when judgments arrive in order", () => {
    const convo = step(
      step(step({}, 1, goalSet()), 2, judged(1, false, "one failing")),
      3,
      judged(2, false, "two failing"),
    );
    expect(convo[T]?.goal?.goal.lastVerdict?.reason).toBe("two failing");
  });

  test("goal_settled sets status met and the judgment count", () => {
    const judgedTwo = step(
      step(step({}, 1, goalSet()), 2, judged(1, false, "a")),
      3,
      judged(2, false, "b"),
    );
    const met = step(judgedTwo, 4, goalSettled("met", 2));
    expect(met[T]?.goal?.goal.status).toBe("met");
    expect(met[T]?.goal?.goal.judgments).toBe(2);
  });

  test("a goal_settled older than the goal's last applied seq is ignored", () => {
    const met = step(
      step(step(step({}, 1, goalSet()), 2, judged(1, false, "a")), 3, judged(2, false, "b")),
      4,
      goalSettled("met", 2),
    );
    const stale = step(met, 2, goalSettled("cleared", 0));
    expect(stale).toEqual(met);
    expect(stale[T]?.goal?.goal.status).toBe("met");
  });

  test("a goal_set older than the current goal does not replace it", () => {
    const current = step(step({}, 1, goalSet()), 5, judged(1, false, "a"));
    expect(step(current, 2, goalSet())).toEqual(current);
  });

  test("goal_judged for another goal id is ignored", () => {
    const start = step({}, 1, goalSet());
    const other: ConvoEvent = {
      kind: "work.goal_judged",
      payload: {
        goalId: OTHER.goalId,
        n: 1,
        turnId: TURN,
        verdict: { met: true, reason: "other", missing: [] },
        judgeKind: "model",
        failure: null,
        usage: null,
      },
    };
    expect(step(start, 2, other)).toEqual(start);
  });
});

// ── 할 일 ──────────────────────────────────────────────────────────────

const T1 = taskRecord("t1");
const T2 = taskRecord("t2");

function taskCreated(task: WorkTaskRecord): ConvoEvent {
  return { kind: "work.task_created", payload: { task, ref: null } };
}

function taskStatus(taskId: WorkTaskRecord["id"], status: WorkTaskRecord["status"]): ConvoEvent {
  return {
    kind: "work.task_changed",
    payload: { taskId, from: "pending", set: { status }, cause: "call" },
  };
}

describe("work task projection", () => {
  test("task_created adds the task and its order", () => {
    const convo = step({}, 1, taskCreated(T1));
    expect(convo[T]?.tasks[T1.id]?.task).toEqual(T1);
    expect(convo[T]?.taskOrder).toEqual([T1.id]);
  });

  test("task_changed applies the changed status", () => {
    const created = step({}, 1, taskCreated(T1));
    const changed = step(created, 2, taskStatus(T1.id, "in_progress"));
    expect(changed[T]?.tasks[T1.id]?.task.status).toBe("in_progress");
  });

  test("a task_changed with an older seq does not roll the task back", () => {
    const created = step({}, 1, taskCreated(T1));
    const done = step(created, 5, taskStatus(T1.id, "completed"));
    const stale = step(done, 3, taskStatus(T1.id, "in_progress"));
    expect(stale[T]?.tasks[T1.id]?.task.status).toBe("completed");
    expect(stale).toEqual(done);
  });

  test("the same task_changed applied twice gives the same convo", () => {
    const created = step({}, 1, taskCreated(T1));
    const once = step(created, 2, taskStatus(T1.id, "in_progress"));
    const twice = step(once, 2, taskStatus(T1.id, "in_progress"));
    expect(twice).toEqual(once);
    expect(twice[T]?.tasks[T1.id]?.task.status).toBe("in_progress");
  });

  test("task_changed for a task never created is ignored", () => {
    const start = step({}, 1, taskCreated(T1));
    expect(step(start, 2, taskStatus(T2.id, "completed"))).toEqual(start);
  });

  test("task_linked adds the blocker and task_unlinked removes it", () => {
    const both = step(step({}, 1, taskCreated(T1)), 2, taskCreated(T2));
    const linked = step(both, 3, {
      kind: "work.task_linked",
      payload: { taskId: T1.id, blockedBy: [T2.id] },
    });
    expect(linked[T]?.tasks[T1.id]?.task.blockedBy).toEqual([T2.id]);
    const unlinked = step(linked, 4, {
      kind: "work.task_unlinked",
      payload: { taskId: T1.id, blockedBy: [T2.id] },
    });
    expect(unlinked[T]?.tasks[T1.id]?.task.blockedBy).toEqual([]);
  });
});

// ── 하위 에이전트 ─────────────────────────────────────────────────────

function agentSpawned(): ConvoEvent {
  return {
    kind: "agent.spawned",
    payload: {
      childThreadId: CHILD,
      agent: "reviewer",
      requestId: "rq1",
      owner: { kind: "scope", scopeId: "sc1" },
      caller: "subagent:reviewer",
      depth: 1,
      background: false,
      fork: null,
      modelRole: "main",
    },
  };
}

function agentSettled(
  status: "completed" | "aborted" | "error",
  child: ThreadId = CHILD,
): ConvoEvent {
  return {
    kind: "agent.settled",
    payload: {
      childThreadId: child,
      requestId: "rq1",
      status,
      report: { text: "abc", truncated: false, flags: [], originalChars: 3 },
      answerItemId: null,
      usage: null,
      error: null,
      limitHit: "steps",
    },
  };
}

function agentJudged(n: number, goalRef: string = "g1"): ConvoEvent {
  return {
    kind: "agent.judged",
    payload: {
      goalRef,
      run: n,
      verdict: "met",
      rationale: "all green",
      missing: [],
      usage: null,
      model: { provider: "anthropic", modelId: "claude-haiku-5-5" },
    },
  };
}

describe("agent projection", () => {
  test("agent.spawned records a running child", () => {
    const convo = step({}, 1, agentSpawned());
    expect(convo[T]?.agents.length).toBe(1);
    expect(convo[T]?.agents[0]?.status).toBe("running");
    expect(convo[T]?.agents[0]?.childThreadId).toBe(CHILD);
  });

  test("agent.settled fills in status, report and limit; a second settle is ignored", () => {
    const spawned = step({}, 1, agentSpawned());
    const settled = step(spawned, 2, agentSettled("completed"));
    const agent = settled[T]?.agents[0];
    expect(agent?.status).toBe("completed");
    expect(agent?.reportText).toBe("abc");
    expect(agent?.reportTruncated).toBe(false);
    expect(agent?.limitHit).toBe("steps");
    expect(agent?.settledAt).toBe(pos(2).at);

    const again = step(settled, 3, agentSettled("error"));
    expect(again).toEqual(settled);
  });

  test("agent.settled for a child never spawned leaves the convo as it was", () => {
    const start: Convo = {};
    expect(step(start, 1, agentSettled("completed", thr(9)))).toBe(start);
  });

  test("agent.judged keeps one judgment per goalRef and run", () => {
    const first = step({}, 1, agentJudged(1));
    const dup = step(first, 2, agentJudged(1));
    expect(dup[T]?.judgments.map((j) => j.run)).toEqual([1]);
    const next = step(dup, 3, agentJudged(2));
    expect(next[T]?.judgments.map((j) => j.run)).toEqual([1, 2]);
  });
});

// ── 도구 개입과 비밀 ──────────────────────────────────────────────────

const HANDLE = "secret://api-key";

function sandboxBypassed(): ConvoEvent {
  return {
    kind: "tool.sandbox_bypassed",
    payload: { toolCallId: "c1", toolName: "bash", reason: "escape", at: 1 },
  };
}

function untrustedRead(): ConvoEvent {
  return {
    kind: "tool.untrusted_read",
    payload: { turnId: TURN, toolCallId: "c1", toolName: "web_fetch", at: 2 },
  };
}

function secretUsed(): ConvoEvent {
  return {
    kind: "secret.used",
    payload: {
      handle: HANDLE,
      mode: "env",
      toolCallId: "c1",
      host: null,
      commandHash: null,
      leaseId: "l1",
      at: 3,
    },
  };
}

function secretDenied(): ConvoEvent {
  return {
    kind: "secret.denied",
    payload: {
      handle: HANDLE,
      mode: "env",
      reason: "not_allowed",
      purpose: "test",
      toolCallId: "c1",
      at: 4,
    },
  };
}

function secretApproved(): ConvoEvent {
  return {
    kind: "secret.approved",
    payload: { handle: HANDLE, scope: "per-session", approvalId: evt(9), expiresAt: null, at: 5 },
  };
}

function secretMasked(): ConvoEvent {
  return {
    kind: "secret.masked",
    payload: { hits: [{ kind: "token", count: 1 }], layer: "outbound", at: 6 },
  };
}

describe("tool interventions", () => {
  test("tool.sandbox_bypassed attaches to its tool call", () => {
    const convo = step({}, 1, sandboxBypassed());
    const first = convo[T]?.tools["c1"]?.interventions[0];
    expect(first?.kind).toBe("sandbox_bypassed");
    expect(first?.reason).toBe("escape");
    expect(first?.detail).toBe("bash");
  });

  test("untrusted read and secret used/denied attach to the same tool call, in order", () => {
    const events: readonly ConvoEvent[] = [
      sandboxBypassed(),
      untrustedRead(),
      secretUsed(),
      secretDenied(),
    ];
    const convo = events.reduce<Convo>((acc, event, i) => step(acc, i + 1, event), {});
    const kinds = convo[T]?.tools["c1"]?.interventions.map((i) => i.kind);
    expect(kinds).toEqual(["sandbox_bypassed", "untrusted_read", "secret_used", "secret_denied"]);
    expect(convo[T]?.toolOrder).toEqual(["c1"]);
  });

  test("the same intervention applied twice is recorded once", () => {
    const once = step({}, 1, sandboxBypassed());
    const twice = step(once, 2, sandboxBypassed());
    expect(twice[T]?.tools["c1"]?.interventions.length).toBe(1);
    expect(twice).toEqual(once);
  });

  test("secret.approved and secret.masked go to looseInterventions, not to a tool", () => {
    const approved = step({}, 1, secretApproved());
    expect(approved[T]?.tools["c1"]).toBeUndefined();
    expect(approved[T]?.looseInterventions.map((i) => i.kind)).toEqual(["secret_approved"]);
    expect(approved[T]?.looseInterventions[0]?.reason).toBe("per-session");
    expect(approved[T]?.looseInterventions[0]?.detail).toBe(HANDLE);

    const both = step(approved, 2, secretMasked());
    expect(both[T]?.looseInterventions.map((i) => i.kind)).toEqual([
      "secret_approved",
      "secret_masked",
    ]);
    expect(both[T]?.looseInterventions[1]?.detail).toBe("outbound");
  });
});

// ── 주도 임대 ─────────────────────────────────────────────────────────

describe("lease records", () => {
  test("lease.acquired opens a lease with no release yet", () => {
    const convo = convoLeaseAcquired({}, T, pos(1), {
      leaseId: "l1",
      scopeId: "sc1",
      lineageId: "ln1",
      limits: { maxTurns: 3 },
    });
    const lease = convo[T]?.leases[0];
    expect(convo[T]?.leases.length).toBe(1);
    expect(lease?.leaseId).toBe("l1");
    expect(lease?.limits).toEqual({ maxTurns: 3 });
    expect(lease?.releasedSeq).toBeNull();
    expect(lease?.releaseReason).toBeNull();
  });

  test("lease.released records the reason and seq; a second release is ignored", () => {
    const acquired = convoLeaseAcquired({}, T, pos(1), {
      leaseId: "l1",
      scopeId: "sc1",
      lineageId: "ln1",
      limits: { maxTurns: 3 },
    });
    const released = convoLeaseReleased(acquired, T, pos(2), {
      leaseId: "l1",
      scopeId: "sc1",
      reason: "budget",
    });
    expect(released[T]?.leases[0]?.releaseReason).toBe("budget");
    expect(released[T]?.leases[0]?.releasedSeq).toBe(2);
    expect(released[T]?.leases[0]?.releasedAt).toBe(pos(2).at);

    const again = convoLeaseReleased(released, T, pos(3), {
      leaseId: "l1",
      scopeId: "sc1",
      reason: "idle",
    });
    expect(again).toEqual(released);
    expect(again[T]?.leases[0]?.releaseReason).toBe("budget");
    expect(again[T]?.leases[0]?.releasedSeq).toBe(2);
  });

  test("lease.released for an unknown lease is ignored", () => {
    const released = convoLeaseReleased({}, T, pos(2), {
      leaseId: "nope",
      scopeId: "sc1",
      reason: "budget",
    });
    expect(released).toEqual({});
  });
});
