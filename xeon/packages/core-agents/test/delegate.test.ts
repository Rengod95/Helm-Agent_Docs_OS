import { describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  AgentSettledEventPayloadSchema,
  type AgentSettledEventPayload,
} from "@xeon/contracts/records";
import type {
  ChildTurnRequest,
  DelegateRequest,
  ReportDelivery,
  SpawnOrigin,
} from "@xeon/contracts/services";
import { spawnRecorder, type FakeChildTurn } from "../src/testing/index.ts";
import { EXPLORER, openHarness, type Harness } from "./support/harness.ts";

const REPORT: ReportDelivery = {
  customType: "grp.learning.review.report",
  display: false,
  when: "next",
};

function scopeOrigin(h: Harness, scopeId: string, ownerRequestId: string): SpawnOrigin {
  return {
    parentThreadId: h.parentThreadId,
    owner: { kind: "scope", scopeId },
    caller: "main",
    depth: 0,
    ownerRequestId,
    signal: new AbortController().signal,
  };
}

function request(requestId: string, extra: Partial<DelegateRequest> = {}): DelegateRequest {
  return { agent: "explorer", task: "review", requestId, report: REPORT, ...extra };
}

function eventsOf(h: Harness, kind: string, thread: ThreadId = h.parentThreadId) {
  return h.session.events.filter((event) => event.kind === kind && event.threadId === thread);
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

/** 취소될 때까지 도는 자식 turn */
function abortableRun(): {
  readonly started: () => number;
  readonly run: (req: ChildTurnRequest) => Promise<FakeChildTurn>;
} {
  let started = 0;
  return {
    started: () => started,
    run: (req) =>
      new Promise((resolve) => {
        started += 1;
        req.signal.addEventListener("abort", () => resolve({ status: "aborted" }), { once: true });
      }),
  };
}

function settledPayloads(h: Harness): AgentSettledEventPayload[] {
  return eventsOf(h, "agent.settled").flatMap((event) => {
    const parsed = parse(AgentSettledEventPayloadSchema, event.payload);
    return parsed.ok ? [parsed.value] : [];
  });
}

describe("delegate", () => {
  test("a background delegate returns at once, runs the child and settles with owner and report input", async () => {
    const release = Promise.withResolvers<void>();
    const h = openHarness({
      run: async (req, session) => {
        await release.promise;
        return {
          status: "completed",
          finalItemId: session.seedAssistantItem(req.threadId, "done"),
        };
      },
    });
    const recorder = spawnRecorder(h.session);
    const origin = scopeOrigin(h, "learning", "scope:learning:1");
    const accepted = await h.service.delegate(request("rev-1"), origin);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.receipt).toMatchObject({ requestId: "rev-1", status: "accepted" });
    // 접수 시점: 아직 정착하지 않았고, 백그라운드로 연결을 남겼다
    expect(eventsOf(h, "agent.settled")).toHaveLength(0);
    expect(eventsOf(h, "agent.spawned")[0]?.payload).toMatchObject({
      background: true,
      requestId: "rev-1",
    });
    const state = h.service.status(h.parentThreadId, "rev-1")?.state;
    expect(state === "queued" || state === "running").toBe(true);
    release.resolve();
    await recorder.settleAll(h.parentThreadId, ["rev-1"]);
    const settled = eventsOf(h, "agent.settled")[0];
    expect(settled?.payload).toMatchObject({
      childThreadId: accepted.receipt.childThreadId,
      status: "completed",
      owner: { kind: "scope", scopeId: "learning" },
      limitHit: null,
    });
    // 보고 입력은 같은 커밋(같은 seq 구간)에 들어간다
    const queued = eventsOf(h, "input.queued");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload).toMatchObject({
      mode: "next",
      requestId: "rev-1:report",
      source: { type: "delegation", childThreadId: accepted.receipt.childThreadId },
      item: { kind: "context", customType: "grp.learning.review.report", display: false },
    });
    expect((queued[0]?.seq ?? 0) - (settled?.seq ?? 0)).toBe(1);
    recorder.dispose();
  });

  test("without a report delivery only agent.settled is written", async () => {
    const h = openHarness();
    const recorder = spawnRecorder(h.session);
    const sent = await h.service.delegate(
      { agent: "explorer", task: "t", requestId: "no-report" },
      scopeOrigin(h, "g", "scope:g:1"),
    );
    expect(sent.ok).toBe(true);
    await recorder.settleAll(h.parentThreadId, ["no-report"]);
    expect(eventsOf(h, "input.queued")).toHaveLength(0);
    expect(eventsOf(h, "agent.settled")).toHaveLength(1);
    recorder.dispose();
  });

  test("the parent turn's abort does not cross the background boundary", async () => {
    const release = Promise.withResolvers<void>();
    const h = openHarness({
      run: async (req, session) => {
        await release.promise;
        return { status: "completed", finalItemId: session.seedAssistantItem(req.threadId, "ok") };
      },
    });
    const recorder = spawnRecorder(h.session);
    const { origin, controller, tool } = h.openToolCall("tc-bg");
    const sent = await h.service.delegate(request("bg-1"), origin);
    expect(sent.ok).toBe(true);
    controller.abort();
    await h.tasks.abort(tool, { code: "user", message: null });
    release.resolve();
    await recorder.settleAll(h.parentThreadId, ["bg-1"]);
    expect(eventsOf(h, "agent.settled")[0]?.payload).toMatchObject({ status: "completed" });
    recorder.dispose();
  });

  test("replaying a delegate call produces one child, before and after it settles", async () => {
    const release = Promise.withResolvers<void>();
    const h = openHarness({
      run: async (req, session) => {
        await release.promise;
        return { status: "completed", finalItemId: session.seedAssistantItem(req.threadId, "x") };
      },
    });
    const recorder = spawnRecorder(h.session);
    const origin = scopeOrigin(h, "learning", "scope:learning:1");
    const first = await h.service.delegate(request("once"), origin);
    const during = await h.service.delegate(request("once"), origin);
    release.resolve();
    await recorder.settleAll(h.parentThreadId, ["once"]);
    const after = await h.service.delegate(request("once"), origin);
    expect(first.ok && during.ok && after.ok).toBe(true);
    if (!(first.ok && during.ok && after.ok)) return;
    expect(during.receipt).toMatchObject({
      status: "duplicate",
      childThreadId: first.receipt.childThreadId,
    });
    expect(after.receipt).toMatchObject({
      status: "duplicate",
      childThreadId: first.receipt.childThreadId,
    });
    expect(h.loop.calls).toHaveLength(1);
    expect(eventsOf(h, "agent.spawned")).toHaveLength(1);
    expect(eventsOf(h, "agent.settled")).toHaveLength(1);
    expect(eventsOf(h, "input.queued")).toHaveLength(1);
    // 부모 하나와 자식 하나뿐이다
    expect(h.session.created).toHaveLength(2);
    recorder.dispose();
  });

  test("a delegate whose child was cut off by a restart resumes the same child", async () => {
    const first = openHarness({ run: () => new Promise(() => {}) });
    const origin = scopeOrigin(first, "learning", "scope:learning:1");
    const sent = await first.service.delegate(request("cut"), origin);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    // 같은 세션을 이어 쓰는 새 프로세스. 진행 중이던 자식은 이 프로세스에 없다
    const second = openHarness({ session: first.session });
    // 재개한 프로세스가 부모 대화를 열어 둔 상태
    second.tasks.openScope(second.tasks.root, { kind: "thread", id: first.parentThreadId });
    const recorder = spawnRecorder(second.session);
    const replayed = await second.service.delegate(request("cut"), {
      ...scopeOrigin(second, "learning", "scope:learning:1"),
      parentThreadId: first.parentThreadId,
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.receipt).toMatchObject({
      status: "duplicate",
      childThreadId: sent.receipt.childThreadId,
    });
    await recorder.settleAll(first.parentThreadId, ["cut"]);
    expect(eventsOf(first, "agent.spawned")).toHaveLength(1);
    expect(second.loop.calls.map((call) => call.threadId)).toEqual([sent.receipt.childThreadId]);
    recorder.dispose();
  });

  test("requestId must be 1 to 48 characters", async () => {
    const h = openHarness();
    const origin = scopeOrigin(h, "g", "scope:g:1");
    const refused = await Promise.all(
      ["", "x".repeat(49)].map((requestId) => h.service.delegate(request(requestId), origin)),
    );
    for (const result of refused) {
      expect(result).toMatchObject({ ok: false, error: { kind: "agents.invalid_request" } });
    }
    expect(h.session.created).toEqual([h.parentThreadId]);
  });
});

describe("cancel", () => {
  test("cancel by ownerScopeId stops that scope's children and leaves the others", async () => {
    const control = abortableRun();
    const h = openHarness({ maxConcurrent: 8, run: control.run });
    const recorder = spawnRecorder(h.session);
    const sent = await Promise.all(
      (
        [
          ["a-1", "learning"],
          ["a-2", "learning"],
          ["b-1", "helm"],
        ] as const
      ).map(([id, scope]) =>
        h.service.delegate(request(id), scopeOrigin(h, scope, `scope:${scope}:${id}`)),
      ),
    );
    expect(sent.every((result) => result.ok)).toBe(true);
    await waitUntil(() => control.started() === 3);
    expect(await h.service.cancel({ ownerScopeId: "learning" }, "group off")).toEqual({
      cancelled: true,
    });
    await recorder.settleAll(h.parentThreadId, ["a-1", "a-2"]);
    const statuses = (id: string): AgentSettledEventPayload | undefined =>
      settledPayloads(h).find((payload) => payload.requestId === id);
    expect(statuses("a-1")).toMatchObject({ status: "aborted", owner: { scopeId: "learning" } });
    expect(statuses("a-2")).toMatchObject({ status: "aborted" });
    expect(statuses("b-1")).toBeUndefined();
    expect(h.service.status(h.parentThreadId, "b-1")).toMatchObject({ state: "running" });
    // 취소된 자식도 보고 입력을 남긴다
    expect(eventsOf(h, "input.queued")).toHaveLength(2);
    expect(await h.service.cancel({ ownerScopeId: "learning" }, "again")).toEqual({
      cancelled: false,
    });
    await h.service.cancel({ ownerScopeId: "helm" }, "cleanup");
    recorder.dispose();
  });

  test("cancel by child id and by (parent, requestId) stops a background child", async () => {
    const control = abortableRun();
    const h = openHarness({ run: control.run });
    const recorder = spawnRecorder(h.session);
    const one = await h.service.delegate(request("c-1"), scopeOrigin(h, "g", "scope:g:1"));
    const two = await h.service.delegate(request("c-2"), scopeOrigin(h, "g", "scope:g:2"));
    if (!(one.ok && two.ok)) throw new Error("delegate failed");
    await waitUntil(() => control.started() === 2);
    expect(await h.service.cancel({ childThreadId: one.receipt.childThreadId }, "stop")).toEqual({
      cancelled: true,
    });
    expect(
      await h.service.cancel({ parentThreadId: h.parentThreadId, requestId: "c-2" }, "stop"),
    ).toEqual({ cancelled: true });
    await recorder.settleAll(h.parentThreadId, ["c-1", "c-2"]);
    expect(settledPayloads(h).map((payload) => payload.status)).toEqual(["aborted", "aborted"]);
    recorder.dispose();
  });
});

describe("limits and tool policy", () => {
  test("a child that hit its step limit settles with limitHit steps", async () => {
    const h = openHarness({
      run: (req, session) => {
        const producer = session.producer("core.loop");
        session.commit({
          threadId: req.threadId,
          requestId: "turn-end",
          fingerprintSource: {},
          build: () => ({
            kind: "append",
            drafts: [
              producer.draft({
                id: h.ids.next("evt"),
                kind: "turn.completed",
                threadId: req.threadId,
                turnId: null,
                stepId: null,
                causationId: null,
                correlationId: null,
                payload: { status: "interrupted", stepCount: 2, usage: null, error: "child_limit" },
              }),
            ],
            checkpoint: null,
          }),
        });
        return Promise.resolve({
          status: "aborted",
          finalItemId: session.seedAssistantItem(req.threadId, "partial"),
        });
      },
    });
    const recorder = spawnRecorder(h.session);
    const sent = await h.service.delegate(
      request("lim", { limits: { maxSteps: 2 } }),
      scopeOrigin(h, "g", "scope:g:1"),
    );
    expect(sent.ok).toBe(true);
    await recorder.settleAll(h.parentThreadId, ["lim"]);
    expect(eventsOf(h, "agent.settled")[0]?.payload).toMatchObject({ limitHit: "steps" });
    recorder.dispose();
  });

  test("tools.deny and denyHint reach the child's turn request", async () => {
    const h = openHarness({ definitions: [{ ...EXPLORER, tools: ["read", "bash"] }] });
    const { origin } = h.openToolCall("tc-deny");
    const result = await h.service.spawn(
      { agent: "explorer", task: "t", tools: { deny: ["bash", "web.*"], denyHint: "read only" } },
      origin,
    );
    expect(result.status).toBe("completed");
    expect(h.loop.calls[0]?.tools).toMatchObject({
      deny: ["bash", "web.*"],
      denyHint: "read only",
    });
  });

  test("without deny the request carries neither deny nor denyHint", async () => {
    const h = openHarness();
    const { origin } = h.openToolCall("tc-plain");
    await h.service.spawn({ agent: "explorer", task: "t" }, origin);
    expect(h.loop.calls[0]?.tools).not.toHaveProperty("deny");
    expect(h.loop.calls[0]?.tools).not.toHaveProperty("denyHint");
  });
});
