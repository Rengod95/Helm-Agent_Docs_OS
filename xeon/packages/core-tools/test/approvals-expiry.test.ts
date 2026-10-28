import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@xeon/contracts/records";
import type { ApprovalBody, ApprovalRequestInput } from "@xeon/contracts/services";
import { createApprovalService } from "../src/approvals/service.ts";
import { unattendedPlan } from "../src/approvals/unattended.ts";
import { systemScheduler } from "../src/approvals/timer.ts";
import {
  callTool,
  createHarness,
  expectOk,
  NOW,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";
import { manualTime } from "./support/manual-time.ts";

// M3-REQ-72(M3-06) 승인 만료와 M3-REQ-73(M3-08) 무인 승인 정책. 시계와 타이머는 주입한다.

const QUESTION: ApprovalBody = {
  kind: "question",
  question: {
    questions: [
      {
        id: "color",
        text: "Which color?",
        options: [
          { id: "red", label: "Red" },
          { id: "blue", label: "Blue" },
        ],
        multiSelect: false,
        allowFreeText: false,
      },
    ],
  },
};

function requestOf(
  h: Harness,
  extra: Partial<ApprovalRequestInput>,
  key: string = "k1",
): ApprovalRequestInput {
  return {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey: key,
    title: "Which color?",
    body: QUESTION,
    remember: ["once"],
    ...extra,
  };
}

function resolvedEvents(h: Harness) {
  return h.session.events
    .filter((event) => event.kind === "approval.resolved")
    .map((event) => {
      const parsed = parse(ApprovalResolvedPayloadSchema, event.payload);
      if (!parsed.ok) throw new Error("approval.resolved payload is invalid");
      return parsed.value;
    });
}

test("expiresAt and onExpire are recorded in approval.requested", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const opened = expectOk(
    await h.runtime.approvals.open(
      requestOf(h, { expiresAt: NOW + 60_000, onExpire: { decision: "deny" } }),
    ),
  );
  const requested = h.session.events.find((event) => event.kind === "approval.requested");
  const payload = parse(ApprovalRequestedPayloadSchema, requested?.payload);
  expect(payload.ok && payload.value).toMatchObject({
    expiresAt: NOW + 60_000,
    onExpire: { decision: "deny" },
  });
  expect(opened.request.expiresAt).toBe(NOW + 60_000);
  expect(time.timers()).toBe(1);
});

test("a pending approval expires to deny when the clock reaches expiresAt, and the waiter gets the result", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const opened = expectOk(
    await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 60_000 })),
  );
  const approvalId = opened.request.approvalId;
  const waiting = h.runtime.approvals.wait(approvalId, new AbortController().signal);

  await time.advance(59_999);
  expect(resolvedEvents(h)).toEqual([]);
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);

  await time.advance(1);
  const [only, ...rest] = resolvedEvents(h);
  expect(rest).toEqual([]);
  expect(String(only?.approvalId)).toBe(approvalId);
  expect({ ...only, approvalId: "" }).toEqual({
    approvalId: "",
    decision: "deny",
    answer: null,
    remember: "once",
    requestedRemember: null,
    resolvedBy: "expired",
  });
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
  const waited = await waiting;
  expect(waited.ok && waited.value).toMatchObject({ decision: "deny", resolvedBy: "expired" });
  expect(time.timers()).toBe(0);
});

test("onExpire answer resolves a question with the given answer, and an invalid answer falls back to deny", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const good = expectOk(
    await h.runtime.approvals.open(
      requestOf(
        h,
        {
          expiresAt: NOW + 1000,
          onExpire: { decision: "answer", answer: { color: { selected: ["blue"] } } },
        },
        "good",
      ),
    ),
  );
  const bad = expectOk(
    await h.runtime.approvals.open(
      requestOf(
        h,
        {
          expiresAt: NOW + 1000,
          onExpire: { decision: "answer", answer: { color: { selected: ["green"] } } },
        },
        "bad",
      ),
    ),
  );
  await time.advance(1000);
  const byId = new Map(resolvedEvents(h).map((event) => [String(event.approvalId), event]));
  expect(byId.get(good.request.approvalId)).toMatchObject({
    decision: "answer",
    answer: { color: { selected: ["blue"] } },
    resolvedBy: "expired",
  });
  expect(byId.get(bad.request.approvalId)).toMatchObject({
    decision: "deny",
    answer: null,
    resolvedBy: "expired",
  });
});

test("a timer that wakes before the clock reaches expiresAt only re-arms", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  expectOk(await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 5000 })));
  await time.fireAll();
  expect(resolvedEvents(h)).toEqual([]);
  expect(time.timers()).toBe(1);
  await time.advance(5000);
  expect(resolvedEvents(h)).toHaveLength(1);
});

test("a response before expiresAt wins and cancels the timer", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const opened = expectOk(await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 5000 })));
  const applied = await h.runtime.approvals.respond(opened.request.approvalId, {
    decision: "answer",
    answer: { color: { selected: ["red"] } },
  });
  expect(applied).toEqual({ applied: true });
  expect(time.timers()).toBe(0);
  await time.advance(10_000);
  expect(resolvedEvents(h).map((event) => event.resolvedBy)).toEqual(["user"]);
});

test("a response after expiresAt but before the timer ran is refused and the approval is expired", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock });
  const opened = expectOk(await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 5000 })));
  await time.advance(6000);
  const applied = await h.runtime.approvals.respond(opened.request.approvalId, {
    decision: "answer",
    answer: { color: { selected: ["red"] } },
  });
  expect(applied).toEqual({ applied: false, reason: "already_resolved" });
  expect(resolvedEvents(h).map((event) => event.resolvedBy)).toEqual(["expired"]);
});

test("restore resolves requests whose expiresAt passed while the engine was down, and keeps the recorded time", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const overdue = expectOk(
    await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 1000 }, "overdue")),
  );
  const later = expectOk(
    await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 90_000 }, "later")),
  );
  // 재시작: 같은 세션 위에 새 서비스를 세우고 시계를 옮긴다
  const restarted = manualTime(NOW + 30_000);
  const fresh = createApprovalService({
    session: h.deps.session,
    producer: h.deps.producer,
    ids: h.deps.ids,
    clock: restarted.clock,
    scheduler: restarted.scheduler,
    ext: h.deps.ext,
    logger: undefined,
    callOf: () => undefined,
    modeOf: () => "default",
    setMode: (_thread, mode) => Promise.resolve({ ok: true, mode }),
  });
  const pending = expectOk(await fresh.restore(h.thread));
  expect(pending.map((request) => request.approvalId)).toEqual([later.request.approvalId]);
  expect(pending[0]?.expiresAt).toBe(NOW + 90_000);
  expect(
    resolvedEvents(h).find((event) => event.approvalId === overdue.request.approvalId),
  ).toMatchObject({ resolvedBy: "expired", decision: "deny" });
  // 남은 요청은 기록된 만료 시각에 만료한다(처음부터 다시 재지 않는다)
  await restarted.advance(60_000);
  expect(
    resolvedEvents(h).find((event) => event.approvalId === later.request.approvalId),
  ).toMatchObject({ resolvedBy: "expired" });
});

// ── 무인 승인 정책(M3-REQ-73) ──────────────────────────────────────────

async function startUnattendedBash(h: Harness, id: string) {
  const run = h.run({ interactive: false });
  const done = callTool(h.runtime.tools, run, { id, name: "bash", args: { command: "echo hi" } });
  return { run, done };
}

test("unattended expire (default): the turn waits, records expiresAt, and is denied after the timeout", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({
    clock: time.clock,
    scheduler: time.scheduler,
    unattended: { approval: "expire", timeoutSeconds: 60 },
  });
  const probe = registerWorkspace(h);
  const { done } = await startUnattendedBash(h, "call_u1");
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.expiresAt).toBe(NOW + 60_000);
  await time.advance(60_000);
  const out = await done;
  expect(out.blocked).toContain("[xeon:approval_expired]");
  expect(probe.calls).toEqual([]);
  expect(resolvedEvents(h).map((event) => event.resolvedBy)).toEqual(["expired"]);
});

test("unattended wait: the request has no expiry and stays pending until someone answers", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({
    clock: time.clock,
    scheduler: time.scheduler,
    unattended: { approval: "wait", timeoutSeconds: 60 },
  });
  const probe = registerWorkspace(h);
  const { done } = await startUnattendedBash(h, "call_u2");
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  const [request] = h.runtime.approvals.pending(h.thread);
  expect(request?.expiresAt).toBeUndefined();
  await time.advance(86_400_000);
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  await h.runtime.approvals.respond(request?.approvalId ?? "", { decision: "allow" });
  const out = await done;
  expect(out.blocked).toBeUndefined();
  expect(probe.calls.map((call) => call.method)).toEqual(["run"]);
});

test("unattended deny: the ask is refused at once without a pending request", async () => {
  const h = await createHarness({ unattended: { approval: "deny", timeoutSeconds: 60 } });
  const probe = registerWorkspace(h);
  const { done } = await startUnattendedBash(h, "call_u3");
  const out = await done;
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(probe.calls).toEqual([]);
  expect(h.session.events.some((event) => event.kind === "approval.requested")).toBe(false);
});

test("the policy is read from settings: l1.tools.unattended.approval and timeoutSeconds", async () => {
  const { layer } = await import("./support/harness.ts");
  const time = manualTime(NOW);
  const h = await createHarness({
    clock: time.clock,
    scheduler: time.scheduler,
    unattended: null,
    layers: [
      layer("user", {
        "l1.tools.unattended.approval": "expire",
        "l1.tools.unattended.timeoutSeconds": 120,
      }),
    ],
  });
  registerWorkspace(h);
  const { done } = await startUnattendedBash(h, "call_u4");
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  expect(h.runtime.approvals.pending(h.thread)[0]?.expiresAt).toBe(NOW + 120_000);
  await time.advance(120_000);
  expect((await done).blocked).toContain("approval_expired");
});

test("a subagent call in an unattended run is still refused at once", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({
    clock: time.clock,
    scheduler: time.scheduler,
    unattended: { approval: "wait", timeoutSeconds: 60 },
  });
  registerWorkspace(h);
  const run = h.run({ interactive: false, caller: "subagent:explorer" });
  const out = await callTool(h.runtime.tools, run, {
    id: "call_u5",
    name: "bash",
    args: { command: "echo hi" },
  });
  expect(out.blocked).toContain("noninteractive_ask_denied");
  expect(h.runtime.approvals.pending(h.thread)).toEqual([]);
});

test("the production default (settings unset) expires an unattended ask after 3600 seconds", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler, unattended: null });
  const probe = registerWorkspace(h);
  const { done } = await startUnattendedBash(h, "call_u6");
  await until(() => h.runtime.approvals.pending(h.thread).length > 0);
  expect(h.runtime.approvals.pending(h.thread)[0]?.expiresAt).toBe(NOW + 3_600_000);
  await time.advance(3_599_999);
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  await time.advance(1);
  expect((await done).blocked).toContain("approval_expired");
  expect(probe.calls).toEqual([]);
});

test("without an injected scheduler the runtime still arms an expiry timer (no unattended turn waits forever)", async () => {
  const h = await createHarness({
    clock: { now: () => Date.now() },
    unattended: { approval: "expire", timeoutSeconds: 1 },
  });
  registerWorkspace(h);
  const { done } = await startUnattendedBash(h, "call_u7");
  const out = await done;
  expect(out.blocked).toContain("approval_expired");
});

test("systemScheduler fires a timer once and clearTimeout cancels one", async () => {
  const scheduler = systemScheduler();
  const fired: string[] = [];
  scheduler.setTimeout(() => fired.push("a"), 5);
  const cancelled = scheduler.setTimeout(() => fired.push("b"), 5);
  scheduler.clearTimeout(cancelled);
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 40);
  });
  expect(fired).toEqual(["a"]);
});

test("unattendedPlan: only a main-caller depth-0 turn on its own surface follows the policy, for every turn source", async () => {
  const h = await createHarness();
  const main = {
    caller: "main",
    depth: 0,
    threadId: h.thread,
    surfaceThreadId: h.thread,
  } as const;
  const wait = { approval: "wait", timeoutSeconds: 60 } as const;
  const expire = { approval: "expire", timeoutSeconds: 60 } as const;
  const deny = { approval: "deny", timeoutSeconds: 60 } as const;
  // drive, schedule, extension, delegation, resumed 모두 같은 실행 문맥(main, 깊이 0)을 받는다: 정책은 입력 출처와 무관하다
  expect(unattendedPlan(main, wait, 1000)).toEqual({ silent: false, timeoutAt: null });
  expect(unattendedPlan(main, expire, 1000)).toEqual({ silent: false, timeoutAt: 61_000 });
  expect(unattendedPlan(main, deny, 1000)).toEqual({ silent: true });
  expect(unattendedPlan({ ...main, caller: "subagent:x" }, wait, 1000)).toEqual({ silent: true });
  expect(unattendedPlan({ ...main, depth: 1 }, wait, 1000)).toEqual({ silent: true });
  expect(unattendedPlan({ ...main, surfaceThreadId: h.deps.ids.next("thr") }, wait, 1000)).toEqual({
    silent: true,
  });
});

// ── 커밋 실패와 예외 ───────────────────────────────────────────────────

function flakyService(h: Harness, time: ReturnType<typeof manualTime>) {
  const state = { throwing: false };
  const service = createApprovalService({
    session: {
      commit: (request) => {
        if (state.throwing) throw new Error("store exploded");
        return h.deps.session.commit(request);
      },
      readBranch: (threadId) => h.deps.session.readBranch(threadId),
    },
    producer: h.deps.producer,
    ids: h.deps.ids,
    clock: time.clock,
    scheduler: time.scheduler,
    ext: h.deps.ext,
    logger: undefined,
    callOf: () => undefined,
    modeOf: () => "default",
    setMode: (_thread, mode) => Promise.resolve({ ok: true, mode }),
  });
  return { state, service };
}

test("an expiry commit that throws leaves the request pending and re-arms the timer", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const { state, service } = flakyService(h, time);
  expectOk(await service.open(requestOf(h, { expiresAt: NOW + 1000 })));
  state.throwing = true;
  await time.advance(1000);
  expect(service.pending(h.thread)).toHaveLength(1);
  expect(time.timers()).toBe(1);
  state.throwing = false;
  await time.advance(5000);
  expect(service.pending(h.thread)).toEqual([]);
  expect(resolvedEvents(h).map((event) => event.resolvedBy)).toEqual(["expired"]);
});

test("a respond whose commit throws leaves the request pending, and a retry works", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const { state, service } = flakyService(h, time);
  const opened = expectOk(await service.open(requestOf(h, {})));
  const id = opened.request.approvalId;
  const answer = { decision: "answer", answer: { color: { selected: ["red"] } } } as const;
  state.throwing = true;
  let thrown = false;
  try {
    await service.respond(id, answer);
  } catch (error) {
    thrown = error instanceof Error && error.message === "store exploded";
  }
  expect(thrown).toBe(true);
  expect(service.pending(h.thread)).toHaveLength(1);
  state.throwing = false;
  expect(await service.respond(id, answer)).toEqual({ applied: true });
});

test("after a failed expiry commit a late response is refused and the expiry is retried", async () => {
  const time = manualTime(NOW);
  const h = await createHarness({ clock: time.clock, scheduler: time.scheduler });
  const opened = expectOk(await h.runtime.approvals.open(requestOf(h, { expiresAt: NOW + 1000 })));
  h.session.setFault(() => ({ kind: "disk_full" }));
  await time.advance(1000);
  expect(h.runtime.approvals.pending(h.thread)).toHaveLength(1);
  const late = await h.runtime.approvals.respond(opened.request.approvalId, {
    decision: "answer",
    answer: { color: { selected: ["red"] } },
  });
  expect(late).toEqual({ applied: false, reason: "already_resolved" });
  h.session.setFault(undefined);
  await time.advance(5000);
  expect(resolvedEvents(h).map((event) => event.resolvedBy)).toEqual(["expired"]);
});
