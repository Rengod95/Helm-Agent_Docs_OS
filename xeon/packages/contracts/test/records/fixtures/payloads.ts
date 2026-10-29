import type { CoreEventKind } from "../../../src/records/index.ts";
import { rawId } from "../../helpers/ids.ts";
import { assistantStop, usage } from "../../conversation/fixtures/pi-messages.ts";

export const THREAD: string = rawId("thr", 1);
export const TURN: string = rawId("trn", 1);
const STEP: string = rawId("stp", 1);
export const ITEM: string = rawId("itm", 1);
const PART: string = rawId("prt", 1);
export const EVENT: string = rawId("evt", 1);
export const EVENT2: string = rawId("evt", 2);
export const EFFECT: string = rawId("efx", 1);
const CHECKPOINT: string = rawId("ckp", 1);
export const SHA: string = "a".repeat(64);

export const partRecord: Readonly<Record<string, unknown>> = {
  partId: PART,
  itemId: ITEM,
  contentIndex: 0,
  kind: "text",
  toolCallId: null,
};

export const checkpoint: Readonly<Record<string, unknown>> = {
  checkpointId: CHECKPOINT,
  schemaVersion: 1,
  threadId: THREAD,
  turnId: TURN,
  stepId: STEP,
  stepIndex: 0,
  leafEventId: EVENT,
  next: "tools",
  pendingToolCalls: [{ toolCallId: "call_1", effectId: EFFECT, waiting: null }],
  inputCursor: { consumedSeq: 3 },
  model: { provider: "anthropic", modelId: "claude-x", thinkingLevel: "medium" },
  leaseRefs: [],
  scopeRef: null,
};

export const effectIntent: Readonly<Record<string, unknown>> = {
  effectId: EFFECT,
  toolCallId: "call_1",
  toolName: "read",
  itemId: ITEM,
  argsHash: SHA,
  args: { path: "a.txt" },
  replay: "safe",
  idempotencyKey: null,
};

export const effectExec: Readonly<Record<string, unknown>> = {
  effectId: EFFECT,
  startedAt: 1_700_000_000_000,
};

export const effectResult: Readonly<Record<string, unknown>> = {
  effectId: EFFECT,
  status: "ok",
  resultItemId: ITEM,
  output: { structuredContent: { ok: true }, terminate: false },
  blobRef: null,
  durationMs: 12,
  synthesized: false,
};

/** 코어 카탈로그 43종 각각의 대표 payload. 카탈로그에 kind가 늘면 이 표가 컴파일 오류로 알린다. */
export const PAYLOAD_FIXTURES: Readonly<Record<CoreEventKind, Readonly<Record<string, unknown>>>> =
  {
    "thread.started": { title: "t", forkedFrom: null },
    "thread.updated": { title: "new", status: "running" },
    "thread.closed": { reason: null },
    "thread.leaf_moved": { leafEventId: EVENT, reason: "branch" },
    "thread.compacted": {
      summary: "s",
      firstKeptEventId: EVENT,
      tokensBefore: 1000,
      details: null,
      usage,
      fromExtension: null,
    },
    "thread.branch_summarized": {
      fromEventId: EVENT,
      summary: "s",
      details: { a: 1 },
      usage: null,
    },
    "thread.resumed": { turnId: TURN, attempt: 1, mode: "manual", fromCheckpointId: CHECKPOINT },
    "turn.started": { inputItemIds: [ITEM], requestId: "r1", scopeId: null },
    "turn.updated": { status: "waiting" },
    "turn.completed": { status: "completed", stepCount: 2, usage, error: null },
    "turn.abort_requested": {
      reason: { code: "user", message: null },
      cause: "direct",
      background: false,
    },
    "step.started": { stepIndex: 0 },
    "step.updated": { status: "tools" },
    "step.completed": {
      stepIndex: 0,
      status: "completed",
      stopReason: "stop",
      assistantItemId: ITEM,
      toolResultItemIds: [],
    },
    "item.started": { itemId: ITEM, kind: "assistant", toolCallId: null, toolName: null },
    "item.updated": {
      itemId: ITEM,
      update: {
        kind: "part_delta",
        delta: {
          partId: PART,
          itemId: ITEM,
          contentIndex: 0,
          kind: "text",
          phase: "delta",
          delta: "x",
        },
      },
    },
    "item.recorded": {
      item: {
        itemId: ITEM,
        status: "completed",
        kind: "assistant",
        message: assistantStop,
        partIds: [PART, PART],
      },
    },
    "part.recorded": { part: partRecord },
    "effect.intent": effectIntent,
    "effect.exec": effectExec,
    "effect.result": effectResult,
    "checkpoint.step": checkpoint,
    "scope.changed": { scopeId: "helm", status: "enabled", reason: "request" },
    "scope.handler_failed": {
      owner: "ext:helm",
      point: "tool.call.before",
      result: "threw",
      message: "boom",
      consecutive: 1,
    },
    "lease.acquired": { leaseId: "lease-1", scopeId: "helm", limits: { maxTurns: 4 } },
    "lease.released": { leaseId: "lease-1", scopeId: "helm", reason: "budget" },
    "lease.rejected": { groupId: "helm", reason: "wait_limit", requestSeq: 3 },
    "post.accepted": {
      requestId: "post-1",
      scopeId: "helm",
      when: "next",
      inputId: EVENT2,
      itemId: null,
    },
    "settings.changed": { key: "l1.loop.maxSteps", scope: "session", value: 10 },
    "approval.requested": {
      origin: {
        threadId: THREAD,
        turnId: TURN,
        stepId: STEP,
        toolCallId: "call_1",
        caller: "main",
      },
      requestKey: "req-1",
      title: "Run bash",
      body: {
        kind: "tool",
        tool: {
          toolName: "bash",
          risk: "write",
          args: { command: "ls" },
          argsHash: SHA,
          ruleId: null,
        },
      },
      remember: ["once", "thread"],
      surfaceThreadId: THREAD,
      requestedAt: 1_700_000_000_000,
    },
    "approval.resolved": {
      approvalId: EVENT,
      decision: "allow",
      answer: null,
      remember: "once",
      requestedRemember: null,
      resolvedBy: "user",
    },
    "input.queued": {
      mode: "next",
      item: { kind: "user", content: "hi" },
      requestId: "in-1",
      source: { type: "user", via: "interactive" },
    },
    "input.placed": { inputId: EVENT, itemId: ITEM },
    "input.withdrawn": { inputId: EVENT, reason: "user" },
    "agent.spawned": {
      childThreadId: rawId("thr", 2),
      agent: "explore",
      requestId: "spawn-1",
      owner: { kind: "tool", turnId: TURN, toolCallId: "call_1" },
      caller: "subagent:explore",
      depth: 1,
      background: false,
      fork: null,
      modelRole: "worker",
    },
    "agent.settled": {
      childThreadId: rawId("thr", 2),
      requestId: "spawn-1",
      status: "completed",
      report: { text: "done", truncated: false, flags: [], originalChars: 4 },
      answerItemId: ITEM,
      usage,
      error: null,
    },
    "agent.judged": {
      goalRef: "goal-1",
      run: 1,
      verdict: "met",
      rationale: "ok",
      missing: [],
      usage: null,
      model: { provider: "anthropic", modelId: "claude-x" },
    },
    "secret.used": {
      handle: "secret://github-token",
      mode: "env",
      toolCallId: "call_1",
      host: null,
      commandHash: "0123456789abcdef",
      leaseId: "lease-1",
      at: 1_700_000_000_000,
    },
    "secret.denied": {
      handle: "secret://github-token",
      mode: "env",
      reason: "command_mismatch",
      purpose: "gh api user",
      toolCallId: null,
      at: 1_700_000_000_000,
    },
    "secret.approved": {
      handle: "secret://github-token",
      scope: "per-use",
      approvalId: EVENT,
      expiresAt: null,
      at: 1_700_000_000_000,
    },
    "secret.masked": {
      hits: [{ kind: "known:github-token", count: 2 }],
      layer: "tool-result",
      at: 1_700_000_000_000,
    },
    "tool.sandbox_bypassed": {
      toolCallId: "call_1",
      toolName: "bash",
      reason: "run_unsandboxed",
      at: 1_700_000_000_000,
    },
    "tool.untrusted_read": {
      turnId: TURN,
      toolCallId: "call_1",
      toolName: "web_fetch",
      at: 1_700_000_000_000,
    },
  };
