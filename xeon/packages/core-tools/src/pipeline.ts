import { Bug, canonicalJson, err, ok, parse, type Result } from "@fresnel/contracts";
import {
  ExtensionNameSchema,
  FIRST_DENY,
  type CapabilityRef,
  type ExtensionName,
  type RegistrationId,
  type ToolCallPayload,
  type ToolCallTraceEvent,
  type ToolCallVerdict,
  type ToolResultValue,
} from "@fresnel/contracts/extensions";
import {
  BlobRefSchema,
  EffectIntentSchema,
  EffectResultSchema,
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
} from "@fresnel/contracts/records";
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
} from "@fresnel/contracts/conversation";
import {
  childDecision,
  stricter,
  type ApprovalOrigin,
  type ApprovalRequestInput,
  type ApprovalResolvedBy,
  type CallPreparation,
  type DraftMark,
  type UserShellRequest,
  type PolicyDecision,
  type PolicyInput,
  type PreparedCall,
  type RejectReason,
  type Slot,
  type TaskScope,
  type CallerId,
  type PluginCallRequest,
  type PluginCallTarget,
  type HumanDecisionGrant,
  type ToolCallOutcome,
  type ToolCallState,
  type ToolError,
  type ToolResultView,
  type ToolRisk,
  type ToolRunContext,
} from "@fresnel/contracts/services";
import { denialDetails, denialReason } from "./approvals/protocol.ts";
import { unattendedPlan } from "./approvals/unattended.ts";
import type { ApprovalsInternal } from "./approvals/service.ts";
import { boundResult, selfBlobRef } from "./bound.ts";
import type { CallTable } from "./calls.ts";
import {
  newCallTraceFacts,
  originOfRun,
  resultOf,
  traceEventOf,
  verdictOfReject,
} from "./call-trace.ts";
import { commitWithRetry, describeFailure } from "./commit.ts";
import type { ToolsDeps } from "./deps.ts";
import { errorOutcome, scriptEntryOf, syntheticEntryOf } from "./entries.ts";
import { pathInCard, samePathAsOuter } from "./inherit-target.ts";
import type { InputBridge } from "./mcp-input.ts";
import {
  isPluginRequestId,
  pluginCallerOf,
  pluginNameOf,
  pluginToolCallIdOf,
  riskRankOf,
  viewOfExecution,
  viewOfRecord,
} from "./plugin-call.ts";
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
import {
  evaluateDraft,
  evaluatePolicy,
  evaluateReadOnlySandboxed,
  evaluateReplacement,
} from "./policy/engine.ts";
import { checkSecretUse, secretHandlesOf, secretUseTitle } from "./secret-gate.ts";
import type { ToolRegistry } from "./registry.ts";
import { addHits, hitsPayload, maskResult } from "./secrets.ts";
import { observedEntriesOf, reportedEntriesOf, withFileChanges } from "./file-changes.ts";
import { lockRequests, openToolScope } from "./tasks.ts";
import type {
  CallState,
  CallTraceFacts,
  CallTraceOrigin,
  RawOutcome,
  RawToolResult,
  ToolEntry,
} from "./types.ts";
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
  executeForPlugin(request: PluginCallRequest): Promise<Result<ToolResultView, ToolError>>;
  suspendWhile<T>(threadId: ThreadId, toolCallId: string, wait: Promise<T>): Promise<T>;
  withHumanDecision<T>(grant: HumanDecisionGrant, work: () => Promise<T>): Promise<T>;
}

/**
 * effect.intent의 args를 이벤트에 그대로 싣는 한도(192 KiB). 넘으면 blob이다. envelope 상한(256 KiB)보다 낮게 잡는다:
 * 인자가 상한에 꼭 맞으면 effect.intent의 다른 필드와 envelope 머리가 더해져 상한을 넘기고, 작은 문자열이 많은 인자는
 * 저장소가 큰 문자열 분리로 줄일 수 없다 [L1.tools.spec §4.4 2번은 256 KiB다: 정정은 문서 쪽 미결]
 */
const ARGS_INLINE_MAX_BYTES = 192 * 1024;
/** 닫은 결과를 기억할 호출 수. 같은 호출을 두 번 닫아도 같은 결과를 돌려준다 */
const CLOSED_OUTCOME_LIMIT = 4096;
/** 모드·내장 기본 규칙이 낸 ask이고 내장 도구 대체가 아니면, 자율 허용이나 기억된 스크립트 승인이 허용으로 바꿀 수 있다 */
function skippable(decision: PolicyDecision, entry: ToolEntry): boolean {
  if (decision.effect !== "ask") return false;
  if (decision.tier !== null && decision.tier !== "default") return false;
  return entry.replacesBuiltin !== true;
}

/** 자율 허용(`auto`) 테스트 런이 ask를 허용으로 바꾼 호출의 정책 기록 티어(`CallRecord.policy.tier`). 표준 티어가 아니라 "묻지 않고 허용함"을 읽게 하는 표지다 */
const AUTO_TEST_RUN_TIER = "auto_test_run";
/** 이 테스트 런에서 이미 허용한 드래프트 스크립트를 묻지 않고 허용한 호출의 정책 기록 티어 */
const SCRIPT_REMEMBERED_TIER = "script_remembered";
/** 시크릿 사용 승인 요청의 규칙 id. 정책 규칙이 아니라 시크릿 사용 승인임을 화면과 기록에 보인다 */
const SECRET_USE_RULE_ID = "secret.use";
/** 사용자 셸(`!명령`)을 실행하는 도구 이름 */
const USER_SHELL_TOOL = "bash";

const TRUNCATED_TEXT = (name: string): string =>
  `Tool call "${name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`;

interface FinishOptions {
  readonly signal: AbortSignal | undefined;
  /** 참이면 tool_result 지점을 부르지 않는다(실행되지 않은 호출을 닫을 때) */
  readonly skipChain: boolean;
  /** 이 닫기의 추적 판정(읽기 전용 기록). 의도가 있는 호출을 닫는 자리가 정한다 */
  readonly verdict: ToolCallVerdict;
}

/** 추적 입력: 닫는 호출의 맥락과 판정. 실행 값(`exec`)과 결과 값(`result`)은 닫는 자리가 채운다 */
interface TraceInput {
  readonly origin: CallTraceOrigin;
  readonly tool: string;
  /** 검증을 마친 인자이거나 검증 전의 원래 인자다 */
  readonly args: unknown;
  readonly entry: ToolEntry | undefined;
  /** 사실(훅·정책·승인)을 모으는 호출 상태. 실행 전에 닫힌 플러그인 호출처럼 없으면 undefined */
  readonly callState: CallState | undefined;
  /** 판정. undefined면 추적 줄을 남기지 않는다(저장 실패와 내부 오류는 열네 판정 중 맞는 값이 없다) */
  readonly verdict: ToolCallVerdict | undefined;
}

interface TraceClose extends TraceInput {
  readonly exec: ToolCallTraceEvent["exec"];
  readonly result: ToolCallTraceEvent["result"];
}

/** 실행 결과를 마감한 값: 경계화·기록을 마친 결과와 기록한 메시지 */
interface Finished {
  readonly result: AgentToolResult;
  readonly message: ToolResultMessage;
  /** 결과를 기록한 toolResult item. 기록 커밋이 실패했으면 null */
  readonly itemId: ItemId | null;
}

/**
 * 실행 전에 호출을 닫는 이유. `details`는 UI·로그용이고 모델에 가는 본문은 `reason`뿐이다.
 * `replaced`가 있으면 거부가 아니라 훅이 낸 결과 대신 주기다: 실행하지 않고 이 결과를 그대로 기록한다(M5e 스펙 §4.2)
 */
interface Denied {
  readonly reason: string;
  readonly terminate: boolean;
  readonly details: JsonObject | null;
  /** 플러그인 호출에서 `ToolError`의 종류가 된다(모델 호출에는 쓰지 않는다) */
  readonly kind: DeniedKind;
  /** `denied`일 때 거부한 쪽. 플러그인 호출의 `ToolError.resolvedBy`가 된다 */
  readonly resolvedBy: ToolError["resolvedBy"];
  readonly replaced?: RawToolResult;
  /** 추적 판정. 거부를 낸 자리가 `judged`로 붙인다. 붙이지 않은 거부(저장 실패, 내부 오류)는 undefined이고 추적 줄이 없다 */
  readonly verdict: ToolCallVerdict | undefined;
}

/** 실행 전에 막은 이유의 종류. `blocked`는 훅이 막음, `storage`는 저장소 실패, `aborted`는 중단, 나머지는 `denied` */
type DeniedKind = "denied" | "blocked" | "storage" | "aborted";

/** `tool.call.before`가 낸 묻기. 승인 카드의 `askedBy`와 `ruleId`(`hook:<확장>`)가 된다 */
interface HookAsk {
  readonly extension: string;
  readonly reason: string;
}

/** `tool.call.before` 합치기의 결과: 호출을 닫거나, 묻기를 싣거나, 결정이 없다 */
type ToolCallHookVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "closed"; readonly denied: Denied }
  | { readonly kind: "ask"; readonly ask: HookAsk };

function denied(
  reason: string,
  terminate: boolean = false,
  details: JsonObject | null = null,
  kind: DeniedKind = "denied",
  resolvedBy?: ToolError["resolvedBy"],
): Denied {
  return { reason, terminate, details, kind, resolvedBy, verdict: undefined };
}

/** 거부에 추적 판정을 붙인다. 판정은 거부를 낸 자리가 정한다(kind와 details만으로는 취소와 중단을 가를 수 없다) */
function judged(refusal: Denied, verdict: ToolCallVerdict): Denied {
  return { ...refusal, verdict };
}

/** 승인이 사람 없이 해결된 거부의 추적 판정. 턴 중단이 취소를 일으켰으면 중단이고, 답 없이 닫힌 카드는 취소다 */
function verdictOfResolution(resolvedBy: ApprovalResolvedBy, aborted: boolean): ToolCallVerdict {
  if (resolvedBy === "user") return "denied_human";
  if (resolvedBy === "noninteractive") return "denied_noninteractive";
  return aborted ? "aborted" : "cancelled_ask";
}

/** 막음·대체를 낸 핸들러의 추적 값. 핸들러가 없는 실패(디스패처 실패)는 확장과 등록 id가 null이다 */
function blockedByOf(
  hook: string,
  decidedBy: { readonly extension: string; readonly scopeId: string } | null | undefined,
): NonNullable<CallTraceFacts["blockedBy"]> {
  return { plugin: decidedBy?.extension ?? null, hook, registrationId: decidedBy?.scopeId ?? null };
}

/** 실행 값: 실행을 시작한 호출만 있다(`exec`). 효과 id는 의도의 id다 */
function execOf(
  state: CallState | undefined,
  isError: boolean,
  durationMs: number | null,
): ToolCallTraceEvent["exec"] {
  if (state === undefined || state.startedAt === undefined || state.intent === undefined) {
    return null;
  }
  return {
    startedAt: state.startedAt,
    durationMs,
    status: statusOf(state, isError),
    effectId: state.intent.effectId,
  };
}

/** 추적 입력: 상태가 있는 호출을 실행 맥락 없이 닫을 때(실행 결과가 기록 시점에 정해진다) */
function traceOfState(state: CallState, verdict: ToolCallVerdict | undefined): TraceInput {
  return {
    origin: state.origin,
    tool: state.entry.name,
    args: state.args,
    entry: state.entry,
    callState: state,
    verdict,
  };
}

/**
 * 승인 해결자를 `ToolError.resolvedBy`의 값으로 옮긴다. 사용자 거부와 무인 실행만 거부한 쪽이 있다. 취소·중복 대체·만료는
 * 거부한 쪽이 없으므로 undefined다
 */
function resolvedByOf(resolvedBy: ApprovalResolvedBy): ToolError["resolvedBy"] {
  if (resolvedBy === "user") return "human";
  if (resolvedBy === "noninteractive") return "noninteractive";
  return undefined;
}

/** 같은 플러그인 호출의 durable 기록 상태. `none`은 의도가 없음, `open`은 의도만 있음(결과 없음) */
type PluginRecord =
  | { readonly kind: "none" }
  | { readonly kind: "open" }
  | { readonly kind: "done"; readonly view: ToolResultView };

/**
 * `tool.call.before`가 막은 호출의 UI용 details(L1.tools §5 사례 3). `blocked`는 핸들러가 결정을 냈다는 뜻이고 `threw`는
 * 핸들러 실패나 디스패처 실패를 거부로 바꾼 것이다. 확장을 특정하지 못하면 `extension`은 null이다
 */
function hookDenialDetails(
  outcome: "blocked" | "threw",
  extension: string | null,
  reason: string | null,
): JsonObject {
  return {
    code: "denied_by_extension",
    hook: "tool.call.before",
    extension,
    outcome,
    reason,
  };
}

/**
 * 훅의 묻기가 답할 사람 없이 거부된 호출의 details(M5e 스펙 §7 E-1). 결과는 `asked`로 적는다. 막음과 같은 코드를 쓴다
 */
function hookAskDenialDetails(ask: HookAsk): JsonObject {
  return {
    code: "denied_by_extension",
    hook: "tool.call.before",
    extension: ask.extension,
    outcome: "asked",
    reason: ask.reason,
  };
}

/** 묻기 사유가 비었을 때 카드에 싣는 문장. 카드의 사유는 비면 안 된다 */
const HOOK_ASK_REASON_FALLBACK = "the extension asked for confirmation";
/** 묻기를 낸 확장을 특정하지 못할 때의 이름(결정이 있으면 확장이 있어야 하므로 방어용이다) */
const UNKNOWN_EXTENSION = "unknown";

/** 묻기 사유를 한 줄로 만든다. 줄바꿈은 공백이 되고, 비면 기본 문장이다 */
function askReasonOf(reason: string): string {
  const line = reason.replace(/[\r\n]+/g, " ");
  return line.trim().length === 0 ? HOOK_ASK_REASON_FALLBACK : line;
}

/**
 * `replace` 결과의 details. 훅이 낸 객체에 `{ hook: "replaced", extension }`을 합친다. 객체가 아니면 `details` 키에 싣는다
 */
function replacedDetails(details: JsonValue | undefined, extension: string | null): JsonObject {
  const marker = { hook: "replaced", extension };
  if (details === undefined || details === null) return marker;
  return isJsonObject(details) ? { ...details, ...marker } : { ...marker, details };
}

/** `guard.tool.before`가 막은 호출의 UI용 details. `hookDenialDetails`와 같은 모양이고 code와 hook만 다르다 */
function guardDenialDetails(
  outcome: "blocked" | "threw",
  extension: string | null,
  reason: string | null,
): JsonObject {
  return {
    code: "denied_by_guard",
    hook: "guard.tool.before",
    extension,
    outcome,
    reason,
  };
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

/**
 * 플러그인 기능 호출이 낸 지점에서는 그 플러그인 자신의 핸들러를 건너뛴다(hooks-core-boundary §5.3 U-8 (가)). 모델 호출은 빈 값이라 바뀌지 않는다
 */
function skipOwnOf(run: ToolRunContext): { readonly exceptExtension?: string } {
  const name = pluginNameOf(run.caller);
  return name === undefined ? {} : { exceptExtension: name };
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

/**
 * `tool.result` 체인이 결과를 실제로 고쳤으면 details에 `resultPatchedBy`(고친 확장 이름, 등록 순서, 중복 없음)를 더한다.
 * 패치가 적용됐어도 최종 값이 그대로면 아무것도 더하지 않는다. details가 객체가 아니면(배열·문자열 등) 건드리지 않는다
 */
function withResultPatchedBy(
  before: ToolResultValue,
  after: ToolResultValue,
  applied: readonly { readonly extension: ExtensionName }[],
): ToolResultValue {
  if (applied.length === 0 || canonicalJson(before) === canonicalJson(after)) return after;
  const resultPatchedBy = [...new Set(applied.map((ref) => ref.extension))];
  const details = after.details;
  if (details === undefined || details === null) return { ...after, details: { resultPatchedBy } };
  if (isJsonObject(details)) return { ...after, details: { ...details, resultPatchedBy } };
  return after;
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

function rejectedResult(
  reason: string,
  terminate: boolean,
  details: JsonObject | null = null,
): RawToolResult {
  return {
    content: [{ type: "text", text: reason }],
    details,
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
 * 정책 승인의 제목. 호출이 `secretEnv`로 시크릿을 쓰면 이 승인이 시크릿 사용의 증거가 될 수 있으므로(U-19, `approveSecretUse`)
 * 제목에 시크릿 참조를 적는다. 그렇지 않으면 도구 이름만 적는다
 */
function policyTitle(toolName: string, args: JsonObject): string {
  const handles = secretHandlesOf(args);
  return handles.length === 0 ? `Allow tool "${toolName}"?` : secretUseTitle(toolName, handles);
}

/** 정책이 물은 사유의 한 줄 표시. 규칙이 있으면 규칙 id, 없으면 정책 사유다 */
function policyLabelOf(ruleId: string | null, reason: string): string {
  return ruleId === null ? reason : `rule ${ruleId}`;
}

/**
 * 호출의 초안 표지(L1.tools.spec §4.6.1). 스코프를 앞에서부터 보고 처음 초안인 것의 표지를 쓴다. 호출한 플러그인이 먼저, 도구를 등록한 스코프가 다음이다
 */
function draftOfCall(
  draftOf: ToolsDeps["draftOf"],
  scopes: readonly (RegistrationId | undefined)[],
): DraftMark | undefined {
  if (draftOf === undefined) return undefined;
  for (const scope of scopes) {
    if (scope === undefined) continue;
    const mark = draftOf(scope);
    if (mark !== undefined) return mark;
  }
  return undefined;
}

/**
 * 훅 묻기의 카드 제목. 정책도 물었으면 정책의 사유를 함께 싣는다(M5e 스펙 §5.1 H-3). 제목은 120자로 잘리므로 사유 전문은 `askedBy.reason`이 싣는다
 */
function hookAskTitle(base: string, ask: HookAsk, policy: string | undefined): string {
  const hook = `Extension "${ask.extension}" asks: ${ask.reason}`;
  return policy === undefined ? `${base} ${hook}` : `${base} Policy asks: ${policy}. ${hook}`;
}

/** `untrustedTurns`에 기억하는 turn 수 상한. 넘으면 가장 오래된 것부터 잊는다 */
const UNTRUSTED_TURN_LIMIT = 512;

/** 결과가 외부 내용인 도구: 웹 기능(`web.*`)과 MCP 서버 도구. 결과를 읽은 모델은 지시 주입을 받았을 수 있다(L1.tools.spec §4.3) */
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
  bridge: InputBridge,
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

  // ── 호출 추적(읽기 전용, `ToolCallTraceSink`) ─────────────────────────
  // 호출이 닫힐 때 한 줄씩 넘긴다. 싱크가 없으면 값을 만들지도 않는다. 싱크가 던지면 경고로 남기고 호출 결과는 그대로 둔다.

  function traceClosed(close: TraceClose): void {
    const sink = deps.callTrace;
    const verdict = close.verdict;
    if (sink === undefined || verdict === undefined) return;
    try {
      const turnId = close.origin.turnId;
      sink.record(
        traceEventOf({
          origin: close.origin,
          tool: close.tool,
          args: close.args,
          entry: close.entry,
          facts: close.callState?.facts,
          verdict,
          afterUntrusted:
            close.callState?.facts.afterUntrusted ??
            (turnId !== null && untrustedTurns.has(turnId)),
          exec: close.exec,
          result: close.result,
          closedAt: deps.clock.now(),
        }),
      );
    } catch (error) {
      warn("tools.call_trace_failed", {
        toolCallId: close.origin.toolCallId,
        message: messageOf(error),
      });
    }
  }

  function forget(state: CallState): void {
    state.release?.();
    state.release = undefined;
    calls.remove(state);
  }

  // ── tap 3종(tool_execution_*) ─────────────────────────────────────────
  // 탭 지점은 실패해도 기록하고 계속한다. payload는 시크릿을 가린 값이다.

  async function tapStart(run: ToolRunContext, call: AgentToolCall): Promise<void> {
    try {
      await deps.ext.dispatch(
        "tool.execution.before",
        {
          toolCallId: call.id,
          toolName: call.name,
          args: deps.redactor.maskDeep(call.arguments).value,
        },
        {
          threadId: run.threadId,
          dispatchKey: `${run.stepId}:tool.execution.before:${call.id}`,
          ...skipOwnOf(run),
        },
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
          ...skipOwnOf(run),
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
        {
          threadId: run.threadId,
          dispatchKey: `${run.stepId}:tool.execution.after:${call.id}`,
          ...skipOwnOf(run),
        },
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

  /**
   * `tool.call.before`의 합쳐진 결정을 해석한다(M5e 스펙 §4.2). 막기는 거부, 결과 대신 주기는 실행 없이 그 결과를 기록하고
   * (정책과 승인과 `tool.result`를 건너뛴다), 묻기는 승인 카드를 거쳐 정책으로 이어진다. 결정이 없으면 정책이 그대로 판정한다
   */
  async function dispatchToolCall(
    state: CallState,
    signal: AbortSignal,
  ): Promise<ToolCallHookVerdict> {
    const { run, toolCallId } = state;
    try {
      const outcome = await deps.ext.dispatch("tool.call.before", callInfo(state), {
        threadId: run.threadId,
        dispatchKey: `${run.stepId}:tool.call.before:${toolCallId}`,
        signal,
        ...skipOwnOf(run),
      });
      const decision = outcome.decision;
      if (decision === undefined) return { kind: "none" };
      const extension = outcome.decidedBy?.extension ?? null;
      if ("ask" in decision) {
        return {
          kind: "ask",
          ask: {
            extension: extension ?? UNKNOWN_EXTENSION,
            reason: askReasonOf(decision.reason),
          },
        };
      }
      if ("replace" in decision) {
        const details = replacedDetails(decision.replace.details, extension);
        state.facts.blockedBy = blockedByOf("tool.call.before", outcome.decidedBy);
        return {
          kind: "closed",
          denied: {
            reason: decision.reason,
            terminate: false,
            details,
            kind: "denied",
            resolvedBy: undefined,
            replaced: {
              content: decision.replace.content,
              details,
              isError: decision.replace.isError === true,
            },
            verdict: "replaced_hook",
          },
        };
      }
      // 대체된 결정(실패·시간 초과·스키마 위반)은 핸들러가 던진 것과 같은 "오류" 거부다. 모델 본문은 두 경우 모두 그대로 둔다
      state.facts.blockedBy = blockedByOf("tool.call.before", outcome.decidedBy);
      if (outcome.substituted) {
        return {
          kind: "closed",
          denied: judged(
            denied(
              `[fresnel:denied_by_extension] ${decision.reason}`,
              decision.terminate === true,
              hookDenialDetails("threw", extension, null),
            ),
            "blocked_hook_fault",
          ),
        };
      }
      return {
        kind: "closed",
        denied: judged(
          denied(
            `[fresnel:denied_by_extension] ${decision.reason}`,
            decision.terminate === true,
            hookDenialDetails("blocked", extension, decision.reason),
            "blocked",
          ),
          "blocked_hook",
        ),
      };
    } catch (error) {
      // 디스패처 자체의 실패도 거부다(fail-closed, L1.tools.spec §5 사례 3)
      warn("tools.tool_call_dispatch_failed", { toolCallId, message: messageOf(error) });
      state.facts.blockedBy = blockedByOf("tool.call.before", null);
      return {
        kind: "closed",
        denied: judged(
          denied(
            `[fresnel:denied_by_extension] ${FIRST_DENY["tool.call.before"].reason}`,
            false,
            hookDenialDetails("threw", null, null),
            "blocked",
          ),
          "blocked_hook_fault",
        ),
      };
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
        ...skipOwnOf(run),
      });
      const decision = outcome.decision;
      if (decision === undefined) return undefined;
      // 대체된 결정(핸들러 실패·시간 초과·스키마 위반)은 `tool.call.before`와 같이 `threw`로 적는다. 모델 본문은 두 경우 모두 그대로다
      const extension = outcome.decidedBy?.extension ?? null;
      state.facts.blockedBy = blockedByOf("guard.tool.before", outcome.decidedBy);
      if (outcome.substituted) {
        return judged(
          denied(
            `[fresnel:denied_by_guard] ${decision.reason}`,
            false,
            guardDenialDetails("threw", extension, null),
            "blocked",
          ),
          "blocked_guard_fault",
        );
      }
      return judged(
        denied(
          `[fresnel:denied_by_guard] ${decision.reason}`,
          false,
          guardDenialDetails("blocked", extension, decision.reason),
          "blocked",
        ),
        "blocked_guard",
      );
    } catch (error) {
      warn("tools.guard_dispatch_failed", { toolCallId, message: messageOf(error) });
      state.facts.blockedBy = blockedByOf("guard.tool.before", null);
      return judged(
        denied(
          `[fresnel:denied_by_guard] ${FIRST_DENY["guard.tool.before"].reason}`,
          false,
          guardDenialDetails("threw", null, null),
          "blocked",
        ),
        "blocked_guard_fault",
      );
    }
  }

  // ── 5b·5c 정책과 승인 ─────────────────────────────────────────────────

  /**
   * 드래프트 카드가 걸리는 표지(L1.tools.spec §4.6.1 [결정: 2026-11-18 사용자, AGE-56]). 호출한 대화가 드래프트 승인 `auto`인 테스트 실행이면
   * 없다(`undefined`). 판정(3번)과 승인 상속 금지(4번)는 이 값으로 정한다. 카드 제목과 본문의 출처 표지는 `state.draft`를 그대로 쓴다.
   */
  function draftGateOf(draft: DraftMark | undefined, threadId: ThreadId): DraftMark | undefined {
    if (draft === undefined) return undefined;
    return deps.draftAutoApproved?.(threadId) === true ? undefined : draft;
  }

  /** 호출한 대화가 자율 허용(`auto`) 테스트 런이고 이 ask를 허용으로 바꿀 수 있는가 */
  function autoRunAllows(decision: PolicyDecision, entry: ToolEntry, threadId: ThreadId): boolean {
    return skippable(decision, entry) && deps.draftAutoApproved?.(threadId) === true;
  }

  /** 이 호출이 드래프트 스크립트이고 이 대화(또는 부모 대화)에서 같은 열쇠의 카드를 이미 허용했는가. 읽지 못하면 아니다(다시 묻는다) */
  async function scriptRememberedIn(entry: ToolEntry, threadId: ThreadId): Promise<boolean> {
    if (entry.scriptRuleId === undefined) return false;
    const found = await approvals.remembered?.(threadId, entry.scriptRuleId);
    return found?.ok === true && found.value;
  }

  /**
   * 정책 판정과 승인. `hookAsk`는 `tool.call.before`가 낸 묻기다. 정책 deny는 훅이 있어도 deny다(H-1). 정책이 allow거나 ask면
   * 카드는 하나만 열고 두 사유를 싣는다(H-3). 훅이 물었으면 정책의 무인 거부를 쓰지 않고 승인 서비스가 무인 정책을 따른다(E-1)
   */
  async function decide(
    state: CallState,
    argsPayload: JsonObject | BlobRef,
    argsHash: string,
    hookAsk: HookAsk | undefined,
    signal: AbortSignal,
  ): Promise<Denied | undefined> {
    const { run, entry, toolCallId } = state;
    const config = deps.config(run.threadId);
    // 드래프트 카드가 걸리는 표지. `auto` 대화의 드래프트 호출은 모드·규칙·위험 등급 평가만 받는다(L1.tools.spec §4.6.1)
    // 드래프트 스크립트는 이 테스트 런에서 이미 허용한 적이 있으면(`scriptRuleId`, 이 대화나 부모 대화의 기억 범위 `thread`) 카드를 건너뛴다(AGE-58 [제안])
    const scriptRemembered = await scriptRememberedIn(entry, run.threadId);
    const cardDraft = scriptRemembered ? undefined : draftGateOf(state.draft, run.threadId);
    // 읽기 전용 샌드박스 상한 아래에서는 도구가 선언한 샌드박스 위험 등급을 쓴다(대체 항목은 제외한다)
    const sandboxRisk =
      run.ceiling?.sandbox === "read-only" && entry.replacesBuiltin !== true
        ? entry.riskUnderReadOnlySandbox
        : undefined;
    const input: PolicyInput = {
      action: "tool.call",
      tool: entry.name,
      ...(entry.capability === undefined ? {} : { capability: entry.capability.id }),
      ...(entry.mcpServer === undefined ? {} : { mcpServer: entry.mcpServer }),
      classes: entry.classes,
      risk: sandboxRisk ?? entry.risk,
      args: state.args,
      caller: run.caller,
      depth: run.depth,
      mode: config.mode,
      // 무인 정책이 기다리는 쪽이면 ask를 거부로 바꾸지 않고 승인 요청으로 보낸다(M3-REQ-73).
      // 훅이 물은 호출도 같다: 답할 수 없을 때의 거부는 승인 서비스의 무인 정책이 정한다(M5e 스펙 §4.2, E-1)
      interactive:
        hookAsk !== undefined ||
        run.interactive ||
        !unattendedPlan(run, config.unattended, deps.clock.now()).silent,
      // 저장소가 고른 bypass는 내장 도구 대체에 쓰지 않는다. 대체에서는 bypass가 금지된 것으로 평가한다(L1.tools.spec §4.13)
      bypassAllowed:
        entry.replacesBuiltin === true && config.modeFromRepository ? false : config.bypassAllowed,
    };
    // 샌드박스 위험 등급이 read로 내려간 호출은 빌트인 ask를 주지 않는 판정을 쓴다(engine.ts evaluateReadOnlySandboxed)
    const evaluate = sandboxRisk === "read" ? evaluateReadOnlySandboxed : evaluatePolicy;
    const evaluated =
      entry.replacesBuiltin === true
        ? evaluateReplacement(input, config.rules)
        : evaluate(input, config.rules);
    // 자식 대화는 부모 관점과 정의 제한을 합친 결정과 일반 평가 중 엄격한 쪽이다(L1.tools.spec §4.5 ceiling 단계, TL-13)
    const composed =
      run.ceiling === undefined
        ? evaluated
        : stricter(
            childDecision(
              evaluate,
              input,
              run.ceiling,
              { caller: run.caller, depth: run.depth, mode: config.mode },
              config.rules,
            ),
            evaluated,
          );
    // 초안 출신 호출은 거부 판정만 남기고 모두 묻는다. 호출한 대화가 `auto`면 이 판정을 건너뛴다(L1.tools.spec §4.6.1 3).
    // 모드와 allow 규칙을 뒤집는 자리라 모든 평가기의 결정 뒤에 둔다
    const decision = cardDraft === undefined ? composed : evaluateDraft(composed, input);
    state.facts.policy = { effect: decision.effect, tier: decision.tier };
    if (decision.effect === "deny") {
      // 사람이 없는 실행의 정책 거부는 묻지 않고 거부한 것이라 무인 판정이다(정본 §3.2 denied_noninteractive)
      return judged(
        denied(
          decision.message ?? `[fresnel:denied_by_policy] Tool call "${entry.name}" is denied.`,
          false,
          null,
          "denied",
          "policy",
        ),
        decision.reason === "noninteractive" ? "denied_noninteractive" : "denied_policy",
      );
    }
    if (decision.effect === "allow" && hookAsk === undefined) return undefined;
    // 자율 허용 테스트 런의 대화(자식 포함)에서는 권한 모드·내장 기본 규칙이 낸 ask를 허용으로 바꾼다(L1.tools.spec §4.6.1 [결정: 2026-11-19, 사용자, AGE-56]).
    // 거부(deny)와 훅이 낸 묻기, 사용자·managed 티어 규칙의 ask, 내장 도구 대체의 ask는 그대로 남는다. 승인 id가 없으므로 시크릿 사용 증거가 되지 않는다.
    // 어떤 호출이 자동으로 돌았는지는 정책 기록의 `tier: "auto_test_run"`으로 남는다
    const autoGrant = autoRunAllows(decision, entry, run.threadId)
      ? AUTO_TEST_RUN_TIER
      : scriptRemembered && skippable(decision, entry)
        ? SCRIPT_REMEMBERED_TIER
        : undefined;
    if (hookAsk === undefined && !config.managedRestricts && autoGrant !== undefined) {
      state.facts.policy = { effect: "allow", tier: autoGrant };
      return undefined;
    }
    // 사용자가 직접 친 명령이다. deny 규칙은 막지만 ask는 사용자 본인이 낸 명령이라 허용으로 본다.
    // 훅의 묻기도 같게 둔다(가정: 사용자가 친 명령에 확장이 다시 묻는 경로는 지금 없다)
    if (state.userShell) return undefined;
    // 바깥 도구 호출이 받은 승인을 물려받는다(U-11). 위험 등급이 그 승인 이하이면 카드를 다시 띄우지 않는다. deny와 allow는 위에서 갈렸다
    // 훅이 물은 호출은 상속하지 않는다(훅의 묻기는 그대로 사용자에게 간다). 초안 출신 호출도 상속하지 않는다(L1.tools.spec §4.6.1 4).
    // `auto` 대화의 초안 호출은 이 금지를 받지 않는다. 시크릿 사용 증거로는 쓰지 않는다(`userApprovalId`를 채우지 않는다)
    const inherit = state.inherit;
    if (
      hookAsk === undefined &&
      cardDraft === undefined &&
      inherit !== undefined &&
      riskRankOf(input.risk) <= riskRankOf(inherit.risk) &&
      !inheritUsed.has(inherit.key)
    ) {
      inheritUsed.add(inherit.key);
      state.inheritApplied = { approvalId: inherit.approvalId, key: inherit.key };
      state.facts.approval = {
        approvalId: inherit.approvalId,
        decision: "allow",
        resolvedBy: "user",
        waitMs: 0,
        inheritedFrom: inherit.approvalId,
      };
      return undefined;
    }

    const policyBase = policyTitle(entry.name, state.args);
    const policyAsked = decision.effect === "ask";
    const asked = await askUser(
      state,
      {
        argsPayload,
        argsHash,
        ruleId:
          hookAsk === undefined
            ? (entry.scriptRuleId ?? decision.ruleId)
            : `hook:${hookAsk.extension}`,
        title:
          hookAsk === undefined
            ? policyBase
            : hookAskTitle(
                policyBase,
                hookAsk,
                policyAsked ? policyLabelOf(decision.ruleId, decision.reason) : undefined,
              ),
        requestKey: requestKeyFor(toolCallId, sha256HexSync),
        // M4의 승인 기억은 요청 단위뿐이다 [결정: 2026-10-31 사용자]. 영구 허용은 사용자 규칙(`l1.tools.rules`)이다
        // 드래프트 스크립트 카드는 "이 테스트 런 동안 다시 묻지 않음"(thread) 하나를 낸다 [결정: 2026-11-19, 사용자, AGE-58]
        remember: hookAsk === undefined && entry.scriptRuleId !== undefined ? ["thread"] : ["once"],
        ...(hookAsk === undefined ? {} : { askedBy: hookAsk }),
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
    /** 훅이 낸 묻기면 그 확장과 사유. 카드 본문의 `askedBy`가 되고 무인 거부의 사유가 된다 */
    readonly askedBy?: HookAsk;
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
    // MCP 서버 도구면 서버 이름을 싣는다. 서버가 알린 성질은 표시용이라 있을 때만 싣고, 정책과 승인 결정에는 쓰지 않는다
    const mcp =
      entry.mcpServer === undefined
        ? undefined
        : {
            server: entry.mcpServer,
            ...(entry.mcpDeclared === undefined ? {} : { declared: entry.mcpDeclared }),
          };
    // 초안이면 제목 앞에 표지 문장을 둔다(정책 카드와 시크릿 사용 카드 모두). 제목은 120자로 잘리므로 표지가 잘리지 않게 앞에 둔다
    const titled =
      state.draft === undefined
        ? input.title
        : `Draft plugin "${state.draft.plugin}" asks. ${input.title}`;
    const request: ApprovalRequestInput = {
      origin,
      requestKey: input.requestKey,
      title: titled.slice(0, 120),
      body: {
        kind: "tool",
        tool: {
          toolName: entry.name,
          ...(entry.capability === undefined ? {} : { capability: entry.capability }),
          risk: entry.risk,
          args: input.argsPayload,
          argsHash: input.argsHash,
          ruleId: input.ruleId,
          ...(mcp === undefined ? {} : { mcp }),
          ...(input.askedBy === undefined ? {} : { askedBy: input.askedBy }),
          // 초안 출신 호출의 카드(시크릿 사용 카드 포함)는 표지를 싣는다(L1.tools.spec §4.6.1)
          ...(state.draft === undefined ? {} : { draft: state.draft }),
        },
      },
      remember: input.remember,
    };
    const waitStart = deps.clock.now();
    const answered = await approvals.request(request, signal);
    if (!answered.ok) {
      return denied(
        `[fresnel:tools.commit_failed] ${describeFailure(answered.error)}`,
        false,
        null,
        "storage",
      );
    }
    const resolution = answered.value;
    state.facts.approval = {
      approvalId: resolution.approvalId,
      decision: resolution.decision,
      resolvedBy: resolution.resolvedBy,
      waitMs: Math.max(0, deps.clock.now() - waitStart),
      inheritedFrom: null,
    };
    if (resolution.decision === "allow") {
      return { approvalId: resolution.approvalId, byUser: resolution.resolvedBy === "user" };
    }
    if (resolution.resolvedBy === "cancelled" && signal.aborted) {
      // 턴 취소는 대기 중인 요청을 cancelled로 닫는다(L1.tools.spec §4.7 8번)
      await approvals.cancel(resolution.approvalId, "turn aborted");
    }
    const verdict = verdictOfResolution(resolution.resolvedBy, signal.aborted);
    if (input.askedBy !== undefined && resolution.resolvedBy === "noninteractive") {
      // 훅이 물었는데 답할 사람이 없다(M5e 스펙 §4.2, E-1). 모델에는 확장의 사유와 확인 불가 표지를 한 줄로 준다
      return judged(
        denied(
          `[fresnel:denied_by_extension] ${input.askedBy.reason} (confirmation unavailable)`,
          false,
          hookAskDenialDetails(input.askedBy),
          "denied",
          resolvedByOf(resolution.resolvedBy),
        ),
        verdict,
      );
    }
    return judged(
      denied(
        denialReason(resolution),
        false,
        denialDetails(resolution),
        "denied",
        resolvedByOf(resolution.resolvedBy),
      ),
      verdict,
    );
  }

  // ── 5c' 시크릿 사용 승인(L1.tools.spec §4.12) ────────────────────────────

  /**
   * 호출이 `secretEnv`로 시크릿을 쓰면 `fresnel.secrets.check`가 `needs_approval`을 낼 때 승인 증거를 만든다. 이 호출의 정책 승인을 사용자가
   * 방금 허용했으면 그 승인이 실행마다의 승인(U-19)이라 같은 승인을 증거로 쓴다. 아니면(규칙이 허용, 모드가 허용, thread 기억) 시크릿 사용을 따로 묻는다
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
    if (verdict.kind === "denied") {
      return judged(denied(verdict.reason, false, null, "denied", "policy"), "denied_policy");
    }
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
      // 사람이 본 프롬프트(secretUseTitle)가 가리킨 핸들과 목적에만 쓴다(L0.secrets.spec §4.2 6번)
      handles: verdict.handles,
      purpose: verdict.purpose,
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
      ...(state.inheritApplied === undefined ? {} : { inheritedApproval: state.inheritApplied }),
    };
    const committed = commitWithRetry(
      deps.session,
      intentRequest(kit, { run, key: state.key, intent }),
    );
    if (!committed.ok) {
      return denied(
        `[fresnel:tools.commit_failed] ${describeFailure(committed.failure)}`,
        false,
        null,
        "storage",
      );
    }
    if (!committed.result.replayed) {
      state.intent = { effectId: intent.effectId, itemId: intent.itemId };
      return undefined;
    }
    // 같은 키의 의도가 이미 커밋되어 있었다. 저장된 효과의 id를 이어 쓴다
    const open = deps.session.query.openEffects(run.threadId);
    if (!open.ok) {
      return denied(
        `[fresnel:tools.commit_failed] session read failed: ${open.error.kind}`,
        false,
        null,
        "storage",
      );
    }
    const stored = open.value.find((effect) => effect.toolCallId === toolCallId);
    if (stored === undefined) {
      return denied(
        "[fresnel:tools.commit_failed] the stored effect.intent is already settled",
        false,
        null,
        "storage",
      );
    }
    state.intent = { effectId: stored.effectId, itemId: intent.itemId };
    return undefined;
  }

  // ── 효과 없이 닫는 호출의 결과 기록 ────────────────────────────────────

  /**
   * 효과(intent) 없이 끝난 호출의 결과를 toolResult item 하나로 기록한다. 시크릿 마스킹을 거친다. 오류 표지는 결과의 `isError`를 따른다
   * (거부와 실행 전 닫기는 참이고, 훅의 결과 대신 주기는 훅이 정한 값이다).
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
      /** 추적 맥락과 판정(읽기 전용 기록). 결과 값은 이 함수가 채운다 */
      readonly trace: TraceInput;
    },
  ): Promise<ToolCallOutcome> {
    const hits = new Map<string, number>();
    const masked = maskResult(deps.redactor, input.result);
    addHits(hits, masked.hits);
    const isError = input.result.isError === true;
    const result = asAgentResult({ ...masked.result, isError });
    const now = deps.clock.now();
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: result.content,
      isError,
      timestamp: now,
      ...(result.details === undefined || result.details === null
        ? {}
        : { details: result.details }),
    };
    const itemId = deps.ids.next("itm");
    // 조용한 호출(사용자 셸, 플러그인 호출)은 항목 초안을 만들지 않는다. 턴 없는 맥락의 초안 생성기는 쓰이지 않는다
    const draft =
      input.silent === true ? undefined : itemDraftOf({ run, itemId, effectId: null, message });
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
      isError,
      message,
      itemId: recorded,
    };
    traceClosed({
      ...input.trace,
      exec: execOf(input.trace.callState, isError, null),
      result: resultOf(result.content, { isError, truncated: false, itemId: recorded }),
    });
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
    return prepareCall(call, run, { userShell: false, silent: false });
  }

  /**
   * `userShell`은 사용자가 직접 친 셸 명령(runUserShell)이라 정책 ask를 묻지 않는다. `silent`는 toolResult item을 쓰지 않는다
   * (사용자 셸과 플러그인 기능 호출)
   */
  async function prepareCall(
    call: AgentToolCall,
    run: ToolRunContext,
    flags: { readonly userShell: boolean; readonly silent: boolean },
  ): Promise<CallPreparation> {
    await tapStart(run, call);
    const origin = originOfRun(run, call.id, flags.userShell ? "command" : null);
    const traceOf = (
      verdict: ToolCallVerdict | undefined,
      entry: ToolEntry | undefined,
      callState?: CallState,
    ): TraceInput => ({
      origin,
      tool: call.name,
      args: callState?.args ?? call.arguments,
      entry,
      callState,
      verdict,
    });
    const settleWith = async (
      result: RawToolResult,
      trace: TraceInput,
    ): Promise<CallPreparation> => ({
      kind: "settled",
      outcome: await recordWithoutEffect(run, call, {
        state: "rejected",
        result,
        silent: flags.silent,
        trace,
      }),
    });
    const settle = (
      reason: string,
      verdict: ToolCallVerdict,
      entry: ToolEntry | undefined,
    ): Promise<CallPreparation> =>
      settleWith(rejectedResult(reason, false), traceOf(verdict, entry));

    const entry = registry.view(deps.exposureOf?.(run.threadId)).get(call.name);
    if (entry === undefined) {
      return settle(
        `[fresnel:tool_unavailable] Tool ${call.name} is not available.`,
        "unavailable",
        undefined,
      );
    }
    const checked = validateToolArguments(entry.parameters, call);
    if (!checked.ok) return settle(checked.error.message, "invalid_args", entry);

    const state: CallState = {
      threadId: run.threadId,
      toolCallId: call.id,
      origin,
      facts: newCallTraceFacts(),
      key: commitKeyPart(call.id, sha256HexSync),
      run,
      entry,
      args: checked.value,
      intent: undefined,
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      userShell: flags.userShell,
      silent: flags.silent,
      draft: draftOfCall(deps.draftOf, [entry.owner]),
      slot: undefined,
      userApprovalId: undefined,
      secretApproval: null,
      sandboxBypass: undefined,
      attempt: 0,
      updates: 0,
      maskedHits: new Map(),
      release: undefined,
      settledItem: undefined,
      reported: [],
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
      verdict = denied("[fresnel:tools.internal_error] The tool call could not be prepared.");
    }
    if (verdict !== undefined) {
      forget(state);
      return settleWith(
        verdict.replaced ?? rejectedResult(verdict.reason, verdict.terminate, verdict.details),
        traceOf(verdict.verdict, entry, state),
      );
    }
    return { kind: "ready", call: { toolCall: call, args: checked.value } };
  }

  /** tool_call 지점 → 정책·승인 → 중단 확인 → effect.intent. 막히면 이유를 돌려준다 */
  async function gate(state: CallState, signal: AbortSignal): Promise<Denied | undefined> {
    const hook = await dispatchToolCall(state, signal);
    if (hook.kind === "closed") return hook.denied;

    const argsPayload = inlineOrBlob(state.args);
    if (argsPayload === undefined) {
      return denied(
        "[fresnel:tools.commit_failed] the tool arguments could not be stored",
        false,
        null,
        "storage",
      );
    }
    const argsHash = await argsHashOf(state.args);
    const verdict = await decide(
      state,
      argsPayload,
      argsHash,
      hook.kind === "ask" ? hook.ask : undefined,
      signal,
    );
    if (verdict !== undefined) return verdict;
    const secretVerdict = await approveSecretUse(state, argsPayload, argsHash, signal);
    if (secretVerdict !== undefined) return secretVerdict;
    const guardVerdict = await dispatchGuard(state, signal);
    if (guardVerdict !== undefined) return guardVerdict;
    // 의도를 쓰기 전에 중단을 확인한다. 의도가 있는 호출은 실행 전이라도 settleRejected가 효과 결과로 닫아야 한다
    if (signal.aborted)
      return judged(
        denied("[fresnel:aborted] Operation aborted", false, null, "aborted"),
        "aborted",
      );
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
        `[fresnel:tools.commit_failed] ${describeFailure(exec.failure)}`,
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
    state.facts.afterUntrusted = afterUntrusted;
    try {
      const outcome = await entry.raw({
        run,
        toolCallId: state.toolCallId,
        params,
        signal,
        onUpdate: masking,
        secretApproval: state.secretApproval,
        afterUntrusted,
        reportChanges: (values) => {
          const reported = reportedEntriesOf(values);
          state.reported.push(...reported.entries);
          if (reported.rejected > 0) {
            warn("tools.changes_rejected", {
              toolCallId: state.toolCallId,
              rejected: reported.rejected,
            });
          }
        },
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
        ...skipOwnOf(run),
      });
      return withResultPatchedBy(value, outcome.value, outcome.applied);
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

    // 시크릿 마스킹은 tool_result 지점, 경계화, blob, 커밋보다 앞이다(§4.12)
    const first = maskResult(deps.redactor, input);
    addHits(state.maskedHits, first.hits);
    const terminate = input.terminate;
    // 코어 기능 도구의 관찰 변경(F-1)은 체인에 들어가기 전에 떼어 둔다. 체인이 `details`를 지워도 남는다(F-3)
    const observed = observedEntriesOf(first.result.details, entry.capability !== undefined);
    let current = toValue(first.result, isError);
    if (!options.skipChain) {
      current = await chain(state, current, options.signal);
    }
    // `fileChanges`는 체인이 끝난 뒤에 합친다(F-3, F-4). 오류 결과도 관찰 항목을 지우지 않는다(F-6).
    // 합친 뒤에 마스킹해서 보고된 diff의 가릴 값도 가린다
    const merged = withFileChanges(current.details ?? null, observed, state.reported);
    const again = maskResult(deps.redactor, { ...fromValue(current, terminate), details: merged });
    addHits(state.maskedHits, again.hits);
    current = toValue(again.result, current.isError);

    const finalResult = fromValue(current, terminate);
    let content = finalResult.content;
    let details: JsonValue | null = isJsonValue(finalResult.details) ? finalResult.details : null;
    let blobRef: BlobRef | null;
    if (entry.outputLimits === "self") {
      blobRef = selfBlobRef(finalResult);
    } else {
      const config = deps.config(run.threadId);
      const files = deps.outputFiles;
      const bounded = boundResult(
        {
          truncator: deps.truncator,
          store: deps.store,
          ...(files === undefined
            ? {}
            : { outputPath: (sha256: string) => files.pathFor(run.threadId, sha256) }),
        },
        finalResult,
        {
          maxLines: entry.outputLimits.maxLines ?? config.output.maxLines,
          maxBytes: entry.outputLimits.maxBytes ?? config.output.maxBytes,
        },
      );
      if (files !== undefined && bounded.original !== null && bounded.bounded.blobRef !== null) {
        // 사본을 못 써도 안내의 경로는 읽는 순간 blob에서 다시 만들어진다. 기록만 남긴다
        const written = await files.write(
          run.threadId,
          bounded.bounded.blobRef.sha256,
          bounded.original,
        );
        if (!written.ok) {
          deps.logger?.warn("tools.output_file_failed", { kind: written.error.kind });
        }
      }
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
      resultItemId: state.silent ? null : resultItemId,
      output: {
        structuredContent: fitForEvent(current.structuredContent ?? null),
        terminate: terminate === true,
      },
      blobRef,
      durationMs: state.startedAt === undefined ? null : Math.max(0, now - state.startedAt),
      synthesized: false,
    };
    // 사용자 셸의 결과는 toolResult item으로 기록하지 않는다(호출한 쪽이 기록 방식을 정한다)
    const itemDraft = state.silent
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
      const text = `[fresnel:tools.commit_failed] ${describeFailure(committed.failure)}`;
      forget(state);
      const failed: AgentToolResult = {
        content: [{ type: "text", text }],
        details: { code: "tools.commit_failed" },
        isError: true,
        terminate: true,
      };
      traceClosed({
        ...traceOfState(state, options.verdict),
        exec: execOf(state, current.isError, effectResult.durationMs),
        result: resultOf(failed.content, { isError: true, truncated: false, itemId: null }),
      });
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
    const settledId = itemDraft === undefined ? null : resultItemId;
    traceClosed({
      ...traceOfState(state, options.verdict),
      exec: execOf(state, current.isError, effectResult.durationMs),
      result: resultOf(content, {
        isError: current.isError,
        truncated: blobRef !== null,
        itemId: settledId,
      }),
    });
    return { result, message, itemId: settledId };
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
        verdict: "allowed",
      });
      forget(state);
      const result = outcomeOf(call, "executed", finished);
      await tapEnd(run, call, result);
      return result;
    } catch (error) {
      forget(state);
      if (error instanceof Bug) throw error;
      // 결과를 기록하는 중 예상하지 못한 오류. 시크릿이 새지 않는 오류 결과를 돌려주고 기록하지 못한 것으로 표시한다
      deps.logger?.error("tools.after_failed", { toolCallId: call.id, message: messageOf(error) });
      const failed = await recordWithoutEffect(run, call, {
        state: "executed",
        result: rejectedResult(
          "[fresnel:tools.internal_error] The tool result could not be recorded.",
          true,
        ),
        trace: traceOfState(state, "allowed"),
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
    const entry = registry.view(deps.exposureOf?.(run.threadId)).get(intent.toolName);
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
      origin: originOfRun(run, intent.toolCallId, null),
      facts: newCallTraceFacts(),
      key: commitKeyPart(intent.toolCallId, sha256HexSync),
      run,
      entry,
      args: args ?? {},
      intent: { effectId: intent.effectId, itemId: intent.itemId },
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      userShell: false,
      silent: false,
      draft: draftOfCall(deps.draftOf, [entry.owner]),
      slot: undefined,
      userApprovalId: undefined,
      secretApproval: null,
      sandboxBypass: undefined,
      attempt: execCount,
      updates: 0,
      maskedHits: new Map(),
      release: undefined,
      settledItem: undefined,
      reported: [],
    };
    calls.put(state);
    try {
      if (args === undefined) {
        const lost = errorOutcome(
          "[fresnel:tools.args_unavailable] The stored arguments of this tool call cannot be read.",
          { code: "tools.args_unavailable" },
        );
        const finished = await finishCall(state, lost.result, true, {
          signal: undefined,
          skipChain: true,
          verdict: "allowed",
        });
        return ok(outcomeOf(call, "executed", finished));
      }
      const outcome = await runCall(state, args, undefined, () => {});
      const finished = await finishCall(state, outcome.result, outcome.result.isError === true, {
        signal: undefined,
        skipChain: false,
        verdict: "allowed",
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
        {
          signal: undefined,
          skipChain: true,
          verdict: state.execCommitted ? "allowed" : verdictOfReject(reason),
        },
      );
      forget(state);
      const outcome = outcomeOf(call, reason, finished);
      remember(run, outcome);
      await tapEnd(run, call, outcome);
      return outcome;
    }
    const callState = state;
    if (state !== undefined) forget(state);
    const text = reason === "truncated" ? TRUNCATED_TEXT(call.name) : NOT_STARTED_TEXT;
    return recordWithoutEffect(run, call, {
      state: reason,
      result: { content: [{ type: "text", text }], details: null, isError: true },
      trace: {
        origin: callState?.origin ?? originOfRun(run, call.id, null),
        tool: call.name,
        args: callState?.args ?? call.arguments,
        entry: registry.view(deps.exposureOf?.(run.threadId)).get(call.name),
        callState,
        verdict: verdictOfReject(reason),
      },
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
        `[fresnel:tool_unavailable] Tool ${USER_SHELL_TOOL} is not available.`,
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
    const prepared = await prepareCall(call, run, { userShell: true, silent: true });
    if (prepared.kind === "settled") {
      // 실행 전에 닫힌 호출(정책 deny, 확장 거부, 인자 오류)은 명령이 돌지 않았다는 표지를 달아 호출한 쪽이 거부로 알아보게 한다
      return toToolResultRecord({ ...prepared.outcome.result, details: { code: "not_executed" } });
    }
    const outcome = await execute(prepared.call, () => {}, run);
    return toToolResultRecord(outcome.result);
  }

  // ── 플러그인 기능 호출(L1.tools §4.6, hooks-core-boundary §4.6·§5.3) ───────

  /** 실행 중인 플러그인 호출. 같은 키의 동시 호출은 이 결과를 함께 기다려 의도가 두 번 쓰이지 않게 한다 */
  const pluginInFlight = new Map<string, Promise<Result<ToolResultView, ToolError>>>();
  /** 끝난 플러그인 호출의 결과. 같은 프로세스 안의 재생은 실행 때와 같은 값을 돌려준다(durable 기록에는 텍스트가 없다) */
  const pluginDone = new Map<string, ToolResultView>();

  function rememberPlugin(toolCallId: string, view: ToolResultView): void {
    pluginDone.delete(toolCallId);
    pluginDone.set(toolCallId, view);
    if (pluginDone.size > CLOSED_OUTCOME_LIMIT) {
      const oldest = pluginDone.keys().next();
      if (oldest.done !== true) pluginDone.delete(oldest.value);
    }
  }

  /**
   * 대상 도구 항목. 기능 메서드는 도구 매핑(`ToolSpec.method`)으로 찾고, 없으면 정의에서 합성 항목 `cap:<기능>.<메서드>`를 만든다
   * (readOnly 메서드와 정의에 없는 메서드는 합성하지 않는다)
   */
  function pluginEntryOf(
    threadId: ThreadId,
    target: PluginCallTarget,
    draftCaller: boolean,
  ): ToolEntry | undefined {
    const view = registry.view(deps.exposureOf?.(threadId));
    if (target.kind === "tool") return view.get(target.name);
    // 초안 스크립트 실행은 초안 출신 호출에만 열린다. 검토된 플러그인의 스크립트는 이 길을 타지 않는다(AGE-58)
    if (target.kind === "script")
      return draftCaller ? scriptEntryOf(target.name, target.run, target.memoryKey) : undefined;
    const mapped = view
      .all()
      .find(
        (entry) =>
          entry.capability?.id === target.capability && entry.capability.method === target.method,
      );
    if (mapped !== undefined) return mapped;
    const def = (deps.capabilityDefs ?? []).find((candidate) => candidate.id === target.capability);
    return def === undefined
      ? undefined
      : syntheticEntryOf(def, target.method, deps.resolveCapability, bridge, draftCaller);
  }

  /** 같은 호출의 기록을 durable 저장소에서 찾는다. 의도가 없으면 none, 의도만 있으면 open, 결과가 있으면 done */
  function recordOfPluginCall(
    threadId: ThreadId,
    toolCallId: string,
  ): Result<PluginRecord, ToolError> {
    const intentRow = deps.session.query.latestEvent(
      threadId,
      "effect.intent",
      { pointer: "/toolCallId", equals: toolCallId },
      { onActiveBranch: false },
    );
    if (!intentRow.ok) {
      return err({
        kind: "storage",
        message: `[fresnel:tools.commit_failed] the plugin call record could not be read: ${intentRow.error.kind}`,
      });
    }
    if (intentRow.value === undefined) return ok({ kind: "none" });
    const intent = parse(EffectIntentSchema, intentRow.value.payload);
    if (!intent.ok) {
      return err({
        kind: "storage",
        message:
          "[fresnel:tools.commit_failed] the stored effect.intent of the plugin call is unreadable",
      });
    }
    const resultRow = deps.session.query.latestEvent(
      threadId,
      "effect.result",
      { pointer: "/effectId", equals: intent.value.effectId },
      { onActiveBranch: false },
    );
    if (!resultRow.ok) {
      return err({
        kind: "storage",
        message: `[fresnel:tools.commit_failed] the plugin call result could not be read: ${resultRow.error.kind}`,
      });
    }
    if (resultRow.value === undefined) return ok({ kind: "open" });
    const result = parse(EffectResultSchema, resultRow.value.payload);
    if (!result.ok) {
      return err({
        kind: "storage",
        message:
          "[fresnel:tools.commit_failed] the stored effect.result of the plugin call is unreadable",
      });
    }
    const structured = result.value.output === null ? null : result.value.output.structuredContent;
    return ok({ kind: "done", view: viewOfRecord(result.value.status, structured) });
  }

  /**
   * 플러그인 호출의 추적 맥락. 바깥 도구 호출이 있으면 그 턴과 단계를 잇고, 없으면(훅이나 명령에서 부른 호출) 턴 밖 호출이다
   */
  function pluginOriginOf(request: PluginCallRequest, toolCallId: string): CallTraceOrigin {
    const parent =
      request.parentToolCallId === undefined
        ? undefined
        : calls.get(request.threadId, request.parentToolCallId);
    return {
      threadId: request.threadId,
      toolCallId,
      parentToolCallId: request.parentToolCallId ?? null,
      turnId: parent?.origin.turnId ?? null,
      stepId: parent?.origin.stepId ?? null,
      caller: "plugin",
      callerPlugin: request.plugin.name,
      via: request.via,
    };
  }

  /** 상속으로 이미 쓴 `<승인 id>:<인자 해시>` 키(이 프로세스). 재시작 뒤에는 `effect.intent`의 `inheritedApproval.key`를 읽는다 */
  const inheritUsed = new Set<string>();

  /** 호스트가 사람의 결정을 실행하는 동안 켠 허용(`withHumanDecision`). 끝나면 지운다 */
  const humanGrants = new Set<HumanDecisionGrant>();

  /** 같은 키로 상속한 호출의 의도가 이미 기록됐는가. 읽기가 실패하면 쓴 것으로 본다(카드를 건너뛰지 못하게 닫는다) */
  function inheritKeyRecorded(threadId: ThreadId, key: string): boolean {
    const found = deps.session.query.latestEvent(
      threadId,
      "effect.intent",
      { pointer: "/inheritedApproval/key", equals: key },
      { onActiveBranch: false },
    );
    return !found.ok || found.value !== undefined;
  }

  /**
   * 사람이 이미 답한 승인을 이 호출이 이어받을 만한가(U-11). 승인 기록이 다음을 모두 만족할 때만 맞다.
   * - 사람이 답했다(`resolvedBy: "user"`, 도구 승인은 허용만). 훅의 답, 무인 처리, 만료, 정책 자동 허용은 승인 기록이 아니거나 사람이 아니다
   * - 같은 대화의 승인이다
   * - 승인이 가리킨 대상이다: 검토 카드는 본문 `writes`에 든 쓰기(입력 해시), 도구 승인은 그 승인을 받은 바깥 도구 호출 안의 호출이다
   * - 같은 키(승인 id와 입력 해시)를 아직 쓰지 않았다
   * 주장(`inheritApproval`)과 엔진이 아는 바깥 호출의 승인을 차례로 본다. 주장은 지어낸 값이어도 기록과 대조하므로 카드를 건너뛰지 못한다.
   * 맞지 않으면 undefined로 두고 보통의 승인을 받는다
   */
  async function inheritedOf(
    request: PluginCallRequest,
    input: JsonObject,
  ): Promise<CallState["inherit"]> {
    const outerId =
      request.parentToolCallId === undefined
        ? undefined
        : calls.get(request.threadId, request.parentToolCallId)?.userApprovalId;
    const candidates = [request.inheritApproval?.approvalId, outerId].filter(
      (id): id is string => id !== undefined,
    );
    if (candidates.length === 0 && humanGrants.size === 0) return undefined;
    const digest = await argsHashOf(input);
    // 호스트가 사람의 결정을 실행하는 동안의 호출이 그 결정이 가리킨 대상이면 이어받는다(플러그인이 고르는 값이 없다).
    // 결정은 그 결정이 실행되는 대화의, 그 결정이 허용한 플러그인의 호출에만 쓴다
    if (request.target.kind === "capability") {
      const call = { capability: request.target.capability, method: request.target.method, input };
      for (const grant of humanGrants) {
        if (grant.threadId !== request.threadId || grant.plugin !== request.plugin.name) continue;
        if (!grant.covers(call)) continue;
        const key = `${grant.id}:${digest}`;
        if (inheritUsed.has(key) || inheritKeyRecorded(request.threadId, key)) continue;
        return { approvalId: grant.id, risk: grant.risk, key };
      }
    }
    // 경로로 대조하는 승인 상속은 대화의 작업 폴더 기준 실제 경로가 필요하다. 풀 수단이 없으면 상속하지 않는다
    const pathEnv = candidates.length === 0 ? undefined : deps.pathEnvOf?.(request.threadId);
    // 기록으로 맞는 후보를 먼저 고르고, 경로 대조는 후보마다 한꺼번에 기다린다. 후보의 순서는 그대로 지킨다
    const pending: {
      readonly approvalId: string;
      readonly risk: ToolRisk;
      readonly same: Promise<boolean>;
    }[] = [];
    for (const approvalId of candidates) {
      const opened = approvals.get(approvalId);
      if (opened === undefined) continue;
      const { resolution, request: asked } = opened;
      if (resolution === null || resolution.resolvedBy !== "user") continue;
      if (asked.origin.threadId !== request.threadId) continue;
      if (pathEnv === undefined) continue;
      if (asked.body.kind === "tool") {
        // 도구 승인은 허용만 물려준다
        if (resolution.decision !== "allow") continue;
        if (asked.origin.toolCallId !== request.parentToolCallId) continue;
        // 안쪽 호출이 바깥 호출의 승인 카드가 보여 준 대상(카드 인자의 경로)과 같은 실제 파일일 때만 물려준다.
        // 경로가 없거나(셸 등) 인자가 blob으로 빠져 엔진이 읽을 수 없거나 풀 수 없으면 아니다
        pending.push({
          approvalId,
          risk: asked.body.tool.risk,
          same: samePathAsOuter(pathEnv, input, asked.body.tool.args),
        });
      } else if (asked.body.kind === "review") {
        // 검토 카드의 답(hunk 결정 `answer`, 전체 거부 `deny`)은 모두 사람의 결정이고, 되돌림은 그 결정의 결과다
        if (asked.body.review.writes?.includes(digest) !== true) continue;
        // 해시는 카드를 연 플러그인이 정한다. 사용자가 카드에서 본 파일 목록 안의 실제 파일인지 엔진이 따로 본다
        pending.push({
          approvalId,
          risk: "write",
          same: pathInCard(pathEnv, input, asked.body.review.files),
        });
      }
    }
    const verdicts = await Promise.all(pending.map((entry) => entry.same));
    for (const [index, entry] of pending.entries()) {
      if (verdicts[index] !== true) continue;
      const key = `${entry.approvalId}:${digest}`;
      if (inheritUsed.has(key) || inheritKeyRecorded(request.threadId, key)) continue;
      return { approvalId: entry.approvalId, risk: entry.risk, key };
    }
    return undefined;
  }

  /**
   * 플러그인 호출의 실행 맥락. 턴과 단계는 합성 id다(턴이 없다). 대화형 여부는 이 대화에서 진행 중인 호출의 값을 따르고 없으면 대화형이다(U-12).
   * 깊이는 올리지 않는다(무인 판정이 깊이 0만 본다)
   */
  function pluginRunOf(request: PluginCallRequest, caller: CallerId): ToolRunContext {
    // 효과 작업자는 요청 때 기록한 조건을 싣는다. 샌드박스 천장은 정책 천장으로 옮긴다(같은 모드라 더 엄격한 쪽만 남는다)
    const sandbox = request.conditions?.sandbox;
    const mode = sandbox === undefined ? undefined : deps.config(request.threadId).mode;
    return {
      threadId: request.threadId,
      turnId: deps.ids.next("trn"),
      stepId: deps.ids.next("stp"),
      caller,
      depth: 0,
      interactive:
        request.conditions?.interactive ?? calls.requesterOf(request.threadId)?.interactive ?? true,
      ...(sandbox === undefined || mode === undefined
        ? {}
        : { ceiling: { caller, depth: 0, mode, sandbox } }),
      surfaceThreadId: request.threadId,
      signal: request.signal ?? new AbortController().signal,
      drafts: {
        // 플러그인 호출은 toolResult item을 쓰지 않는다(silent). 승인 대기 체크포인트도 턴이 없어 만들지 않는다(approvals의 turnless)
        toolResultItem: () => {
          throw new Bug("tools.plugin_call_has_no_tool_result_item");
        },
        waitingCheckpoint: () => {
          throw new Bug("tools.plugin_call_cannot_wait_in_turn");
        },
      },
    };
  }

  /**
   * 플러그인 기능 호출 하나(F `ToolService.executeForPlugin`). 모델 도구 호출과 같은 순서로 대상 해석, 인자 검증, `tool.call.before`,
   * 정책, 승인, `guard.tool.before`, 의도, 실행, `tool.result`를 지난다. 호출 주체는 `plugin:<이름>`이고 결과는 대화 항목으로 남지 않는다.
   * 같은 (스코프, 요청 id)는 한 번만 실행하고 기록된 결과를 돌려준다. 의도만 있으면 `unknown_outcome`으로 두고 다시 실행하지 않는다.
   */
  async function executeForPlugin(
    request: PluginCallRequest,
  ): Promise<Result<ToolResultView, ToolError>> {
    const limit = deps.config(request.threadId).pluginCallDepth;
    if (request.hookDepth !== undefined && request.hookDepth > limit) {
      return err({
        kind: "hook_depth",
        message: `[fresnel:hook_depth] The plugin call is nested ${request.hookDepth} hook frames deep, above the limit ${limit}.`,
      });
    }
    if (!isPluginRequestId(request.requestId)) {
      return err({
        kind: "invalid_args",
        message: "[fresnel:invalid_args] The request id must be 1 to 64 characters.",
      });
    }
    const named = parse(ExtensionNameSchema, request.plugin.name);
    if (!named.ok) {
      return err({
        kind: "invalid_args",
        message: "[fresnel:invalid_args] The plugin name is not a valid extension name.",
      });
    }
    const toolCallId = pluginToolCallIdOf(request.plugin.scopeId, request.requestId, sha256HexSync);
    const running = pluginInFlight.get(toolCallId);
    if (running !== undefined) return running;
    const work = runPluginCall(request, toolCallId);
    pluginInFlight.set(toolCallId, work);
    try {
      return await work;
    } finally {
      if (pluginInFlight.get(toolCallId) === work) pluginInFlight.delete(toolCallId);
    }
  }

  async function runPluginCall(
    request: PluginCallRequest,
    toolCallId: string,
  ): Promise<Result<ToolResultView, ToolError>> {
    const cached = pluginDone.get(toolCallId);
    if (cached !== undefined) return ok(cached);
    const recorded = recordOfPluginCall(request.threadId, toolCallId);
    if (!recorded.ok) return recorded;
    if (recorded.value.kind === "open") {
      return err({
        kind: "unknown_outcome",
        message:
          "[fresnel:unknown_outcome] An earlier call with this request id was started but has no recorded result. It may have taken effect, so it is not run again.",
      });
    }
    if (recorded.value.kind === "done") {
      rememberPlugin(toolCallId, recorded.value.view);
      return ok(recorded.value.view);
    }

    const origin = pluginOriginOf(request, toolCallId);
    const entry = pluginEntryOf(
      request.threadId,
      request.target,
      deps.draftOf?.(request.plugin.scopeId) !== undefined,
    );
    if (entry === undefined) {
      const name =
        request.target.kind === "tool"
          ? request.target.name
          : request.target.kind === "script"
            ? `script_${request.target.name}`
            : `${request.target.capability}.${request.target.method}`;
      traceClosed({
        origin,
        tool: name,
        args: request.input,
        entry: undefined,
        callState: undefined,
        verdict: "unavailable",
        exec: null,
        result: null,
      });
      return err({
        kind: "unavailable",
        message: `[fresnel:tool_unavailable] ${name} is not available.`,
      });
    }
    if (!isJsonObject(request.input)) {
      traceClosed({
        origin,
        tool: entry.name,
        args: request.input,
        entry,
        callState: undefined,
        verdict: "invalid_args",
        exec: null,
        result: null,
      });
      return err({
        kind: "invalid_args",
        message: "[fresnel:invalid_args] The tool input must be a JSON object.",
      });
    }
    const call: AgentToolCall = {
      type: "toolCall",
      id: toolCallId,
      name: entry.name,
      arguments: request.input,
    };
    const checked = validateToolArguments(entry.parameters, call);
    if (!checked.ok) {
      traceClosed({
        origin,
        tool: entry.name,
        args: request.input,
        entry,
        callState: undefined,
        verdict: "invalid_args",
        exec: null,
        result: null,
      });
      return err({ kind: "invalid_args", message: checked.error.message });
    }

    // 호출한 플러그인이 초안이면 그 표지, 아니면 도구를 등록한 스코프의 표지다(L1.tools.spec §4.6.1)
    const draft = draftOfCall(deps.draftOf, [request.plugin.scopeId, entry.owner]);
    const run = pluginRunOf(request, pluginCallerOf(request.plugin.name));
    const state: CallState = {
      threadId: run.threadId,
      toolCallId,
      origin,
      facts: newCallTraceFacts(),
      key: commitKeyPart(toolCallId, sha256HexSync),
      run,
      entry,
      args: checked.value,
      intent: undefined,
      execCommitted: false,
      startedAt: undefined,
      interrupted: false,
      userShell: false,
      silent: true,
      draft,
      // 초안 출신 호출은 승인 상속을 찾지 않는다(카드를 건너뛰지 못하게 닫는다, L1.tools.spec §4.6.1 4). `auto` 대화는 찾는다
      inherit:
        draftGateOf(draft, run.threadId) === undefined
          ? await inheritedOf(request, request.input)
          : undefined,
      inheritApplied: undefined,
      slot: undefined,
      userApprovalId: undefined,
      secretApproval: null,
      sandboxBypass: undefined,
      attempt: 0,
      updates: 0,
      maskedHits: new Map(),
      release: undefined,
      settledItem: undefined,
      reported: [],
    };
    calls.put(state);
    await tapStart(run, call);
    let verdict: Denied | undefined;
    try {
      verdict = await gate(state, run.signal);
    } catch (error) {
      if (error instanceof Bug) {
        forget(state);
        throw error;
      }
      deps.logger?.error("tools.before_failed", {
        toolCallId,
        message: messageOf(error),
      });
      verdict = denied(
        "[fresnel:tools.internal_error] The tool call could not be prepared.",
        false,
        null,
        "storage",
      );
    }
    if (verdict !== undefined) {
      // 카드를 건너뛰었어도 실행 전에 막혔으면 그 승인을 쓰지 않은 것이다(의도가 없으면 기록도 없다)
      if (state.inheritApplied !== undefined && state.intent === undefined) {
        inheritUsed.delete(state.inheritApplied.key);
      }
      forget(state);
      // 실행 전에 막힌 호출은 효과가 없으므로 기록하지 않고 끝 tap만 낸다
      await recordWithoutEffect(run, call, {
        state: "rejected",
        result:
          verdict.replaced ?? rejectedResult(verdict.reason, verdict.terminate, verdict.details),
        silent: true,
        trace: traceOfState(state, verdict.verdict),
      });
      // 훅이 낸 결과로 바꾼 호출은 실행하지 않고 그 결과를 호출한 쪽에 준다(M5e 스펙 §4.2, 모델 호출과 같은 뜻)
      if (verdict.replaced !== undefined) {
        return ok(
          viewOfExecution(
            { content: verdict.replaced.content, details: verdict.details },
            verdict.replaced.isError === true,
          ),
        );
      }
      return err({
        kind: verdict.kind,
        message: verdict.reason,
        ...(verdict.resolvedBy === undefined ? {} : { resolvedBy: verdict.resolvedBy }),
      });
    }
    const outcome = await execute({ toolCall: call, args: checked.value }, () => {}, run);
    // 결과가 durable하게 기록됐을 때만 돌려주고 기억한다. 결과 커밋이 실패했으면 의도만 남아 같은 요청 id는 `unknown_outcome`이 된다
    const landed = recordOfPluginCall(request.threadId, toolCallId);
    if (!landed.ok) return err(landed.error);
    if (landed.value.kind !== "done") {
      return err({
        kind: "storage",
        message:
          "[fresnel:tools.commit_failed] The plugin call ran, but its result could not be recorded.",
      });
    }
    const view = viewOfExecution(outcome.result, outcome.isError);
    rememberPlugin(toolCallId, view);
    return ok(view);
  }

  async function withHumanDecision<T>(
    grant: HumanDecisionGrant,
    work: () => Promise<T>,
  ): Promise<T> {
    humanGrants.add(grant);
    try {
      return await work();
    } finally {
      humanGrants.delete(grant);
    }
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
    executeForPlugin,
    suspendWhile,
    withHumanDecision,
  };
}
