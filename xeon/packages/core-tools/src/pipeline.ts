import { Bug, canonicalJson, parse } from "@xeon/contracts";
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
import type {
  AgentToolCall,
  AgentToolResult,
  AgentToolUpdateCallback,
  AssistantMessage,
  ItemId,
  JsonObject,
  JsonValue,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import type {
  ApprovalOrigin,
  ApprovalRequestInput,
  CallPreparation,
  PolicyInput,
  PreparedCall,
  RejectReason,
  ToolCallOutcome,
  ToolCallState,
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
  itemOnlyRequest,
  resultRequest,
  type EffectKit,
} from "./effects.ts";
import { evaluatePolicy } from "./policy/engine.ts";
import type { ToolRegistry } from "./registry.ts";
import { addHits, hitsPayload, maskResult } from "./secrets.ts";
import { lockRequests, openToolScope } from "./tasks.ts";
import type { CallState, RawOutcome, RawToolResult, ToolEntry } from "./types.ts";
import { validateToolArguments } from "./validate.ts";
import {
  eachInOrder,
  isJsonObject,
  isJsonValue,
  mergeSignals,
  messageOf,
  utf8Bytes,
} from "./util.ts";

// L1.tools.spec §4.2 실행 파이프라인(adr.0009 §3.4). 루프가 도구 한 호출을 prepare → execute로 부르고, 실행하지 않는 호출은
// settleRejected로 닫는다. 정책·승인·효과 기록·마스킹·경계화를 이 세 메서드와 어댑터 실행 함수에 끼운다.
// 예상 가능한 실패(미발견, 인자 오류, 거부, 중단, 커밋 실패)는 던지지 않고 ToolCallOutcome으로 돌려준다.
// Bug는 호출 순서 위반(prepare 없는 execute)에만 던진다. core-tools는 pi 값을 import하지 않는다(DR-07).

export interface Pipeline {
  prepare(
    call: AgentToolCall,
    assistant: AssistantMessage,
    run: ToolRunContext,
  ): Promise<CallPreparation>;
  execute(
    call: PreparedCall,
    onUpdate: AgentToolUpdateCallback,
    run: ToolRunContext,
  ): Promise<ToolCallOutcome>;
  settleRejected(
    calls: readonly AgentToolCall[],
    reason: RejectReason,
    run: ToolRunContext,
  ): Promise<readonly ToolCallOutcome[]>;
  rerun(intent: EffectIntent, run: ToolRunContext): Promise<ToolCallOutcome>;
}

/**
 * effect.intent의 args를 이벤트에 그대로 싣는 한도(192 KiB). 넘으면 blob이다. envelope 상한(256 KiB)보다 낮게 잡는다:
 * 인자가 상한에 꼭 맞으면 effect.intent의 다른 필드와 envelope 머리가 더해져 상한을 넘기고, 작은 문자열이 많은 인자는
 * 저장소가 큰 문자열 분리로 줄일 수 없다 [L1.tools.spec §4.4 2번은 256 KiB다: 정정은 문서 쪽 미결]
 */
const ARGS_INLINE_MAX_BYTES = 192 * 1024;
/** 닫은 결과를 기억할 호출 수. 같은 호출을 두 번 닫아도 같은 결과를 돌려준다 */
const CLOSED_OUTCOME_LIMIT = 4096;

const TRUNCATED_TEXT = (name: string): string =>
  `Tool call "${name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`;

interface FinishOptions {
  readonly signal: AbortSignal | undefined;
  /** 참이면 tool_result 지점을 부르지 않는다(실행되지 않은 호출을 닫을 때) */
  readonly skipChain: boolean;
}

/** 실행 결과를 마감한 값: 경계화·기록을 마친 결과와 기록한 메시지 */
interface Finished {
  readonly result: AgentToolResult;
  readonly message: ToolResultMessage;
  /** 결과를 기록한 toolResult item. 기록 커밋이 실패했으면 null */
  readonly itemId: ItemId | null;
}

/** 실행 전에 막은 이유 */
interface Denied {
  readonly reason: string;
  readonly terminate: boolean;
}

function denied(reason: string, terminate: boolean = false): Denied {
  return { reason, terminate };
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

function toValue(result: RawToolResult, isError: boolean): ToolResultValue {
  const details: unknown = result.details;
  return {
    content: [...result.content],
    isError,
    ...(isJsonValue(details) && details !== null ? { details } : {}),
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
  };
}

function fromValue(value: ToolResultValue, terminate: boolean | undefined): RawToolResult {
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

/** 부분 결과를 AgentToolResult로 옮긴다. details가 JSON이 아니면 null이다 */
function asAgentResult(result: RawToolResult): AgentToolResult {
  const details: unknown = result.details;
  return {
    content: [...result.content],
    details: isJsonValue(details) ? details : null,
    ...(result.isError === undefined ? {} : { isError: result.isError }),
    ...(result.structuredContent === undefined
      ? {}
      : { structuredContent: result.structuredContent }),
    ...(result.usage === undefined ? {} : { usage: result.usage }),
    ...(result.terminate === undefined ? {} : { terminate: result.terminate }),
  };
}

function closedKey(run: ToolRunContext, toolCallId: string): string {
  return `${run.threadId}\0${toolCallId}`;
}

function rejectedResult(reason: string, terminate: boolean): RawToolResult {
  return {
    content: [{ type: "text", text: reason }],
    details: null,
    isError: true,
    ...(terminate ? { terminate: true } : {}),
  };
}

function outcomeOf(
  call: AgentToolCall,
  callState: ToolCallState,
  finished: Finished,
): ToolCallOutcome {
  return {
    toolCall: call,
    state: callState,
    result: finished.result,
    isError: finished.result.isError === true,
    ...(finished.message.durationMs === undefined
      ? {}
      : { durationMs: finished.message.durationMs }),
    message: finished.message,
    itemId: finished.itemId,
  };
}

export function createPipeline(
  deps: ToolsDeps,
  registry: ToolRegistry,
  calls: CallTable,
  approvals: ApprovalsInternal,
): Pipeline {
  const kit: EffectKit = { producer: deps.producer, ids: deps.ids, clock: deps.clock };
  const closed = new Map<string, ToolCallOutcome>();

  function remember(run: ToolRunContext, outcome: ToolCallOutcome): void {
    const key = closedKey(run, outcome.toolCall.id);
    closed.delete(key);
    closed.set(key, outcome);
    if (closed.size > CLOSED_OUTCOME_LIMIT) {
      const oldest = closed.keys().next();
      if (oldest.done !== true) closed.delete(oldest.value);
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

  // ── tap 3종(tool_execution_*) ─────────────────────────────────────────
  // 탭 지점은 실패해도 기록하고 계속한다. payload는 비밀을 가린 값이다.

  async function tapStart(run: ToolRunContext, call: AgentToolCall): Promise<void> {
    try {
      await deps.ext.dispatch(
        "tool_execution_start",
        {
          toolCallId: call.id,
          toolName: call.name,
          args: deps.redactor.maskDeep(call.arguments).value,
        },
        { threadId: run.threadId, dispatchKey: `${run.stepId}:tool_execution_start:${call.id}` },
      );
    } catch (error) {
      warn("tools.observe_failed", { point: "tool_execution_start", message: messageOf(error) });
    }
  }

  async function tapUpdate(
    run: ToolRunContext,
    call: AgentToolCall,
    partial: AgentToolResult,
    n: number,
  ): Promise<void> {
    try {
      await deps.ext.dispatch(
        "tool_execution_update",
        {
          toolCallId: call.id,
          toolName: call.name,
          args: deps.redactor.maskDeep(call.arguments).value,
          partialResult: deps.redactor.maskDeep(partial).value,
        },
        {
          threadId: run.threadId,
          dispatchKey: `${run.stepId}:tool_execution_update:${call.id}:${n}`,
        },
      );
    } catch (error) {
      warn("tools.observe_failed", { point: "tool_execution_update", message: messageOf(error) });
    }
  }

  async function tapEnd(
    run: ToolRunContext,
    call: AgentToolCall,
    outcome: ToolCallOutcome,
  ): Promise<void> {
    try {
      await deps.ext.dispatch(
        "tool_execution_end",
        {
          toolCallId: call.id,
          toolName: call.name,
          result: deps.redactor.maskDeep(outcome.result).value,
          isError: outcome.isError,
          ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
        },
        { threadId: run.threadId, dispatchKey: `${run.stepId}:tool_execution_end:${call.id}` },
      );
    } catch (error) {
      warn("tools.observe_failed", { point: "tool_execution_end", message: messageOf(error) });
    }
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
  ): Promise<Denied | undefined> {
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
      return denied(`[xeon:denied_by_extension] ${decision.reason}`, decision.terminate === true);
    } catch (error) {
      // 디스패처 자체의 실패도 거부다(fail-closed, L1.tools.spec §5 사례 3)
      warn("tools.tool_call_dispatch_failed", { toolCallId, message: messageOf(error) });
      return denied(`[xeon:denied_by_extension] ${FIRST_DENY.tool_call.reason}`);
    }
  }

  // ── 5b·5c 정책과 승인 ─────────────────────────────────────────────────

  async function decide(
    state: CallState,
    argsPayload: JsonObject | BlobRef,
    argsHash: string,
    signal: AbortSignal,
  ): Promise<Denied | undefined> {
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
      return denied(
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
      return denied(`[xeon:tools.commit_failed] ${describeFailure(answered.error)}`);
    }
    const resolution = answered.value;
    if (resolution.decision === "allow") return undefined;
    if (resolution.resolvedBy === "cancelled" && signal.aborted) {
      // 턴 취소는 대기 중인 요청을 cancelled로 닫는다(L1.tools.spec §4.7 8번)
      await approvals.cancel(resolution.approvalId, "turn aborted");
    }
    return denied(denialReason(resolution));
  }

  // ── 6 effect.intent ──────────────────────────────────────────────────

  function commitIntent(
    state: CallState,
    argsPayload: JsonObject | BlobRef,
    argsHash: string,
  ): Denied | undefined {
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
      return denied(`[xeon:tools.commit_failed] ${describeFailure(committed.failure)}`);
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
      return denied("[xeon:tools.commit_failed] the stored effect.intent is already settled");
    }
    state.intent = { effectId: stored.effectId, itemId: intent.itemId };
    return undefined;
  }

  // ── 효과 없이 닫는 호출의 결과 기록 ────────────────────────────────────

  /**
   * 효과(intent) 없이 끝난 호출의 결과를 toolResult item 하나로 기록한다. 비밀 마스킹을 거친다.
   * item 커밋이 실패하면 itemId는 null이고 루프가 run을 끝낸다.
   */
  async function recordWithoutEffect(
    run: ToolRunContext,
    call: AgentToolCall,
    input: {
      readonly state: ToolCallState;
      readonly result: RawToolResult;
    },
  ): Promise<ToolCallOutcome> {
    const hits = new Map<string, number>();
    const masked = maskResult(deps.redactor, input.result);
    addHits(hits, masked.hits);
    const result = asAgentResult({ ...masked.result, isError: true });
    const now = deps.clock.now();
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: result.content,
      isError: true,
      timestamp: now,
      ...(result.details === undefined || result.details === null
        ? {}
        : { details: result.details }),
    };
    const itemId = deps.ids.next("itm");
    const draft = itemDraftOf({ run, itemId, effectId: null, message });
    const key = await commitKeyPart(call.id);
    let recorded: ItemId | null = null;
    if (draft === undefined) {
      warn("tools.item_draft_unstamped", { toolCallId: call.id });
    } else {
      const extra: StampedDraft[] = [];
      const payload = hitsPayload(hits);
      if (payload.length > 0) {
        extra.push(
          deps.producer.draft({
            id: deps.ids.next("evt"),
            kind: "secret.masked",
            threadId: run.threadId,
            turnId: run.turnId,
            stepId: run.stepId,
            causationId: null,
            correlationId: itemId,
            payload: { hits: payload, layer: "tool-result", at: now },
          }),
        );
      }
      const committed = commitWithRetry(
        deps.session,
        itemOnlyRequest({ run, key, toolCallId: call.id, item: draft, extra }),
      );
      if (committed.ok) {
        recorded = itemId;
      } else {
        warn("tools.result_commit_failed", {
          toolCallId: call.id,
          message: describeFailure(committed.failure),
        });
      }
    }
    const outcome: ToolCallOutcome = {
      toolCall: call,
      state: input.state,
      result,
      isError: true,
      message,
      itemId: recorded,
    };
    remember(run, outcome);
    await tapEnd(run, call, outcome);
    return outcome;
  }

  // ── prepare ──────────────────────────────────────────────────────────

  async function prepare(
    call: AgentToolCall,
    _assistant: AssistantMessage,
    run: ToolRunContext,
  ): Promise<CallPreparation> {
    await tapStart(run, call);
    const settle = async (
      reason: string,
      terminate: boolean = false,
    ): Promise<CallPreparation> => ({
      kind: "settled",
      outcome: await recordWithoutEffect(run, call, {
        state: "rejected",
        result: rejectedResult(reason, terminate),
      }),
    });

    const entry = registry.get(call.name);
    if (entry === undefined) {
      return settle(`[xeon:tool_unavailable] Tool ${call.name} is not available.`);
    }
    if (run.ceiling !== undefined) {
      // 자식 대화의 권한 상한은 M2(TL-13)다. 상한을 적용하지 못하면 실행하지 않는다
      return settle("[xeon:ceiling_unsupported] Child conversations cannot run tools yet.");
    }
    const checked = validateToolArguments(entry.parameters, call);
    if (!checked.ok) return settle(checked.error.message);

    const state: CallState = {
      threadId: run.threadId,
      toolCallId: call.id,
      key: await commitKeyPart(call.id),
      run,
      entry,
      args: checked.value,
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
    let verdict: Denied | undefined;
    try {
      verdict = await gate(state, run.signal);
    } catch (error) {
      if (error instanceof Bug) {
        forget(state);
        throw error;
      }
      deps.logger?.error("tools.before_failed", { toolCallId: call.id, message: messageOf(error) });
      verdict = denied("[xeon:tools.internal_error] The tool call could not be prepared.");
    }
    if (verdict !== undefined) {
      forget(state);
      return settle(verdict.reason, verdict.terminate);
    }
    return { kind: "ready", call: { toolCall: call, args: checked.value } };
  }

  /** tool_call 지점 → 정책·승인 → 중단 확인 → effect.intent. 막히면 이유를 돌려준다 */
  async function gate(state: CallState, signal: AbortSignal): Promise<Denied | undefined> {
    const toolCallDenied = await dispatchToolCall(state, signal);
    if (toolCallDenied !== undefined) return toolCallDenied;

    const argsPayload = inlineOrBlob(state.args);
    if (argsPayload === undefined) {
      return denied("[xeon:tools.commit_failed] the tool arguments could not be stored");
    }
    const argsHash = await argsHashOf(state.args);
    const verdict = await decide(state, argsPayload, argsHash, signal);
    if (verdict !== undefined) return verdict;
    // 의도를 쓰기 전에 중단을 확인한다. 의도가 있는 호출은 실행 전이라도 settleRejected가 효과 결과로 닫아야 한다
    if (signal.aborted) return denied("[xeon:aborted] Operation aborted");
    return commitIntent(state, argsPayload, argsHash);
  }

  // ── 7·8 실행 ─────────────────────────────────────────────────────────

  async function runBody(
    state: CallState,
    params: unknown,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback,
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
    const masking = (partial: AgentToolResult): void => {
      const masked = maskResult(deps.redactor, partial);
      addHits(state.maskedHits, masked.hits);
      onUpdate(asAgentResult(masked.result));
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
    callerSignal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback,
  ): Promise<RawOutcome> {
    const { run, entry } = state;
    const scope = openToolScope(deps.tasks, run, state.toolCallId);
    if (scope !== undefined) state.release = scope.release;
    const signal = mergeSignals(callerSignal, run.signal, scope?.node.signal);
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
    input: RawToolResult,
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
      content: [...content],
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
      return {
        result: failed,
        message: {
          role: "toolResult",
          toolCallId: state.toolCallId,
          toolName: entry.name,
          content: failed.content,
          isError: true,
          timestamp: now,
        },
        itemId: null,
      };
    }
    if (itemDraft !== undefined) state.settledItem = resultItemId;
    state.release?.();
    state.release = undefined;

    const result: AgentToolResult = {
      content: [...content],
      details,
      isError: current.isError,
      ...(current.structuredContent === undefined
        ? {}
        : { structuredContent: current.structuredContent }),
      ...(current.usage === undefined ? {} : { usage: current.usage }),
      ...(terminate === undefined ? {} : { terminate }),
    };
    return { result, message, itemId: itemDraft === undefined ? null : resultItemId };
  }

  // ── execute ──────────────────────────────────────────────────────────

  async function execute(
    prepared: PreparedCall,
    onUpdate: AgentToolUpdateCallback,
    run: ToolRunContext,
  ): Promise<ToolCallOutcome> {
    const call = prepared.toolCall;
    const state = calls.get(run.threadId, call.id);
    if (state?.intent === undefined) {
      // 커밋된 effect.intent가 없으면 provider를 부르지 않는다(L1.tools.spec §4.4 1번, 호출 순서 위반)
      throw new Bug(`tools.intent_missing: no committed effect.intent for ${call.id}`);
    }
    const updates: Promise<void>[] = [];
    const forward: AgentToolUpdateCallback = (partial) => {
      state.updates += 1;
      updates.push(tapUpdate(run, call, partial, state.updates));
      onUpdate(partial);
    };
    try {
      const outcome = await runCall(state, prepared.args, undefined, forward);
      await Promise.all(updates);
      const finished = await finishCall(state, outcome.result, outcome.result.isError === true, {
        signal: run.signal,
        skipChain: false,
      });
      forget(state);
      const result = outcomeOf(call, "executed", finished);
      await tapEnd(run, call, result);
      return result;
    } catch (error) {
      forget(state);
      if (error instanceof Bug) throw error;
      // 결과를 기록하는 중 예상하지 못한 오류. 비밀이 새지 않는 오류 결과를 돌려주고 기록하지 못한 것으로 표시한다
      deps.logger?.error("tools.after_failed", { toolCallId: call.id, message: messageOf(error) });
      const failed = await recordWithoutEffect(run, call, {
        state: "executed",
        result: rejectedResult(
          "[xeon:tools.internal_error] The tool result could not be recorded.",
          true,
        ),
      });
      return failed;
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
    } catch (error) {
      // 저장된 인자 blob이 JSON이 아니다. 인자를 읽을 수 없는 호출로 닫는다
      warn("tools.args_unreadable", { toolCallId: intent.toolCallId, message: messageOf(error) });
      return undefined;
    }
  }

  async function rerun(intent: EffectIntent, run: ToolRunContext): Promise<ToolCallOutcome> {
    const entry = registry.get(intent.toolName);
    if (entry === undefined) {
      throw new Bug(`tools.rerun_tool_missing: ${intent.toolName} is no longer registered`);
    }
    const args = argsOf(intent);
    const call: AgentToolCall = {
      type: "toolCall",
      id: intent.toolCallId,
      name: intent.toolName,
      arguments: args ?? {},
    };
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
        return outcomeOf(call, "executed", finished);
      }
      const outcome = await runCall(state, args, undefined, () => {});
      const finished = await finishCall(state, outcome.result, outcome.result.isError === true, {
        signal: undefined,
        skipChain: false,
      });
      return outcomeOf(call, "executed", finished);
    } finally {
      forget(state);
    }
  }

  // ── settleRejected(L1.tools.spec §4.2) ───────────────────────────────

  async function settleOne(
    call: AgentToolCall,
    reason: RejectReason,
    run: ToolRunContext,
  ): Promise<ToolCallOutcome> {
    const known = closed.get(closedKey(run, call.id));
    if (known !== undefined) return known;
    const state = calls.get(run.threadId, call.id);
    if (state === undefined) {
      // 준비하지 않은 호출: 시작 tap을 짝으로 내고 효과 없이 닫는다
      await tapStart(run, call);
    }
    if (state?.intent !== undefined) {
      // 의도가 커밋된 호출: 실행 전이면 "시작 전", 실행 표시가 있으면 "결과 불명"으로 효과 결과를 쓴다
      const text = state.execCommitted ? OUTCOME_UNKNOWN_TEXT : NOT_STARTED_TEXT;
      state.interrupted = state.execCommitted;
      const finished = await finishCall(
        state,
        { content: [{ type: "text", text }], details: null, isError: true },
        true,
        { signal: undefined, skipChain: true },
      );
      forget(state);
      const outcome = outcomeOf(call, reason, finished);
      remember(run, outcome);
      await tapEnd(run, call, outcome);
      return outcome;
    }
    if (state !== undefined) forget(state);
    const text = reason === "truncated" ? TRUNCATED_TEXT(call.name) : NOT_STARTED_TEXT;
    return recordWithoutEffect(run, call, {
      state: reason,
      result: { content: [{ type: "text", text }], details: null, isError: true },
    });
  }

  async function settleRejected(
    toClose: readonly AgentToolCall[],
    reason: RejectReason,
    run: ToolRunContext,
  ): Promise<readonly ToolCallOutcome[]> {
    const outcomes: ToolCallOutcome[] = [];
    await eachInOrder(toClose, async (call) => {
      outcomes.push(await settleOne(call, reason, run));
    });
    return outcomes;
  }

  return {
    prepare,
    execute,
    settleRejected,
    rerun,
  };
}
