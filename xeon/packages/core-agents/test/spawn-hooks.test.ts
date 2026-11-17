import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { AgentSettledEventPayloadSchema } from "@fresnel/contracts/records";
import type {
  DelegateRequest,
  ReportDelivery,
  SpawnOrigin,
  SpawnRequest,
} from "@fresnel/contracts/services";
import { openHarness, type Harness } from "./support/harness.ts";

// M5e 스펙 §4.3.3(agent.spawn.before)과 §4.3.4(agent.spawn.after). 세 입구가 한 번씩 발화하고, 결정과 보고 고치기가 정해진 대로 간다.

const REPORT_DELIVERY: ReportDelivery = {
  customType: "grp.learning.review.report",
  display: false,
  when: "next",
};

function eventsOf(h: Harness, kind: string) {
  return h.session.events.filter((event) => event.kind === kind);
}

function kindsOf(h: Harness): string[] {
  return h.session.events.map((event) => event.kind);
}

function driveOrigin(h: Harness, requestId: string): SpawnOrigin {
  return {
    parentThreadId: h.parentThreadId,
    owner: { kind: "drive", turnId: null, scopeId: "grp", leaseId: "lease-1" },
    caller: "main",
    depth: 0,
    ownerRequestId: requestId,
    signal: new AbortController().signal,
  };
}

function scopeOrigin(h: Harness, ownerRequestId: string): SpawnOrigin {
  return {
    parentThreadId: h.parentThreadId,
    owner: { kind: "scope", scopeId: "helm" },
    caller: "main",
    depth: 0,
    ownerRequestId,
    signal: new AbortController().signal,
  };
}

function spawnRequest(extra: Partial<SpawnRequest> = {}): SpawnRequest {
  return { agent: "explorer", task: "look", ...extra };
}

function delegateRequest(requestId: string, extra: Partial<DelegateRequest> = {}): DelegateRequest {
  return {
    agent: "explorer",
    task: "look",
    requestId,
    report: REPORT_DELIVERY,
    ...extra,
  };
}

function waitUntil(done: () => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const tick = (): void => {
      if (done()) resolve();
      else setTimeout(tick, 1);
    };
    tick();
  });
}

describe("agent.spawn.before: the three entries", () => {
  test("the agent tool entry fires once, before the child exists, with entry tool and the tool call id", async () => {
    const h = openHarness();
    const { origin } = h.openToolCall("tc-entry");
    const result = await h.service.spawn(spawnRequest(), origin);
    expect(result.status).toBe("completed");
    expect(h.hooks.before).toHaveLength(1);
    const call = h.hooks.before[0];
    expect(call?.observed).toEqual({ threads: 1, spawned: 0, settled: 0 });
    expect(call?.dispatchKey).toBe("agent.spawn.before:tool:tc-entry:spawn:0");
    expect(call?.payload).toEqual({
      threadId: h.parentThreadId,
      requestId: "tool:tc-entry:spawn:0",
      agent: "explorer",
      task: "look",
      caller: "main",
      depth: 0,
      entry: "tool",
      toolCallId: "tc-entry",
      background: false,
      model: "subagent",
    });
  });

  test("the loop.spawn entry (drive) fires once with entry drive and no tool call id", async () => {
    const h = openHarness();
    const result = await h.service.spawn(
      spawnRequest({ requestId: "lease-1:0.0" }),
      driveOrigin(h, "lease-1:0.0"),
    );
    expect(result.status).toBe("completed");
    expect(h.hooks.before).toHaveLength(1);
    expect(h.hooks.before[0]?.payload).toEqual({
      threadId: h.parentThreadId,
      requestId: "lease-1:0.0",
      agent: "explorer",
      task: "look",
      caller: "main",
      depth: 0,
      entry: "drive",
      background: false,
      model: "subagent",
    });
  });

  test("the g.delegate entry (scope) fires once with entry delegate and background true", async () => {
    const h = openHarness();
    const accepted = await h.service.delegate(delegateRequest("d-1"), scopeOrigin(h, "d-1"));
    expect(accepted).toMatchObject({ ok: true, receipt: { requestId: "d-1", status: "accepted" } });
    expect(h.hooks.before).toHaveLength(1);
    expect(h.hooks.before[0]?.payload).toMatchObject({
      requestId: "d-1",
      entry: "delegate",
      background: true,
    });
    expect(h.hooks.before[0]?.payload).not.toHaveProperty("toolCallId");
    await waitUntil(() => eventsOf(h, "agent.settled").length === 1);
  });

  test("two calls with one requestId that both reach the gate before the first commit share one child", async () => {
    const h = openHarness();
    const origin = driveOrigin(h, "race-1");
    const first = h.service.spawn(spawnRequest({ requestId: "race-1" }), origin);
    const second = h.service.spawn(spawnRequest({ requestId: "race-1" }), origin);
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe("completed");
    expect(b.childThreadId).toBe(a.childThreadId);
    expect(b.reused).toBe(true);
    expect(eventsOf(h, "agent.spawned")).toHaveLength(1);
    expect(h.loop.calls).toHaveLength(1);
    expect(h.session.created).toEqual([h.parentThreadId, a.childThreadId]);
  });

  test("a repeated requestId attaches to the existing child and does not fire the hook again", async () => {
    const h = openHarness();
    const first = await h.service.spawn(
      spawnRequest({ requestId: "again-1" }),
      driveOrigin(h, "again-1"),
    );
    const second = await h.service.spawn(
      spawnRequest({ requestId: "again-1" }),
      driveOrigin(h, "again-1"),
    );
    expect(second.reused).toBe(true);
    expect(second.childThreadId).toBe(first.childThreadId);
    expect(h.hooks.before).toHaveLength(1);
  });

  test("the payload cuts the task to 4,000 characters and carries the child limits", async () => {
    const h = openHarness();
    await h.service.spawn(
      spawnRequest({ task: "x".repeat(4500), limits: { maxSteps: 3 } }),
      driveOrigin(h, "cut-1"),
    );
    expect(h.hooks.before[0]?.payload.task).toHaveLength(4000);
    expect(h.hooks.before[0]?.payload.limits).toEqual({ maxSteps: 3 });
  });
});

describe("agent.spawn.before: block", () => {
  test("a block refuses a foreground spawn: no child, no agent.spawned, the denied-by-extension line for the model", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ block: true, reason: "no explorers today" }, "policy-ext");
    const { origin } = h.openToolCall("tc-block");
    const result = await h.service.spawn(spawnRequest(), origin);
    expect(result.status).toBe("error");
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: [fresnel:denied_by_extension] no explorers today",
    );
    expect(h.session.created).toEqual([h.parentThreadId]);
    expect(eventsOf(h, "agent.spawned")).toHaveLength(0);
    expect(h.hooks.after).toHaveLength(0);
  });

  test("a block refuses a background delegate with the same line and creates no child", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ block: true, reason: "no explorers today" }, "policy-ext");
    const result = await h.service.delegate(delegateRequest("d-block"), scopeOrigin(h, "d-block"));
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "agents.denied",
        message: "[fresnel:denied_by_extension] no explorers today",
      },
    });
    expect(h.session.created).toEqual([h.parentThreadId]);
    expect(eventsOf(h, "agent.spawned")).toHaveLength(0);
  });

  test("a failing handler (the dispatch rejects) refuses closed with the FIRST_DENY reason", async () => {
    const h = openHarness();
    h.hooks.failBefore();
    const { origin } = h.openToolCall("tc-throw");
    const result = await h.service.spawn(spawnRequest(), origin);
    expect(result.status).toBe("error");
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: [fresnel:denied_by_extension] extension handler failed",
    );
    expect(h.session.created).toEqual([h.parentThreadId]);
    expect(eventsOf(h, "agent.spawned")).toHaveLength(0);
  });
});

describe("agent.spawn.before: replace", () => {
  test("a replace returns the report as a completed result and records no child", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ replace: { report: "from the hook" }, reason: "cached" }, "cache-ext");
    const { origin } = h.openToolCall("tc-replace");
    const result = await h.service.spawn(spawnRequest(), origin);
    expect(result.status).toBe("completed");
    expect(result.answer).toBe("from the hook");
    expect(result.report).toBeNull();
    expect(result.reused).toBe(false);
    expect(h.session.created).toEqual([h.parentThreadId]);
    expect(eventsOf(h, "agent.spawned")).toHaveLength(0);
    expect(eventsOf(h, "agent.settled")).toHaveLength(0);
    expect(h.service.status(h.parentThreadId, "tool:tc-replace:spawn:0")).toBeUndefined();
    expect(h.hooks.after).toHaveLength(0);
  });

  test("a replace on a background delegate returns the report in the receipt and posts no inbox input", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ replace: { report: "from the hook" }, reason: "cached" }, "cache-ext");
    const result = await h.service.delegate(delegateRequest("d-rep"), scopeOrigin(h, "d-rep"));
    expect(result).toMatchObject({
      ok: true,
      receipt: { requestId: "d-rep", status: "replaced", report: "from the hook" },
    });
    expect(h.session.created).toEqual([h.parentThreadId]);
    expect(kindsOf(h)).not.toContain("agent.spawned");
    expect(kindsOf(h)).not.toContain("agent.settled");
    expect(kindsOf(h)).not.toContain("input.queued");
  });
});

describe("agent.spawn.before: ask", () => {
  test("an ask opens one tool card named agent with the agent and task, and an allow runs the child", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ ask: true, reason: "needs review" }, "guard-ext");
    const { origin, turnId } = h.openToolCall("tc-ask");
    const result = await h.service.spawn(spawnRequest(), origin);
    expect(result.status).toBe("completed");
    expect(h.approvals.requests).toHaveLength(1);
    const card = h.approvals.requests[0];
    expect(card?.origin).toEqual({
      threadId: h.parentThreadId,
      turnId,
      stepId: null,
      toolCallId: null,
      caller: "main",
    });
    expect(card?.remember).toEqual(["once"]);
    expect(card?.body).toMatchObject({
      kind: "tool",
      tool: {
        toolName: "agent",
        risk: "exec",
        args: { agent: "explorer", task: "look" },
        ruleId: "hook:guard-ext",
        askedBy: { extension: "guard-ext", reason: "needs review" },
      },
    });
    expect(h.session.created).toHaveLength(2);
  });

  test("a deny refuses the spawn and records no child", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ ask: true, reason: "needs review" }, "guard-ext");
    h.approvals.answer("deny");
    const { origin } = h.openToolCall("tc-deny");
    const result = await h.service.spawn(spawnRequest(), origin);
    expect(result.status).toBe("error");
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: The user denied this subagent run.",
    );
    expect(h.approvals.requests).toHaveLength(1);
    expect(h.session.created).toEqual([h.parentThreadId]);
  });

  test("an ask from a subagent (depth > 0) is refused without opening a card", async () => {
    const h = openHarness({ maxDepth: 2 });
    h.hooks.decideBefore({ ask: true, reason: "needs review" }, "guard-ext");
    const result = await h.service.spawn(spawnRequest(), {
      ...driveOrigin(h, "deep-1"),
      caller: "subagent:explorer",
      depth: 1,
    });
    expect(result.status).toBe("error");
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: [fresnel:denied_by_extension] needs review (confirmation unavailable)",
    );
    expect(h.approvals.requests).toHaveLength(0);
    expect(h.session.created).toEqual([h.parentThreadId]);
  });

  test("an ask with no approval port is refused as unconfirmed", async () => {
    const h = openHarness({ withApprovals: false });
    h.hooks.decideBefore({ ask: true, reason: "needs review" }, "guard-ext");
    const result = await h.service.spawn(spawnRequest(), driveOrigin(h, "noport-1"));
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: [fresnel:denied_by_extension] needs review (confirmation unavailable)",
    );
    expect(h.session.created).toEqual([h.parentThreadId]);
  });

  test("an ask whose card cannot be opened is refused as unconfirmed", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ ask: true, reason: "needs review" }, "guard-ext");
    h.approvals.failNext();
    const result = await h.service.spawn(spawnRequest(), driveOrigin(h, "failcard-1"));
    expect(result.answer).toBe(
      "[fresnel:subagent_error] agents.denied: [fresnel:denied_by_extension] needs review (confirmation unavailable)",
    );
    expect(h.session.created).toEqual([h.parentThreadId]);
  });
});

describe("agent.spawn.after", () => {
  test("a patch changes the reported text in the result and in the stored agent.settled, and runs before the commit", async () => {
    const h = openHarness();
    h.hooks.patchAfter((text) => text.replace("found it", "patched"));
    const result = await h.service.spawn(
      spawnRequest({ requestId: "after-1" }),
      driveOrigin(h, "after-1"),
    );
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("patched");
    expect(result.answer).not.toContain("found it");
    expect(h.hooks.after).toHaveLength(1);
    const call = h.hooks.after[0];
    expect(call?.initial.report.text).toContain("found it");
    expect(call?.observed.settled).toBe(0);
    expect(call?.payload).toMatchObject({
      threadId: h.parentThreadId,
      requestId: "after-1",
      agent: "explorer",
      status: "completed",
      childThreadId: result.childThreadId,
    });
    const settled = eventsOf(h, "agent.settled")[0];
    expect(settled?.payload).toMatchObject({ status: "completed" });
    expect(JSON.stringify(settled?.payload)).toContain("patched");
  });

  test("a patch longer than the stored limit is cut to 60,000 characters and marked truncated", async () => {
    const h = openHarness();
    h.hooks.patchAfter(() => "y".repeat(70_000));
    const result = await h.service.spawn(spawnRequest(), driveOrigin(h, "cap-1"));
    expect(result.report?.truncated).toBe(true);
    expect(result.report?.text).toHaveLength(60_000);
    const settled = parse(AgentSettledEventPayloadSchema, eventsOf(h, "agent.settled")[0]?.payload);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.value.report?.truncated).toBe(true);
    expect(settled.value.report?.text).toHaveLength(60_000);
    expect(settled.value.status).toBe("completed");
  });

  test("a failing after handler keeps the report and the settle still commits", async () => {
    const h = openHarness();
    h.hooks.failAfter();
    const result = await h.service.spawn(spawnRequest(), driveOrigin(h, "failafter-1"));
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("found it");
    expect(eventsOf(h, "agent.settled")).toHaveLength(1);
  });

  test("a background delegate runs the after hook when the child settles", async () => {
    const h = openHarness();
    h.hooks.patchAfter((text) => text.replace("found it", "bg patched"));
    await h.service.delegate(delegateRequest("bg-after"), scopeOrigin(h, "bg-after"));
    await waitUntil(() => h.hooks.after.length === 1 && eventsOf(h, "agent.settled").length === 1);
    expect(h.hooks.after[0]?.payload).toMatchObject({ requestId: "bg-after", status: "completed" });
    expect(JSON.stringify(eventsOf(h, "agent.settled")[0]?.payload)).toContain("bg patched");
  });

  test("the agent.spawn.before block keeps the after hook from running for a refused spawn", async () => {
    const h = openHarness();
    h.hooks.decideBefore({ block: true, reason: "stop" }, "policy-ext");
    await h.service.spawn(spawnRequest(), driveOrigin(h, "noafter-1"));
    expect(h.hooks.after).toHaveLength(0);
  });

  test("with no decision the spawn proceeds, the hook fires once, and no card opens", async () => {
    const h = openHarness();
    const result = await h.service.spawn(spawnRequest(), driveOrigin(h, "nodecision-1"));
    expect(result.status).toBe("completed");
    expect(h.hooks.before).toHaveLength(1);
    expect(h.approvals.requests).toHaveLength(0);
  });
});
