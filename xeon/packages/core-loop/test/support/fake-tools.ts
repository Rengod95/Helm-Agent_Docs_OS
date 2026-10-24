import { Bug, canonicalJson, ok, parse, type Clock, type Result } from "@xeon/contracts";
import type {
  AgentToolCall,
  AgentToolResult,
  EffectId,
  IdFactory,
  ThreadId,
  JsonValue,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
  StepCheckpointSchema,
  type EffectIntent,
  type ReadFailure,
  type SessionService,
  type StepCheckpointInput,
} from "@xeon/contracts/records";
import type {
  AdvertiseInput,
  AdvertisedToolset,
  ApprovalRequest,
  CallPreparation,
  RejectReason,
  ToolCallOutcome,
  ToolCallState,
  ToolMeta,
  ToolRunContext,
  ToolService,
} from "@xeon/contracts/services";
import { Type } from "typebox";

// 테스트 대역: core-tools의 파이프라인 중 루프와 접하는 부분만 흉내 낸다.
// prepare → effect.intent, execute → effect.exec + effect.result + toolResult item(한 커밋), 효과 없이 닫는 호출 → toolResult item 하나.

interface FakeToolOutput {
  readonly text: string;
  readonly terminate?: boolean;
  /** 효과 결과의 structuredContent(예: tool_search의 activated) */
  readonly structuredContent?: JsonValue;
}

export interface FakeToolDef {
  readonly name: string;
  /** 실행. 기본은 "ok"를 돌려준다 */
  readonly run?: (
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
  ) => Promise<FakeToolOutput>;
  readonly replay?: "safe" | "never";
  /** "sequential"이면 한 배치가 순서대로 준비·실행된다 */
  readonly executionMode?: "sequential" | "parallel";
  /** 있으면 prepare가 이 사유로 막는다(의도 커밋 없음, 결과 item만 기록) */
  readonly blockReason?: string;
  /**
   * 참이면 prepare가 승인을 올리고 응답이 올 때까지 기다린다(core-tools 도구 승인 흉내).
   * 요청은 approval.requested + 대기 체크포인트(next: await_input) 한 커밋이다. 이미 미해결 요청이 기록되어 있으면(재개) 새로 올리지 않는다
   */
  readonly requiresApproval?: boolean;
}

export interface FakeTools {
  readonly service: ToolService;
  /** `prepare`가 받은 실행 맥락 */
  readonly runs: readonly ToolRunContext[];
  readonly executed: readonly string[];
  /** `advertise`가 받은 활성화 집합(호출 순서대로) */
  readonly advertisedActivated: readonly (readonly string[])[];
  /** `advertise`가 받은 입력 전체(호출 순서대로) */
  readonly advertiseInputs: readonly AdvertiseInput[];
  /** `settleRejected`가 닫은 호출 id */
  readonly closed: readonly string[];
  readonly reran: readonly string[];
  /** 한 호출이 실행되면 불린다(시작 직후, 결과 커밋 전). 크래시 시험에서 쓴다 */
  onExecute: ((toolCallId: string) => void) | null;
  /** 승인 응답을 기다리는 호출 id */
  readonly waitingApproval: readonly string[];
  /** 기록에서 읽은 미해결 승인 요청(ApprovalService.restore 대역이 돌려준다) */
  pendingApprovals(threadId: ThreadId): Promise<ApprovalRequest[]>;
  /** 승인 응답을 기록한다(approval.resolved 커밋) 그리고 기다리던 prepare를 깨운다. 요청이 없으면 false */
  respondApproval(toolCallId: string): Promise<boolean>;
}

function notImplemented(name: string): never {
  throw new Bug(`fake-tools: ${name} is not implemented`);
}

function outcomeOf(
  call: AgentToolCall,
  state: ToolCallState,
  message: ToolResultMessage,
  itemId: ToolCallOutcome["itemId"],
  terminate: boolean,
  structuredContent: JsonValue | null = null,
): ToolCallOutcome {
  const result: AgentToolResult = {
    content: [...message.content],
    details: {},
    isError: message.isError,
    ...(terminate ? { terminate: true } : {}),
    ...(structuredContent === null ? {} : { structuredContent }),
  };
  return { toolCall: call, state, result, isError: message.isError, message, itemId };
}

function checkpointInputOf(draft: unknown): StepCheckpointInput {
  const payload: unknown =
    typeof draft === "object" && draft !== null && "payload" in draft ? draft.payload : undefined;
  const parsed = parse(StepCheckpointSchema, payload);
  if (!parsed.ok) throw new Bug("fake-tools: the waiting checkpoint is not a StepCheckpoint");
  const {
    checkpointId: _a,
    schemaVersion: _b,
    threadId: _c,
    leafEventId: _d,
    ...input
  } = parsed.value;
  return input;
}

export function createFakeTools(options: {
  readonly session: SessionService;
  readonly ids: IdFactory;
  readonly clock: Clock;
  readonly tools: readonly FakeToolDef[];
}): FakeTools {
  const { session, ids, clock } = options;
  const producer = session.producer("core.tools");
  const defs = new Map(options.tools.map((def) => [def.name, def]));
  const executed: string[] = [];
  const closed: string[] = [];
  const reran: string[] = [];
  const runs: ToolRunContext[] = [];
  const advertisedActivated: string[][] = [];
  const advertiseInputs: AdvertiseInput[] = [];
  const intents = new Map<string, EffectId>();
  const hooks: { onExecute: ((toolCallId: string) => void) | null } = { onExecute: null };

  function commitDrafts(
    run: ToolRunContext,
    requestId: string,
    drafts: readonly {
      kind: "effect.intent" | "effect.exec" | "effect.result" | "item.recorded";
      payload: unknown;
    }[],
  ): void {
    const stamped = drafts.map((draft) =>
      producer.draft({
        id: ids.next("evt"),
        kind: draft.kind,
        threadId: run.threadId,
        turnId: run.turnId,
        stepId: run.stepId,
        causationId: null,
        correlationId: null,
        payload: draft.payload,
      }),
    );
    const result = session.commit({
      threadId: run.threadId,
      requestId,
      fingerprintSource: { requestId },
      build: () => ({ kind: "append", drafts: stamped, checkpoint: null }),
    });
    if (!result.ok) throw new Bug(`fake-tools: commit failed ${result.error.kind}`);
  }

  function textMessage(
    toolCallId: string,
    toolName: string,
    text: string,
    isError: boolean,
  ): ToolResultMessage {
    return {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError,
      timestamp: clock.now(),
    };
  }

  /** 효과 없이 닫는 호출: toolResult item 하나만 기록한다 */
  function itemOnly(
    run: ToolRunContext,
    call: AgentToolCall,
    state: ToolCallState,
    text: string,
    terminate: boolean = false,
  ): ToolCallOutcome {
    const itemId = ids.next("itm");
    const message = textMessage(call.id, call.name, text, true);
    const item = run.drafts.toolResultItem({ itemId, message, effectId: null });
    commitDrafts(run, `tool:${call.id}:result`, [
      { kind: "item.recorded", payload: item.draft.payload },
    ]);
    return outcomeOf(call, state, message, itemId, terminate);
  }

  function resultCommit(
    run: ToolRunContext,
    call: AgentToolCall,
    state: ToolCallState,
    text: string,
    isError: boolean,
    synthesized: boolean,
    terminate: boolean = false,
    structuredContent: JsonValue | null = null,
  ): ToolCallOutcome {
    const itemId = ids.next("itm");
    const effectId = intents.get(call.id) ?? ids.next("efx");
    const message = textMessage(call.id, call.name, text, isError);
    const item = run.drafts.toolResultItem({ itemId, message, effectId });
    commitDrafts(run, `tool:${call.id}:result`, [
      {
        kind: "effect.result",
        payload: {
          effectId,
          status: isError ? "error" : "ok",
          resultItemId: itemId,
          output: { structuredContent, terminate },
          blobRef: null,
          durationMs: 0,
          synthesized,
        },
      },
      { kind: "item.recorded", payload: item.draft.payload },
    ]);
    return outcomeOf(call, state, message, itemId, terminate, structuredContent);
  }

  // ── 승인 대기 흉내 ──────────────────────────────────────────────────
  const gates = new Map<string, PromiseWithResolvers<void>>();

  interface StoredApproval {
    readonly approvalId: string;
    readonly resolved: boolean;
  }

  /** 기록에서 이 호출의 승인 요청을 찾는다 */
  async function storedApproval(
    threadId: ThreadId,
    toolCallId: string,
  ): Promise<StoredApproval | undefined> {
    let found: { approvalId: string; resolved: boolean } | undefined;
    const resolvedIds = new Set<string>();
    for await (const read of session.readBranch(threadId)) {
      if (!read.ok) throw new Bug(`fake-tools: read failed ${read.error.kind}`);
      const event = read.value;
      if (event.kind === "approval.requested") {
        const requested = parse(ApprovalRequestedPayloadSchema, event.payload);
        if (requested.ok && requested.value.origin.toolCallId === toolCallId) {
          found = { approvalId: event.id, resolved: false };
        }
      } else if (event.kind === "approval.resolved") {
        const resolved = parse(ApprovalResolvedPayloadSchema, event.payload);
        if (resolved.ok) resolvedIds.add(resolved.value.approvalId);
      }
    }
    return found === undefined
      ? undefined
      : { approvalId: found.approvalId, resolved: resolvedIds.has(found.approvalId) };
  }

  async function awaitApproval(call: AgentToolCall, run: ToolRunContext): Promise<void> {
    const stored = await storedApproval(run.threadId, call.id);
    if (stored?.resolved === true) return;
    if (stored === undefined) {
      const requested = producer.draft({
        id: ids.next("evt"),
        kind: "approval.requested",
        threadId: run.threadId,
        turnId: run.turnId,
        stepId: run.stepId,
        causationId: null,
        correlationId: null,
        payload: {
          origin: {
            threadId: run.threadId,
            turnId: run.turnId,
            stepId: run.stepId,
            toolCallId: call.id,
            caller: "main",
          },
          requestKey: call.id,
          title: `Allow tool "${call.name}"?`,
          body: {
            kind: "tool",
            tool: {
              toolName: call.name,
              risk: "exec",
              args: {},
              argsHash: "0".repeat(64),
              ruleId: null,
            },
          },
          remember: ["once"],
          surfaceThreadId: run.threadId,
          requestedAt: clock.now(),
        },
      });
      const checkpoint = checkpointInputOf(
        run.drafts.waitingCheckpoint([
          { toolCallId: call.id, effectId: null, waiting: "approval" },
        ]),
      );
      const committed = session.commit({
        threadId: run.threadId,
        requestId: `approval:${call.id}:request`,
        fingerprintSource: { call: call.id },
        build: () => ({ kind: "append", drafts: [requested], checkpoint }),
      });
      if (!committed.ok)
        throw new Bug(`fake-tools: approval commit failed ${committed.error.kind}`);
    }
    const gate = gates.get(call.id) ?? Promise.withResolvers<void>();
    gates.set(call.id, gate);
    await gate.promise;
  }

  async function pendingApprovals(threadId: ThreadId): Promise<ApprovalRequest[]> {
    const requests = new Map<string, ApprovalRequest>();
    for await (const read of session.readBranch(threadId)) {
      if (!read.ok) throw new Bug(`fake-tools: read failed ${read.error.kind}`);
      const event = read.value;
      if (event.kind === "approval.requested") {
        const requested = parse(ApprovalRequestedPayloadSchema, event.payload);
        if (!requested.ok) continue;
        const { origin } = requested.value;
        requests.set(event.id, {
          approvalId: event.id,
          origin: {
            threadId: origin.threadId,
            turnId: origin.turnId,
            stepId: origin.stepId,
            toolCallId: origin.toolCallId,
            caller: "main",
          },
          requestKey: requested.value.requestKey,
          title: requested.value.title,
          body: {
            kind: "tool",
            tool: {
              toolName: "fake",
              risk: "exec",
              args: {},
              argsHash: "0".repeat(64),
              ruleId: null,
            },
          },
          remember: ["once"],
          surfaceThreadId: requested.value.surfaceThreadId,
          requestedAt: requested.value.requestedAt,
        });
      } else if (event.kind === "approval.resolved") {
        const resolved = parse(ApprovalResolvedPayloadSchema, event.payload);
        if (resolved.ok) requests.delete(resolved.value.approvalId);
      }
    }
    return [...requests.values()];
  }

  async function respondApproval(toolCallId: string): Promise<boolean> {
    const run = runs.at(-1);
    if (run === undefined) return false;
    const threadId = run.threadId;
    const stored = await storedApproval(threadId, toolCallId);
    if (stored === undefined || stored.resolved) return false;
    const resolved = producer.draft({
      id: ids.next("evt"),
      kind: "approval.resolved",
      threadId,
      turnId: run.turnId,
      stepId: run.stepId,
      causationId: null,
      correlationId: null,
      payload: {
        approvalId: stored.approvalId,
        decision: "allow",
        answer: null,
        remember: "once",
        requestedRemember: null,
        resolvedBy: "user",
      },
    });
    const committed = session.commit({
      threadId,
      requestId: `approval:${stored.approvalId}:resolve`,
      fingerprintSource: { approval: stored.approvalId },
      build: () => ({ kind: "append", drafts: [resolved], checkpoint: null }),
    });
    if (!committed.ok) throw new Bug(`fake-tools: resolve commit failed ${committed.error.kind}`);
    gates.get(toolCallId)?.resolve();
    gates.delete(toolCallId);
    return true;
  }

  const toolsetOf = (): AdvertisedToolset => ({
    tools: [...defs.values()].map((def) => ({
      capability: "core.fake",
      name: def.name,
      wire: {
        name: def.name,
        description: `fake tool ${def.name}`,
        parameters: Type.Object({}),
      },
    })),
    deferred: [],
    removed: [],
    fingerprint: "sha256:fake",
  });

  async function prepare(call: AgentToolCall, run: ToolRunContext): Promise<CallPreparation> {
    runs.push(run);
    const def = defs.get(call.name);
    if (def === undefined) {
      return {
        kind: "settled",
        outcome: itemOnly(run, call, "rejected", `Tool ${call.name} is not available.`),
      };
    }
    if (def.blockReason !== undefined) {
      return { kind: "settled", outcome: itemOnly(run, call, "rejected", def.blockReason) };
    }
    if (def.requiresApproval === true) await awaitApproval(call, run);
    const effectId = ids.next("efx");
    intents.set(call.id, effectId);
    const args = call.arguments;
    const intent: EffectIntent = {
      effectId,
      toolCallId: call.id,
      toolName: call.name,
      itemId: ids.next("itm"),
      argsHash: "0".repeat(64),
      args,
      replay: def.replay === "safe" ? "safe" : "unsafe",
      idempotencyKey: null,
    };
    commitDrafts(run, `tool:${call.id}:intent`, [
      {
        kind: "effect.intent",
        payload: {
          ...intent,
          argsHash: canonicalJson(args).length.toString(16).padStart(64, "0"),
        },
      },
    ]);
    return { kind: "ready", call: { toolCall: call, args } };
  }

  async function execute(
    call: AgentToolCall,
    args: Readonly<Record<string, unknown>>,
    run: ToolRunContext,
  ): Promise<ToolCallOutcome> {
    const def = defs.get(call.name);
    executed.push(call.id);
    hooks.onExecute?.(call.id);
    const effectId = intents.get(call.id);
    if (effectId !== undefined) {
      commitDrafts(run, `tool:${call.id}:exec`, [
        { kind: "effect.exec", payload: { effectId, startedAt: clock.now() } },
      ]);
    }
    const fallback: FakeToolOutput = { text: "ok" };
    const outcome: FakeToolOutput = await (def?.run?.(args, run.signal) ??
      Promise.resolve(fallback));
    return resultCommit(
      run,
      call,
      "executed",
      outcome.text,
      false,
      false,
      outcome.terminate === true,
      outcome.structuredContent ?? null,
    );
  }

  function settleOne(
    call: AgentToolCall,
    reason: RejectReason,
    run: ToolRunContext,
  ): ToolCallOutcome {
    closed.push(call.id);
    const text =
      reason === "truncated"
        ? "The tool call was not executed: the response hit the output token limit."
        : "The tool call was not executed.";
    if (intents.has(call.id)) {
      return resultCommit(run, call, reason, text, true, true);
    }
    return itemOnly(run, call, reason, text);
  }

  const service: ToolService = {
    register: () => notImplemented("register"),
    meta(name): ToolMeta | undefined {
      const def = defs.get(name);
      if (def === undefined) return undefined;
      return {
        name,
        label: name,
        ref: { capability: "core.fake", name },
        risk: "exec",
        classes: [],
        hints: {},
        replay: def.replay === "safe" ? "safe" : "unsafe",
        ...(def.executionMode === undefined ? {} : { executionMode: def.executionMode }),
        exposure: "always",
        outputLimits: "self",
      };
    },
    advertise: (input) => {
      advertiseInputs.push(input);
      advertisedActivated.push([...input.activated]);
      return Promise.resolve(toolsetOf());
    },
    prepare: (call, _assistant, run) => prepare(call, run),
    execute: (prepared, _onUpdate, run) => execute(prepared.toolCall, prepared.args, run),
    settleRejected: (calls, reason, run) =>
      Promise.resolve(calls.map((call) => settleOne(call, reason, run))),
    rerun(intent, run): Promise<Result<ToolCallOutcome, ReadFailure>> {
      reran.push(intent.toolCallId);
      intents.set(intent.toolCallId, intent.effectId);
      const call: AgentToolCall = {
        type: "toolCall",
        id: intent.toolCallId,
        name: intent.toolName,
        arguments: {},
      };
      return Promise.resolve(ok(resultCommit(run, call, "executed", "rerun ok", false, false)));
    },
    registerRules: () => notImplemented("registerRules"),
    runUserShell: () => notImplemented("runUserShell"),
    mode: () => "default",
    setMode: () => notImplemented("setMode"),
  };

  return {
    service,
    runs,
    executed,
    advertisedActivated,
    advertiseInputs,
    closed,
    reran,
    get waitingApproval() {
      return [...gates.keys()];
    },
    respondApproval,
    pendingApprovals,
    get onExecute() {
      return hooks.onExecute;
    },
    set onExecute(value) {
      hooks.onExecute = value;
    },
  };
}
