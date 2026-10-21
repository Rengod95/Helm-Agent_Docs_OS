import { assertNever, Bug, canonicalJson, parse } from "@xeon/contracts";
import { FIRST_DENY, type CapabilityRef, type ToolResultValue } from "@xeon/contracts/extensions";
import {
  BlobRefSchema,
  NOT_STARTED_TEXT,
  OUTCOME_UNKNOWN_TEXT,
  type BlobRef,
  type EffectIntent,
  type EffectResult,
  type EffectStatus,
  type StampedDraft,
} from "@xeon/contracts/records";
import {
  toToolResultRecord,
  type AfterToolCallContext,
  type AfterToolCallResult,
  type AgentEvent,
  type AgentToolHooks,
  type AgentTool,
  type AgentToolResult,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
  type ItemId,
  type JsonObject,
  type JsonValue,
  type ToolResultMessage,
  type ToolResultRecord,
} from "@xeon/contracts/conversation";
import type {
  ApprovalOrigin,
  ApprovalRequestInput,
  PolicyInput,
  ToolRunContext,
} from "@xeon/contracts/services";
import { denialReason, requestKeyFor } from "./approvals/protocol.ts";
import type { ApprovalsInternal } from "./approvals/service.ts";
import { boundResult, selfBlobRef } from "./bound.ts";
import type { CallTable } from "./calls.ts";
import { commitWithRetry, describeFailure } from "./commit.ts";
import type { ToolsDeps } from "./deps.ts";
import { errorOutcome } from "./entries.ts";
import {
  argsHashOf,
  commitKeyPart,
  execRequest,
  fitForEvent,
  intentRequest,
  itemDraftOf,
  resultRequest,
  type EffectKit,
} from "./effects.ts";
import { evaluatePolicy } from "./policy/engine.ts";
import type { ToolRegistry } from "./registry.ts";
import { addHits, hitsPayload, maskResult } from "./secrets.ts";
import { lockRequests, openToolScope } from "./tasks.ts";
import type { CallState, RawOutcome, ToolEntry } from "./types.ts";
import {
  eachInOrder,
  isJsonObject,
  isJsonValue,
  mergeSignals,
  messageOf,
  utf8Bytes,
} from "./util.ts";

// L1.tools.spec §4.2 실행 파이프라인. agent-core의 beforeToolCall·afterToolCall 훅 쌍과 어댑터 execute에
// 정책·승인·효과 기록·마스킹·경계화를 끼운다. core-tools는 agent-core 값을 import하지 않는다(DR-07).

export interface Pipeline {
  hooks(run: ToolRunContext): AgentToolHooks;
  agentTool(entry: ToolEntry, run: ToolRunContext): AgentTool;
  observe(
    event: Extract<AgentEvent, { type: `tool_execution_${string}` }>,
    run: ToolRunContext,
  ): Promise<void>;
  rerun(intent: EffectIntent, run: ToolRunContext): Promise<ToolResultRecord>;
  closeUnexecuted(run: ToolRunContext, toolCallIds: readonly string[]): Promise<void>;
  settledItem(toolCallId: string): ItemId | undefined;
}

/**
 * effect.intent의 args를 이벤트에 그대로 싣는 한도(192 KiB). 넘으면 blob이다. envelope 상한(256 KiB)보다 낮게 잡는다:
 * 인자가 상한에 꼭 맞으면 effect.intent의 다른 필드와 envelope 머리가 더해져 상한을 넘기고, 작은 문자열이 많은 인자는
 * 저장소가 큰 문자열 분리로 줄일 수 없다 [L1.tools.spec §4.4 2번은 256 KiB다: 정정은 문서 쪽 미결]
 */
const ARGS_INLINE_MAX_BYTES = 192 * 1024;
/** 결과 item을 기억할 호출 수 */
const SETTLED_ITEM_LIMIT = 4096;

interface FinishOptions {
  readonly signal: AbortSignal | undefined;
  /** 참이면 tool_result 지점을 부르지 않는다(실행되지 않은 호출을 닫을 때) */
  readonly skipChain: boolean;
}

interface Finished {
  /** 경계화를 마친 최종 결과 */
  readonly result: AgentToolResult;
  readonly override: AfterToolCallResult;
}

function blocked(reason: string, terminate: boolean = false): BeforeToolCallResult {
  return terminate ? { block: true, reason, terminate: true } : { block: true, reason };
}

function capabilityRefOf(entry: ToolEntry): CapabilityRef | undefined {
  return entry.capability === undefined
    ? undefined
    : { id: entry.capability.id, method: entry.capability.method };
}

function notExecuted(text: string, code: string): RawOutcome {
  return errorOutcome(text, { code });
}

function statusOf(state: CallState, isError: boolean): EffectStatus {
  if (!state.execCommitted) return "abandoned";
  if (!isError) return "ok";
  return state.interrupted ? "interrupted" : "error";
}

function toValue(result: AgentToolResult<unknown>, isError: boolean): ToolResultValue {
  const details: unknown = result.details;
  return {
    content: result.content,
    isError,
    ...(isJsonValue(details) && details !== null ? { details } : {}),
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function fromValue(
  value: ToolResultValue,
  terminate: boolean | undefined,
): AgentToolResult<unknown> {
  return {
    content: value.content,
    details: value.details ?? null,
    isError: value.isError,
    ...(value.structuredContent === undefined
      ? {}
      : { structuredContent: value.structuredContent }),
    ...(value.usage === undefined ? {} : { usage: value.usage }),
    ...(terminate === undefined ? {} : { terminate }),
  };
}

export function createPipeline(
  deps: ToolsDeps,
  registry: ToolRegistry,
  calls: CallTable,
  approvals: ApprovalsInternal,
): Pipeline {
  const kit: EffectKit = { producer: deps.producer, ids: deps.ids, clock: deps.clock };
  const settled = new Map<string, ItemId>();

  function remember(toolCallId: string, itemId: ItemId): void {
    settled.delete(toolCallId);
    settled.set(toolCallId, itemId);
    if (settled.size > SETTLED_ITEM_LIMIT) {
      const oldest = settled.keys().next();
      if (oldest.done !== true) settled.delete(oldest.value);
    }
  }

  function warn(event: string, fields: Record<string, string | number | boolean>): void {
    deps.logger?.warn(event, fields);
  }

  function forget(state: CallState): void {
    state.release?.();
    state.release = undefined;
    calls.remove(state);
  }

  // ── 인자 ──────────────────────────────────────────────────────────────

  /** effect.intent와 승인 요청에 싣는 인자. 192 KiB를 넘으면 blob이다 */
  function inlineOrBlob(args: JsonObject): JsonObject | BlobRef | undefined {
    const bytes = utf8Bytes(canonicalJson(args));
    if (bytes.length <= ARGS_INLINE_MAX_BYTES) return args;
    const stored = deps.store.putBlob(bytes, "application/json");
    return stored.ok ? stored.value : undefined;
  }

  // ── 5a tool_call 지점 ─────────────────────────────────────────────────

  async function dispatchToolCall(
    state: CallState,
    signal: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const { run, entry, toolCallId } = state;
    const capability = capabilityRefOf(entry);
    try {
      const outcome = await deps.ext.dispatch(
        "tool_call",
        {
          toolCallId,
          toolName: entry.name,
          input: state.args,
          ...(capability === undefined ? {} : { capability }),
        },
        { threadId: run.threadId, dispatchKey: `${run.stepId}:tool_call:${toolCallId}`, signal },
      );
      const decision = outcome.decision;
      if (decision === undefined) return undefined;
      return blocked(`[xeon:denied_by_extension] ${decision.reason}`, decision.terminate === true);
    } catch (error) {
      // 디스패처 자체의 실패도 거부다(fail-closed, L1.tools.spec §5 사례 3)
      warn("tools.tool_call_dispatch_failed", { toolCallId, message: messageOf(error) });
      return blocked(`[xeon:denied_by_extension] ${FIRST_DENY.tool_call.reason}`);
    }
  }

  // ── 5b·5c 정책과 승인 ─────────────────────────────────────────────────

  async function decide(
    state: CallState,
    argsPayload: JsonObject | BlobRef,
    argsHash: string,
    signal: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const { run, entry, toolCallId } = state;
    const config = deps.config(run.threadId);
    const input: PolicyInput = {
      action: "tool.call",
      tool: entry.name,
      ...(entry.capability === undefined ? {} : { capability: entry.capability.id }),
      ...(entry.mcpServer === undefined ? {} : { mcpServer: entry.mcpServer }),
      classes: entry.classes,
      risk: entry.risk,
      args: state.args,
      caller: run.caller,
      depth: run.depth,
      mode: config.mode,
      interactive: run.interactive,
      bypassAllowed: config.bypassAllowed,
    };
    const decision = evaluatePolicy(input, config.rules);
    if (decision.effect === "deny") {
      return blocked(
        decision.message ?? `[xeon:denied_by_policy] Tool call "${entry.name}" is denied.`,
      );
    }
    if (decision.effect === "allow") return undefined;
    if (approvals.isRemembered(run.surfaceThreadId, entry.name, decision.ruleId)) return undefined;

    const origin: ApprovalOrigin = {
      threadId: run.threadId,
      turnId: run.turnId,
      stepId: run.stepId,
      toolCallId,
      caller: run.caller,
    };
    const request: ApprovalRequestInput = {
      origin,
      requestKey: await requestKeyFor(toolCallId),
      title: `Allow tool "${entry.name}"?`.slice(0, 120),
      body: {
        kind: "tool",
        tool: {
          toolName: entry.name,
          ...(entry.capability === undefined ? {} : { capability: entry.capability }),
          risk: entry.risk,
          args: argsPayload,
          argsHash,
          ruleId: decision.ruleId,
        },
      },
      remember: ["once", "thread", "always"],
    };
    const answered = await approvals.requestTool(request, signal);
    if (!answered.ok) {
      return blocked(`[xeon:tools.commit_failed] ${describeFailure(answered.error)}`);
    }
    const resolution = answered.value;
    if (resolution.decision === "allow") return undefined;
    if (resolution.resolvedBy === "cancelled" && signal.aborted) {
      // 턴 취소는 대기 중인 요청을 cancelled로 닫는다(L1.tools.spec §4.7 8번)
      await approvals.cancel(resolution.approvalId, "turn aborted");
    }
    return blocked(denialReason(resolution));
  }

  // ── 6 effect.intent ──────────────────────────────────────────────────

  function commitIntent(
    state: CallState,
    argsPayload: JsonObject | BlobRef,
    argsHash: string,
  ): BeforeToolCallResult | undefined {
    const { run, entry, toolCallId } = state;
    const intent: EffectIntent = {
      effectId: deps.ids.next("efx"),
      toolCallId,
      toolName: entry.name,
      itemId: deps.ids.next("itm"),
      argsHash,
      args: argsPayload,
      replay: entry.replay,
      idempotencyKey: null,
    };
    const committed = commitWithRetry(
      deps.session,
      intentRequest(kit, { run, key: state.key, intent }),
    );
    if (!committed.ok) {
      return blocked(`[xeon:tools.commit_failed] ${describeFailure(committed.failure)}`);
    }
    if (!committed.result.replayed) {
      state.intent = { effectId: intent.effectId, itemId: intent.itemId };
      return undefined;
    }
    // 같은 키의 의도가 이미 커밋되어 있었다. 저장된 효과의 id를 이어 쓴다
    const stored = deps.session.query
      .openEffects(run.threadId)
      .find((effect) => effect.toolCallId === toolCallId);
    if (stored === undefined) {
      return blocked("[xeon:tools.commit_failed] the stored effect.intent is already settled");
    }
    state.intent = { effectId: stored.effectId, itemId: intent.itemId };
    return undefined;
  }

  // ── beforeToolCall ───────────────────────────────────────────────────

  async function before(
    run: ToolRunContext,
    context: BeforeToolCallContext,
    hookSignal: AbortSignal | undefined,
  ): Promise<BeforeToolCallResult | undefined> {
    const toolCallId = context.toolCall.id;
    const entry = registry.get(context.toolCall.name);
    if (entry === undefined) {
      return blocked(`[xeon:tool_unavailable] Tool ${context.toolCall.name} is not available.`);
    }
    if (run.ceiling !== undefined) {
      // 자식 대화의 권한 상한은 M2(TL-13)다. 상한을 적용하지 못하면 실행하지 않는다
      return blocked("[xeon:ceiling_unsupported] Child conversations cannot run tools yet.");
    }
    if (!isJsonObject(context.args)) {
      return blocked("[xeon:invalid_args] The tool arguments are not a JSON object.");
    }
    const state: CallState = {
      threadId: run.threadId,
      toolCallId,
      key: await commitKeyPart(toolCallId),
      run,
      entry,
      args: context.args,
      intent: undefined,
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      attempt: 0,
      updates: 0,
      maskedHits: new Map(),
      release: undefined,
      settledItem: undefined,
    };
    calls.put(state);
    try {
      const signal = mergeSignals(run.signal, hookSignal);
      const denied = await dispatchToolCall(state, signal);
      if (denied !== undefined) return denied;

      const argsPayload = inlineOrBlob(state.args);
      if (argsPayload === undefined) {
        return blocked("[xeon:tools.commit_failed] the tool arguments could not be stored");
      }
      const argsHash = await argsHashOf(state.args);
      const verdict = await decide(state, argsPayload, argsHash, signal);
      if (verdict !== undefined) return verdict;

      return commitIntent(state, argsPayload, argsHash);
    } catch (error) {
      deps.logger?.error("tools.before_failed", { toolCallId, message: messageOf(error) });
      return blocked("[xeon:tools.internal_error] The tool call could not be prepared.");
    } finally {
      if (state.intent === undefined) forget(state);
    }
  }

  // ── 7·8 실행 ─────────────────────────────────────────────────────────

  async function runBody(
    state: CallState,
    params: unknown,
    signal: AbortSignal,
    onUpdate: Parameters<AgentTool["execute"]>[3],
  ): Promise<RawOutcome> {
    const { run, entry, intent } = state;
    if (intent === undefined) throw new Bug("tools.intent_missing");
    // 7d: effect.exec를 실행 직전에 따로 커밋한다
    const startedAt = deps.clock.now();
    const exec = commitWithRetry(
      deps.session,
      execRequest(kit, {
        run,
        key: state.key,
        toolCallId: state.toolCallId,
        effectId: intent.effectId,
        attempt: state.attempt,
        startedAt,
      }),
    );
    if (!exec.ok) {
      return notExecuted(
        `[xeon:tools.commit_failed] ${describeFailure(exec.failure)}`,
        "tools.commit_failed",
      );
    }
    state.execCommitted = true;
    state.startedAt = startedAt;
    const masking =
      onUpdate === undefined
        ? undefined
        : (partial: AgentToolResult<unknown>): void => {
            const masked = maskResult(deps.redactor, partial);
            addHits(state.maskedHits, masked.hits);
            onUpdate(masked.result);
          };
    try {
      const outcome = await entry.raw({
        run,
        toolCallId: state.toolCallId,
        params,
        signal,
        onUpdate: masking,
      });
      state.interrupted = outcome.interrupted;
      return outcome;
    } catch (error) {
      if (error instanceof Bug) throw error;
      state.interrupted = signal.aborted;
      return errorOutcome(
        `[tool_error] ${messageOf(error)}`,
        { code: "tool_error", tool: entry.name },
        signal.aborted,
      );
    }
  }

  /** 7a~8단계. tool 범위 노드를 열고 키를 잠근 뒤 실행한다 */
  async function runCall(
    state: CallState,
    params: unknown,
    hookSignal: AbortSignal | undefined,
    onUpdate: Parameters<AgentTool["execute"]>[3],
  ): Promise<RawOutcome> {
    const { run, entry } = state;
    const scope = openToolScope(deps.tasks, run, state.toolCallId);
    if (scope !== undefined) state.release = scope.release;
    const signal = mergeSignals(hookSignal, run.signal, scope?.node.signal);
    const tasks = deps.tasks;
    const locksFor = entry.locks;
    if (
      tasks === undefined ||
      scope === undefined ||
      deps.lockEnv === undefined ||
      locksFor === undefined
    ) {
      return runBody(state, params, signal, onUpdate);
    }
    const requests = await lockRequests(deps.lockEnv, locksFor(state.args), signal);
    if (!requests.ok) {
      return notExecuted(
        `[invalid_input] Cannot resolve the path ${requests.error.path} for locking.`,
        "invalid_input",
      );
    }
    if (requests.value.length === 0) return runBody(state, params, signal, onUpdate);
    try {
      return await tasks.locks.run(requests.value, scope.node, () =>
        runBody(state, params, signal, onUpdate),
      );
    } catch (error) {
      // 잠금 대기 중 취소: effect.exec 전이므로 not_started로 닫힌다
      if (signal.aborted && !state.execCommitted) {
        return notExecuted(
          "[aborted] The tool call was cancelled while waiting for a lock.",
          "aborted",
        );
      }
      throw error;
    }
  }

  // ── 9·10 결과 ────────────────────────────────────────────────────────

  async function chain(
    state: CallState,
    value: ToolResultValue,
    signal: AbortSignal | undefined,
  ): Promise<ToolResultValue> {
    const { run, entry, toolCallId } = state;
    const capability = capabilityRefOf(entry);
    try {
      const outcome = await deps.ext.dispatch(
        "tool_result",
        {
          toolCallId,
          toolName: entry.name,
          input: state.args,
          ...(capability === undefined ? {} : { capability }),
        },
        {
          threadId: run.threadId,
          dispatchKey: `${run.stepId}:tool_result:${toolCallId}`,
          initial: value,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return outcome.value;
    } catch (error) {
      // 핸들러 하나의 실패는 그 패치만 버린다. 디스패처 자체의 실패도 결과를 바꾸지 않는다
      warn("tools.tool_result_dispatch_failed", { toolCallId, message: messageOf(error) });
      return value;
    }
  }

  async function finishCall(
    state: CallState,
    input: AgentToolResult<unknown>,
    isError: boolean,
    options: FinishOptions,
  ): Promise<Finished> {
    const { run, entry, intent } = state;
    if (intent === undefined) throw new Bug("tools.intent_missing: finish without effect.intent");

    // 비밀 마스킹은 tool_result 지점, 경계화, blob, 커밋보다 앞이다(§4.12)
    const first = maskResult(deps.redactor, input);
    addHits(state.maskedHits, first.hits);
    const terminate = input.terminate;
    let current = toValue(first.result, isError);
    if (!options.skipChain) {
      current = await chain(state, current, options.signal);
      const again = maskResult(deps.redactor, fromValue(current, terminate));
      addHits(state.maskedHits, again.hits);
      current = toValue(again.result, current.isError);
    }

    const finalResult = fromValue(current, terminate);
    let content = finalResult.content;
    let details: JsonValue | null = isJsonValue(finalResult.details) ? finalResult.details : null;
    let blobRef: BlobRef | null;
    if (entry.outputLimits === "self") {
      blobRef = selfBlobRef(finalResult);
    } else {
      const config = deps.config(run.threadId);
      const bounded = boundResult({ truncator: deps.truncator, store: deps.store }, finalResult, {
        maxLines: entry.outputLimits.maxLines ?? config.output.maxLines,
        maxBytes: entry.outputLimits.maxBytes ?? config.output.maxBytes,
      });
      content = [...bounded.bounded.content];
      details = bounded.details;
      blobRef = bounded.bounded.blobRef;
    }

    const resultItemId = deps.ids.next("itm");
    const now = deps.clock.now();
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: state.toolCallId,
      toolName: entry.name,
      content,
      isError: current.isError,
      timestamp: now,
      ...(details === null ? {} : { details: fitForEvent(details) }),
      ...(state.startedAt === undefined ? {} : { durationMs: Math.max(0, now - state.startedAt) }),
    };
    const status = statusOf(state, current.isError);
    const effectResult: EffectResult = {
      effectId: intent.effectId,
      status,
      resultItemId,
      output: {
        structuredContent: fitForEvent(current.structuredContent ?? null),
        terminate: terminate === true,
      },
      blobRef,
      durationMs: state.startedAt === undefined ? null : Math.max(0, now - state.startedAt),
      synthesized: false,
    };
    const itemDraft = itemDraftOf({
      run,
      itemId: resultItemId,
      effectId: intent.effectId,
      message,
    });
    const extra: StampedDraft[] = [];
    const hits = hitsPayload(state.maskedHits);
    if (hits.length > 0) {
      extra.push(
        deps.producer.draft({
          id: deps.ids.next("evt"),
          kind: "secret.masked",
          threadId: run.threadId,
          turnId: run.turnId,
          stepId: run.stepId,
          causationId: null,
          correlationId: intent.effectId,
          payload: { hits, layer: "tool-result", at: now },
        }),
      );
    }
    const committed = commitWithRetry(
      deps.session,
      resultRequest(kit, {
        run,
        key: state.key,
        toolCallId: state.toolCallId,
        result: effectResult,
        item: itemDraft,
        extra,
      }),
    );
    if (!committed.ok) {
      // 결과를 커밋하지 못하면 메모리에만 두고 run을 멈춘다. 재개 때 의도와 실행 표시만 남은 효과가 된다(§5 사례 7)
      const text = `[xeon:tools.commit_failed] ${describeFailure(committed.failure)}`;
      forget(state);
      const failed: AgentToolResult = {
        content: [{ type: "text", text }],
        details: { code: "tools.commit_failed" },
        isError: true,
        terminate: true,
      };
      return { result: failed, override: { ...failed } };
    }
    if (itemDraft !== undefined) {
      state.settledItem = resultItemId;
      remember(state.toolCallId, resultItemId);
    }
    state.release?.();
    state.release = undefined;

    const result: AgentToolResult = {
      content,
      details,
      isError: current.isError,
      ...(current.structuredContent === undefined
        ? {}
        : { structuredContent: current.structuredContent }),
      ...(current.usage === undefined ? {} : { usage: current.usage }),
      ...(terminate === undefined ? {} : { terminate }),
    };
    return { result, override: { ...result } };
  }

  // ── afterToolCall ────────────────────────────────────────────────────

  async function after(
    run: ToolRunContext,
    context: AfterToolCallContext,
    hookSignal: AbortSignal | undefined,
  ): Promise<AfterToolCallResult | undefined> {
    const state = calls.get(run.threadId, context.toolCall.id);
    if (state?.intent === undefined) return undefined;
    try {
      const finished = await finishCall(state, context.result, context.isError, {
        signal: hookSignal,
        skipChain: false,
      });
      forget(state);
      return finished.override;
    } catch (error) {
      // 이 훅이 던지면 agent-core가 결과를 오류로 덮는다. 던지지 않고 비밀이 새지 않는 오류 결과를 돌려준다
      deps.logger?.error("tools.after_failed", {
        toolCallId: context.toolCall.id,
        message: messageOf(error),
      });
      forget(state);
      return {
        content: [
          {
            type: "text",
            text: "[xeon:tools.internal_error] The tool result could not be recorded.",
          },
        ],
        details: { xeonError: "after_failed" },
        isError: true,
      };
    }
  }

  // ── 어댑터 ───────────────────────────────────────────────────────────

  function agentTool(entry: ToolEntry, run: ToolRunContext): AgentTool {
    return {
      name: entry.name,
      label: entry.label,
      description: entry.description,
      parameters: entry.parameters,
      replay: entry.replay === "safe" ? "safe" : "never",
      ...(entry.outputSchema === undefined ? {} : { outputSchema: entry.outputSchema }),
      ...(entry.executionMode === undefined ? {} : { executionMode: entry.executionMode }),
      ...(entry.prepareArguments === undefined ? {} : { prepareArguments: entry.prepareArguments }),
      execute: async (toolCallId, params, signal, onUpdate) => {
        const state = calls.get(run.threadId, toolCallId);
        if (state?.intent === undefined) {
          // 커밋된 effect.intent가 없으면 provider를 부르지 않는다(L1.tools.spec §4.4 1번, 버그)
          throw new Bug(`tools.intent_missing: no committed effect.intent for ${toolCallId}`);
        }
        const outcome = await runCall(state, params, signal, onUpdate);
        return outcome.result;
      },
    };
  }

  // ── 관찰(tap 3종) ────────────────────────────────────────────────────

  async function observe(
    event: Extract<AgentEvent, { type: `tool_execution_${string}` }>,
    run: ToolRunContext,
  ): Promise<void> {
    const state = calls.get(run.threadId, event.toolCallId);
    const base = { threadId: run.threadId };
    try {
      switch (event.type) {
        case "tool_execution_start":
          await deps.ext.dispatch(
            "tool_execution_start",
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: deps.redactor.maskDeep(event.args).value,
            },
            { ...base, dispatchKey: `${run.stepId}:tool_execution_start:${event.toolCallId}` },
          );
          return;
        case "tool_execution_update": {
          if (state !== undefined) state.updates += 1;
          const n = state?.updates ?? 0;
          await deps.ext.dispatch(
            "tool_execution_update",
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: deps.redactor.maskDeep(event.args).value,
              partialResult: deps.redactor.maskDeep(event.partialResult).value,
            },
            {
              ...base,
              dispatchKey: `${run.stepId}:tool_execution_update:${event.toolCallId}:${n}`,
            },
          );
          return;
        }
        case "tool_execution_end":
          await deps.ext.dispatch(
            "tool_execution_end",
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: deps.redactor.maskDeep(event.result).value,
              isError: event.isError,
              ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
            },
            { ...base, dispatchKey: `${run.stepId}:tool_execution_end:${event.toolCallId}` },
          );
          return;
        default:
          return assertNever(event, "pipeline.observe");
      }
    } catch (error) {
      // 탭 지점은 기록하고 계속한다
      warn("tools.observe_failed", { point: event.type, message: messageOf(error) });
    } finally {
      // 도구 실행이 끝났다. afterToolCall이 불리지 않아 정착하지 못한 노드가 남아 있으면 안전망으로 내린다
      if (event.type === "tool_execution_end" && state !== undefined) forget(state);
    }
  }

  // ── 재실행(L1.tools.spec §4.9) ───────────────────────────────────────

  function argsOf(intent: EffectIntent): JsonObject | undefined {
    const blob = parse(BlobRefSchema, intent.args);
    if (!blob.ok) return isJsonObject(intent.args) ? intent.args : undefined;
    const read = deps.store.readBlob(blob.value);
    if (!read.ok) return undefined;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
      return isJsonObject(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  async function rerun(intent: EffectIntent, run: ToolRunContext): Promise<ToolResultRecord> {
    const entry = registry.get(intent.toolName);
    if (entry === undefined) {
      throw new Bug(`tools.rerun_tool_missing: ${intent.toolName} is no longer registered`);
    }
    const args = argsOf(intent);
    const execCount =
      deps.session.query
        .openEffects(run.threadId)
        .find((effect) => effect.effectId === intent.effectId)?.execCount ?? 0;
    const state: CallState = {
      threadId: run.threadId,
      toolCallId: intent.toolCallId,
      key: await commitKeyPart(intent.toolCallId),
      run,
      entry,
      args: args ?? {},
      intent: { effectId: intent.effectId, itemId: intent.itemId },
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      attempt: execCount,
      updates: 0,
      maskedHits: new Map(),
      release: undefined,
      settledItem: undefined,
    };
    calls.put(state);
    try {
      if (args === undefined) {
        const lost = errorOutcome(
          "[xeon:tools.args_unavailable] The stored arguments of this tool call cannot be read.",
          { code: "tools.args_unavailable" },
        );
        const finished = await finishCall(state, lost.result, true, {
          signal: undefined,
          skipChain: true,
        });
        return toToolResultRecord(finished.result);
      }
      const outcome = await runCall(state, args, undefined, undefined);
      const finished = await finishCall(state, outcome.result, outcome.result.isError === true, {
        signal: undefined,
        skipChain: false,
      });
      return toToolResultRecord(finished.result);
    } finally {
      forget(state);
    }
  }

  // ── 중단으로 남은 호출 닫기(L1.tools.spec §4.2, §3.3 closeUnexecuted) ──

  async function closeUnexecuted(
    run: ToolRunContext,
    toolCallIds: readonly string[],
  ): Promise<void> {
    await eachInOrder(toolCallIds, async (toolCallId) => {
      const state = calls.get(run.threadId, toolCallId);
      // 의도가 없는 호출은 효과 이벤트가 없다. toolResult item은 루프가 기록한다
      if (state?.intent === undefined || state.settledItem !== undefined) return;
      const text = state.execCommitted ? OUTCOME_UNKNOWN_TEXT : NOT_STARTED_TEXT;
      state.interrupted = state.execCommitted;
      await finishCall(
        state,
        { content: [{ type: "text", text }], details: null, isError: true },
        true,
        {
          signal: undefined,
          skipChain: true,
        },
      );
      forget(state);
    });
  }

  return {
    hooks: (run) => ({
      beforeToolCall: (context, signal) => before(run, context, signal),
      afterToolCall: (context, signal) => after(run, context, signal),
    }),
    agentTool,
    observe,
    rerun,
    closeUnexecuted,
    settledItem: (toolCallId) => settled.get(toolCallId),
  };
}
