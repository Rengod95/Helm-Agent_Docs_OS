import { Bug, canonicalJson, ok, parse, type Result } from "@xeon/contracts";
import {
  FIRST_DENY,
  type CapabilityRef,
  type ToolCallPayload,
  type ToolResultValue,
} from "@xeon/contracts/extensions";
import {
  BlobRefSchema,
  NOT_STARTED_TEXT,
  OUTCOME_UNKNOWN_TEXT,
  commitKeyPart,
  requestKeyFor,
  type BlobRef,
  type EffectIntent,
  type EffectResult,
  type EffectStatus,
  type ReadFailure,
  type StampedDraft,
} from "@xeon/contracts/records";
import {
  toToolResultRecord,
  type AgentToolCall,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type AssistantMessage,
  type ItemId,
  type JsonObject,
  type JsonValue,
  type ThreadId,
  type ToolResultMessage,
  type ToolResultRecord,
} from "@xeon/contracts/conversation";
import {
  childDecision,
  stricter,
  type ApprovalOrigin,
  type ApprovalRequestInput,
  type CallPreparation,
  type UserShellRequest,
  type PolicyInput,
  type PreparedCall,
  type RejectReason,
  type Slot,
  type TaskScope,
  type ToolCallOutcome,
  type ToolCallState,
  type ToolRunContext,
} from "@xeon/contracts/services";
import { denialReason } from "./approvals/protocol.ts";
import { unattendedPlan } from "./approvals/unattended.ts";
import type { ApprovalsInternal } from "./approvals/service.ts";
import { boundResult, selfBlobRef } from "./bound.ts";
import type { CallTable } from "./calls.ts";
import { commitWithRetry, describeFailure } from "./commit.ts";
import type { ToolsDeps } from "./deps.ts";
import { errorOutcome } from "./entries.ts";
import {
  argsHashOf,
  execRequest,
  fitForEvent,
  intentRequest,
  itemDraftOf,
  itemOnlyRequest,
  resultRequest,
  type EffectKit,
} from "./effects.ts";
import { evaluatePolicy } from "./policy/engine.ts";
import { checkSecretUse, secretHandlesOf, secretUseTitle } from "./secret-gate.ts";
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
  sha256HexSync,
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
  rerun(intent: EffectIntent, run: ToolRunContext): Promise<Result<ToolCallOutcome, ReadFailure>>;
  runUserShell(request: UserShellRequest, run: ToolRunContext): Promise<ToolResultRecord>;
  suspendWhile<T>(threadId: ThreadId, toolCallId: string, wait: Promise<T>): Promise<T>;
}

/**
 * effect.intent의 args를 이벤트에 그대로 싣는 한도(192 KiB). 넘으면 blob이다. envelope 상한(256 KiB)보다 낮게 잡는다:
 * 인자가 상한에 꼭 맞으면 effect.intent의 다른 필드와 envelope 머리가 더해져 상한을 넘기고, 작은 문자열이 많은 인자는
 * 저장소가 큰 문자열 분리로 줄일 수 없다 [L1.tools.spec §4.4 2번은 256 KiB다: 정정은 문서 쪽 미결]
 */
const ARGS_INLINE_MAX_BYTES = 192 * 1024;
/** 닫은 결과를 기억할 호출 수. 같은 호출을 두 번 닫아도 같은 결과를 돌려준다 */
const CLOSED_OUTCOME_LIMIT = 4096;
/** 비밀 사용 승인 요청의 규칙 id. 정책 규칙이 아니라 비밀 사용 승인임을 화면과 기록에 보인다 */
const SECRET_USE_RULE_ID = "secret.use";
/** 사용자 셸(`!명령`)을 실행하는 도구 이름 */
const USER_SHELL_TOOL = "bash";

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

function userShellFailure(text: string, code: string): ToolResultRecord {
  return toToolResultRecord({
    content: [{ type: "text", text }],
    details: { code },
    isError: true,
  });
}

function capabilityRefOf(entry: ToolEntry): CapabilityRef | undefined {
  return entry.capability === undefined
    ? undefined
    : { id: entry.capability.id, method: entry.capability.method };
}

/**
 * `tool.call.before`·`guard.tool.before`·`tool.result`가 받는 호출 정보. 위험 등급, 힌트, 호출 주체를 채운다
 * (M3-REQ-71, L1.tools.spec §3.6). 인자는 검증을 마친 값이다
 */
function callInfo(state: CallState): ToolCallPayload {
  const capability = capabilityRefOf(state.entry);
  return {
    toolCallId: state.toolCallId,
    toolName: state.entry.name,
    input: state.args,
    ...(capability === undefined ? {} : { capability }),
    risk: state.entry.risk,
    hints: state.entry.hints,
    caller: state.run.caller,
  };
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

/**
 * 정책 승인의 제목. 호출이 `secretEnv`로 비밀을 쓰면 이 승인이 비밀 사용의 증거가 될 수 있으므로(U-19, `approveSecretUse`)
 * 제목에 비밀 참조를 적는다. 그렇지 않으면 도구 이름만 적는다
 */
function policyTitle(toolName: string, args: JsonObject): string {
  const handles = secretHandlesOf(args);
  return handles.length === 0 ? `Allow tool "${toolName}"?` : secretUseTitle(toolName, handles);
}

/** `untrustedTurns`에 기억하는 turn 수 상한. 넘으면 가장 오래된 것부터 잊는다 */
const UNTRUSTED_TURN_LIMIT = 512;

/** 결과가 외부 내용인 도구: 웹 능력(`web.*`)과 MCP 서버 도구. 결과를 읽은 모델은 지시 주입을 받았을 수 있다(L1.tools.spec §4.3) */
function isUntrustedSource(entry: ToolEntry): boolean {
  return entry.mcpServer !== undefined || (entry.capability?.id.startsWith("web.") ?? false);
}

const BYPASS_REASONS = ["escape", "run_unsandboxed", "disabled"] as const;

/** 도구 결과가 샌드박스 밖 실행을 알리면(`sandboxed: false`와 `unsandboxedBy`) 그 이유. 아니면 undefined */
function sandboxBypassOf(structured: JsonValue | undefined): ToolBypass {
  if (!isJsonObject(structured) || structured["sandboxed"] !== false) return undefined;
  const by = structured["unsandboxedBy"];
  return BYPASS_REASONS.find((reason) => reason === by);
}

type ToolBypass = (typeof BYPASS_REASONS)[number] | undefined;

export function createPipeline(
  deps: ToolsDeps,
  registry: ToolRegistry,
  calls: CallTable,
  approvals: ApprovalsInternal,
): Pipeline {
  const kit: EffectKit = { producer: deps.producer, ids: deps.ids, clock: deps.clock };
  const closed = new Map<string, ToolCallOutcome>();

  /** 웹·MCP 도구 결과를 낸 turn의 id. 같은 turn의 뒤 호출에 `afterUntrusted`를 켠다. 프로세스 안 기억이라 재시작 뒤 이어진 turn은 거짓으로 시작한다 */
  const untrustedTurns = new Set<string>();

  /** 이 turn의 durable 기록(`tool.untrusted_read`)을 이미 찾아 본 turn. 재시작 뒤 첫 조회에서만 저장소를 읽는다 */
  const restoredTurns = new Set<string>();

  /**
   * 같은 turn이 웹·MCP 결과를 이미 읽었는가. 메모리에 없으면 turn마다 한 번 durable 기록을 찾아 복원한다(M3-REQ-100, 재시작 뒤에도 이어진다).
   * 읽기에 실패하면 거짓이 아니라 참으로 본다(안전한 쪽의 오차)
   */
  function isAfterUntrusted(run: ToolRunContext): boolean {
    if (untrustedTurns.has(run.turnId)) return true;
    if (restoredTurns.has(run.turnId)) return false;
    const found = deps.session.query.latestEvent(
      run.threadId,
      "tool.untrusted_read",
      { pointer: "/turnId", equals: run.turnId },
      { onActiveBranch: false },
    );
    if (!found.ok) {
      warn("tools.untrusted_restore_failed", { turnId: run.turnId });
      return true;
    }
    restoredTurns.add(run.turnId);
    if (restoredTurns.size > UNTRUSTED_TURN_LIMIT) {
      const oldest = restoredTurns.values().next();
      if (oldest.done !== true) restoredTurns.delete(oldest.value);
    }
    if (found.value === undefined) return false;
    markUntrusted(run.turnId);
    return true;
  }

  function markUntrusted(turnId: string): void {
    untrustedTurns.delete(turnId);
    untrustedTurns.add(turnId);
    if (untrustedTurns.size > UNTRUSTED_TURN_LIMIT) {
      const oldest = untrustedTurns.values().next();
      if (oldest.done !== true) untrustedTurns.delete(oldest.value);
    }
  }

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
        "tool.execution.before",
        {
          toolCallId: call.id,
          toolName: call.name,
          args: deps.redactor.maskDeep(call.arguments).value,
        },
        { threadId: run.threadId, dispatchKey: `${run.stepId}:tool.execution.before:${call.id}` },
      );
    } catch (error) {
      warn("tools.observe_failed", { point: "tool.execution.before", message: messageOf(error) });
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
        "tool.execution.update",
        {
          toolCallId: call.id,
          toolName: call.name,
          args: deps.redactor.maskDeep(call.arguments).value,
          partialResult: deps.redactor.maskDeep(partial).value,
        },
        {
          threadId: run.threadId,
          dispatchKey: `${run.stepId}:tool.execution.update:${call.id}:${n}`,
        },
      );
    } catch (error) {
      warn("tools.observe_failed", { point: "tool.execution.update", message: messageOf(error) });
    }
  }

  async function tapEnd(
    run: ToolRunContext,
    call: AgentToolCall,
    outcome: ToolCallOutcome,
  ): Promise<void> {
    try {
      await deps.ext.dispatch(
        "tool.execution.after",
        {
          toolCallId: call.id,
          toolName: call.name,
          input: deps.redactor.maskDeep(call.arguments).value,
          stepId: run.stepId,
          result: deps.redactor.maskDeep(outcome.result).value,
          isError: outcome.isError,
          ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
        },
        { threadId: run.threadId, dispatchKey: `${run.stepId}:tool.execution.after:${call.id}` },
      );
    } catch (error) {
      warn("tools.observe_failed", { point: "tool.execution.after", message: messageOf(error) });
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
    const { run, toolCallId } = state;
    try {
      const outcome = await deps.ext.dispatch("tool.call.before", callInfo(state), {
        threadId: run.threadId,
        dispatchKey: `${run.stepId}:tool.call.before:${toolCallId}`,
        signal,
      });
      const decision = outcome.decision;
      if (decision === undefined) return undefined;
      return denied(`[xeon:denied_by_extension] ${decision.reason}`, decision.terminate === true);
    } catch (error) {
      // 디스패처 자체의 실패도 거부다(fail-closed, L1.tools.spec §5 사례 3)
      warn("tools.tool_call_dispatch_failed", { toolCallId, message: messageOf(error) });
      return denied(`[xeon:denied_by_extension] ${FIRST_DENY["tool.call.before"].reason}`);
    }
  }

  /**
   * `guard.tool.before`(adr.0017 §3.6, M3-REQ-109). 정책·승인 판정을 모두 통과한 뒤 의도를 쓰기 전에 부른다. 내장 검사는 없고
   * 가드 핸들러가 차단하면 도구를 실행하지 않는다. 핸들러 예외와 디스패처 실패도 차단이다(fail-closed). 사유는 도구 결과 레코드로 대화에 남는다
   */
  async function dispatchGuard(state: CallState, signal: AbortSignal): Promise<Denied | undefined> {
    const { run, toolCallId } = state;
    try {
      const outcome = await deps.ext.dispatch("guard.tool.before", callInfo(state), {
        threadId: run.threadId,
        dispatchKey: `${run.stepId}:guard.tool.before:${toolCallId}`,
        signal,
      });
      const decision = outcome.decision;
      if (decision === undefined) return undefined;
      return denied(`[xeon:denied_by_guard] ${decision.reason}`);
    } catch (error) {
      warn("tools.guard_dispatch_failed", { toolCallId, message: messageOf(error) });
      return denied(`[xeon:denied_by_guard] ${FIRST_DENY["guard.tool.before"].reason}`);
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
      // 무인 정책이 기다리는 쪽이면 ask를 거부로 바꾸지 않고 승인 요청으로 보낸다(M3-REQ-73)
      interactive:
        run.interactive || !unattendedPlan(run, config.unattended, deps.clock.now()).silent,
      bypassAllowed: config.bypassAllowed,
    };
    const evaluated = evaluatePolicy(input, config.rules);
    // 자식 대화는 부모 관점과 정의 제한을 합친 결정과 일반 평가 중 엄격한 쪽이다(L1.tools.spec §4.5 ceiling 단계, TL-13)
    const decision =
      run.ceiling === undefined
        ? evaluated
        : stricter(
            childDecision(
              evaluatePolicy,
              input,
              run.ceiling,
              { caller: run.caller, depth: run.depth, mode: config.mode },
              config.rules,
            ),
            evaluated,
          );
    if (decision.effect === "deny") {
      return denied(
        decision.message ?? `[xeon:denied_by_policy] Tool call "${entry.name}" is denied.`,
      );
    }
    if (decision.effect === "allow") return undefined;
    // 사용자가 직접 친 명령이다. deny 규칙은 막지만 ask는 사용자 본인이 낸 명령이라 허용으로 본다
    if (state.userShell) return undefined;
    if (approvals.isRemembered(run.surfaceThreadId, entry.name, decision.ruleId)) return undefined;

    const asked = await askUser(
      state,
      {
        argsPayload,
        argsHash,
        ruleId: decision.ruleId,
        title: policyTitle(entry.name, state.args),
        requestKey: requestKeyFor(toolCallId, sha256HexSync),
        // `always`는 저장소(`core_tools_approvals`)가 들어오기 전까지 제안하지 않는다. 고르게 두면 새 대화마다 다시 묻는데
        // 사용자는 항상 허용된 줄 안다(감사 L1-04, M2 마감 G2-10). 영구 허용은 사용자 규칙(`l1.tools.rules`)이다
        remember: ["once", "thread"],
      },
      signal,
    );
    if ("reason" in asked) return asked;
    if (asked.byUser) state.userApprovalId = asked.approvalId;
    return undefined;
  }

  interface AskInput {
    readonly argsPayload: JsonObject | BlobRef;
    readonly argsHash: string;
    readonly ruleId: string | null;
    readonly title: string;
    readonly requestKey: string;
    readonly remember: ApprovalRequestInput["remember"];
  }

  /** 도구 승인(kind tool) 요청을 올리고 답을 기다린다. 허용이면 승인 id를, 아니면 모델에 보일 거부 사유를 돌려준다 */
  async function askUser(
    state: CallState,
    input: AskInput,
    signal: AbortSignal,
  ): Promise<Denied | { readonly approvalId: string; readonly byUser: boolean }> {
    const { run, entry, toolCallId } = state;
    const origin: ApprovalOrigin = {
      threadId: run.threadId,
      turnId: run.turnId,
      stepId: run.stepId,
      toolCallId,
      caller: run.caller,
    };
    const request: ApprovalRequestInput = {
      origin,
      requestKey: input.requestKey,
      title: input.title.slice(0, 120),
      body: {
        kind: "tool",
        tool: {
          toolName: entry.name,
          ...(entry.capability === undefined ? {} : { capability: entry.capability }),
          risk: entry.risk,
          args: input.argsPayload,
          argsHash: input.argsHash,
          ruleId: input.ruleId,
        },
      },
      remember: input.remember,
    };
    const answered = await approvals.request(request, signal);
    if (!answered.ok) {
      return denied(`[xeon:tools.commit_failed] ${describeFailure(answered.error)}`);
    }
    const resolution = answered.value;
    if (resolution.decision === "allow") {
      return { approvalId: resolution.approvalId, byUser: resolution.resolvedBy === "user" };
    }
    if (resolution.resolvedBy === "cancelled" && signal.aborted) {
      // 턴 취소는 대기 중인 요청을 cancelled로 닫는다(L1.tools.spec §4.7 8번)
      await approvals.cancel(resolution.approvalId, "turn aborted");
    }
    return denied(denialReason(resolution));
  }

  // ── 5c' 비밀 사용 승인(L1.tools.spec §4.12) ────────────────────────────

  /**
   * 호출이 `secretEnv`로 비밀을 쓰면 `xeon.secrets.check`가 `needs_approval`을 낼 때 승인 증거를 만든다. 이 호출의 정책 승인을 사용자가
   * 방금 허용했으면 그 승인이 실행마다의 승인(U-19)이라 같은 승인을 증거로 쓴다. 아니면(규칙이 허용, 모드가 허용, thread 기억) 비밀 사용을 따로 묻는다
   */
  async function approveSecretUse(
    state: CallState,
    argsPayload: JsonObject | BlobRef,
    argsHash: string,
    signal: AbortSignal,
  ): Promise<Denied | undefined> {
    const verdict = await checkSecretUse(deps.secrets, {
      toolName: state.entry.name,
      args: state.args,
      run: state.run,
      toolCallId: state.toolCallId,
    });
    if (verdict.kind === "none") return undefined;
    if (verdict.kind === "denied") return denied(verdict.reason);
    let approvalId = state.userApprovalId;
    if (approvalId === undefined) {
      const asked = await askUser(
        state,
        {
          argsPayload,
          argsHash,
          ruleId: SECRET_USE_RULE_ID,
          title: secretUseTitle(state.entry.name, verdict.handles),
          requestKey: requestKeyFor(`${state.toolCallId}:secret`, sha256HexSync),
          remember: ["once"],
        },
        signal,
      );
      if ("reason" in asked) return asked;
      approvalId = asked.approvalId;
    }
    state.secretApproval = {
      approvalId,
      scope: "per-use",
      grantedAt: deps.clock.now(),
      expiresAt: null,
    };
    return undefined;
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
    const open = deps.session.query.openEffects(run.threadId);
    if (!open.ok) {
      return denied(`[xeon:tools.commit_failed] session read failed: ${open.error.kind}`);
    }
    const stored = open.value.find((effect) => effect.toolCallId === toolCallId);
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
      /** 참이면 toolResult item을 기록하지 않는다(사용자 셸) */
      readonly silent?: boolean;
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
    const key = commitKeyPart(call.id, sha256HexSync);
    let recorded: ItemId | null = null;
    if (input.silent === true) {
      // 사용자 셸의 거부 결과는 기록하지 않고 호출자에게만 돌려준다
    } else if (draft === undefined) {
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

  function prepare(
    call: AgentToolCall,
    _assistant: AssistantMessage,
    run: ToolRunContext,
  ): Promise<CallPreparation> {
    return prepareCall(call, run, false);
  }

  /** `user`가 참이면 사용자가 직접 친 셸 명령이다(runUserShell) */
  async function prepareCall(
    call: AgentToolCall,
    run: ToolRunContext,
    user: boolean,
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
        silent: user,
      }),
    });

    const entry = registry.get(call.name);
    if (entry === undefined) {
      return settle(`[xeon:tool_unavailable] Tool ${call.name} is not available.`);
    }
    const checked = validateToolArguments(entry.parameters, call);
    if (!checked.ok) return settle(checked.error.message);

    const state: CallState = {
      threadId: run.threadId,
      toolCallId: call.id,
      key: commitKeyPart(call.id, sha256HexSync),
      run,
      entry,
      args: checked.value,
      intent: undefined,
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      userShell: user,
      slot: undefined,
      userApprovalId: undefined,
      secretApproval: null,
      sandboxBypass: undefined,
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
    const secretVerdict = await approveSecretUse(state, argsPayload, argsHash, signal);
    if (secretVerdict !== undefined) return secretVerdict;
    const guardVerdict = await dispatchGuard(state, signal);
    if (guardVerdict !== undefined) return guardVerdict;
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
    // 같은 배치의 병렬 호출은 서로의 결과를 읽지 못하지만, 먼저 끝난 호출이 표지를 켜면 뒤 호출이 참으로 본다. 안전한 쪽의 오차다
    const afterUntrusted = isAfterUntrusted(run);
    try {
      const outcome = await entry.raw({
        run,
        toolCallId: state.toolCallId,
        params,
        signal,
        onUpdate: masking,
        secretApproval: state.secretApproval,
        afterUntrusted,
      });
      state.interrupted = outcome.interrupted;
      state.sandboxBypass = sandboxBypassOf(outcome.result.structuredContent);
      if (isUntrustedSource(entry)) {
        markUntrusted(run.turnId);
        restoredTurns.add(run.turnId);
      }
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

  /** 7c: `tools` 풀 슬롯을 얻고 실행한 뒤 놓는다. 대기 중 취소는 effect.exec 전이므로 시작 전 중단이다 */
  async function runInSlot(
    state: CallState,
    params: unknown,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback,
    owner: TaskScope | undefined,
  ): Promise<RawOutcome> {
    const tasks = deps.tasks;
    if (tasks === undefined || owner === undefined) {
      return runBody(state, params, signal, onUpdate);
    }
    let slot: Slot;
    try {
      slot = await tasks.limiter("tools").acquire(owner);
    } catch (error) {
      if (signal.aborted && !state.execCommitted) {
        return notExecuted(
          "[aborted] The tool call was cancelled while waiting for a tool slot.",
          "aborted",
        );
      }
      throw error;
    }
    state.slot = slot;
    try {
      return await runBody(state, params, signal, onUpdate);
    } finally {
      state.slot = undefined;
      slot.release();
    }
  }

  /** 7a~8단계. tool 범위 노드를 열고 키를 잠근 뒤(C3: 키가 먼저) 슬롯을 얻어 실행한다 */
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
    const body = (): Promise<RawOutcome> => runInSlot(state, params, signal, onUpdate, scope?.node);
    if (
      tasks === undefined ||
      scope === undefined ||
      deps.lockEnv === undefined ||
      locksFor === undefined
    ) {
      return body();
    }
    const requests = await lockRequests(deps.lockEnv, locksFor(state.args), signal);
    if (!requests.ok) {
      return notExecuted(
        `[invalid_input] Cannot resolve the path ${requests.error.path} for locking.`,
        "invalid_input",
      );
    }
    if (requests.value.length === 0) return body();
    try {
      return await tasks.locks.run(requests.value, scope.node, body);
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
    const { run, toolCallId } = state;
    try {
      const outcome = await deps.ext.dispatch("tool.result", callInfo(state), {
        threadId: run.threadId,
        dispatchKey: `${run.stepId}:tool.result:${toolCallId}`,
        initial: value,
        ...(signal === undefined ? {} : { signal }),
      });
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
      resultItemId: state.userShell ? null : resultItemId,
      output: {
        structuredContent: fitForEvent(current.structuredContent ?? null),
        terminate: terminate === true,
      },
      blobRef,
      durationMs: state.startedAt === undefined ? null : Math.max(0, now - state.startedAt),
      synthesized: false,
    };
    // 사용자 셸의 결과는 toolResult item으로 기록하지 않는다(호출한 쪽이 기록 방식을 정한다)
    const itemDraft = state.userShell
      ? undefined
      : itemDraftOf({ run, itemId: resultItemId, effectId: intent.effectId, message });
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
    if (state.sandboxBypass !== undefined) {
      extra.push(
        deps.producer.draft({
          id: deps.ids.next("evt"),
          kind: "tool.sandbox_bypassed",
          threadId: run.threadId,
          turnId: run.turnId,
          stepId: run.stepId,
          causationId: null,
          correlationId: intent.effectId,
          payload: {
            toolCallId: state.toolCallId,
            toolName: entry.name,
            reason: state.sandboxBypass,
            at: now,
          },
        }),
      );
    }
    if (isUntrustedSource(entry)) {
      extra.push(
        deps.producer.draft({
          id: deps.ids.next("evt"),
          kind: "tool.untrusted_read",
          threadId: run.threadId,
          turnId: run.turnId,
          stepId: run.stepId,
          causationId: null,
          correlationId: intent.effectId,
          payload: {
            turnId: run.turnId,
            toolCallId: state.toolCallId,
            toolName: entry.name,
            at: now,
          },
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

  async function rerun(
    intent: EffectIntent,
    run: ToolRunContext,
  ): Promise<Result<ToolCallOutcome, ReadFailure>> {
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
    // 실행 횟수를 읽지 못하면 다시 실행하지 않는다. 호출자(재개)가 오류 값으로 받아 run을 멈춘다
    const open = deps.session.query.openEffects(run.threadId);
    if (!open.ok) return open;
    const execCount =
      open.value.find((effect) => effect.effectId === intent.effectId)?.execCount ?? 0;
    const state: CallState = {
      threadId: run.threadId,
      toolCallId: intent.toolCallId,
      key: commitKeyPart(intent.toolCallId, sha256HexSync),
      run,
      entry,
      args: args ?? {},
      intent: { effectId: intent.effectId, itemId: intent.itemId },
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      userShell: false,
      slot: undefined,
      userApprovalId: undefined,
      secretApproval: null,
      sandboxBypass: undefined,
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
        return ok(outcomeOf(call, "executed", finished));
      }
      const outcome = await runCall(state, args, undefined, () => {});
      const finished = await finishCall(state, outcome.result, outcome.result.isError === true, {
        signal: undefined,
        skipChain: false,
      });
      return ok(outcomeOf(call, "executed", finished));
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

  // ── 사용자 셸(L1.tools.spec §3.3 runUserShell) ────────────────────────

  /**
   * 사용자가 직접 친 셸 명령을 같은 파이프라인으로 실행한다: caller `main`, 대화형으로 평가한다. deny 규칙과 `tool.call.before` 거부는 막고,
   * ask는 사용자 본인이 낸 명령이라 허용으로 본다. 효과는 3단(intent, exec, result)으로 남고 toolResult item은 기록하지 않는다
   * (결과를 컨텍스트에 어떻게 넣을지는 호출한 쪽이 `includeInContext`로 정한다)
   */
  async function runUserShell(
    request: UserShellRequest,
    base: ToolRunContext,
  ): Promise<ToolResultRecord> {
    const entry = registry.get(USER_SHELL_TOOL);
    if (entry === undefined) {
      return userShellFailure(
        `[xeon:tool_unavailable] Tool ${USER_SHELL_TOOL} is not available.`,
        "tool_unavailable",
      );
    }
    const { ceiling: _ceiling, ...rest } = base;
    const run: ToolRunContext = { ...rest, caller: "main", depth: 0, interactive: true };
    const call: AgentToolCall = {
      type: "toolCall",
      id: deps.ids.next("itm"),
      name: USER_SHELL_TOOL,
      arguments: { command: request.command },
    };
    const prepared = await prepareCall(call, run, true);
    if (prepared.kind === "settled") {
      // 실행 전에 닫힌 호출(정책 deny, 확장 거부, 인자 오류)은 명령이 돌지 않았다는 표지를 달아 호출한 쪽이 거부로 알아보게 한다
      return toToolResultRecord({ ...prepared.outcome.result, details: { code: "not_executed" } });
    }
    const outcome = await execute(prepared.call, () => {}, run);
    return toToolResultRecord(outcome.result);
  }

  /** 슬롯을 쥔 호출이 다른 노드를 기다리는 동안 슬롯을 내려놓는다(L1.tasks.spec §4.5 C2). 슬롯이 없으면 그냥 기다린다 */
  function suspendWhile<T>(threadId: ThreadId, toolCallId: string, wait: Promise<T>): Promise<T> {
    const slot = calls.get(threadId, toolCallId)?.slot;
    return slot === undefined ? wait : slot.suspendWhile(wait);
  }

  return {
    prepare,
    execute,
    settleRejected,
    rerun,
    runUserShell,
    suspendWhile,
  };
}
