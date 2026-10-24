import { Bug, canonicalJson, parse } from "@xeon/contracts";
import { isCapabilityError } from "@xeon/contracts/capabilities";
import type {
  CallContext,
  CallOptions,
  CapabilityErrorData,
  MethodDef,
  ServiceKey,
  ToolContent,
  ToolSpec,
} from "@xeon/contracts/capabilities";
import { toReplayPolicy } from "@xeon/contracts/conversation";
import type { JsonObject, JsonValue, TextContent } from "@xeon/contracts/conversation";
import type { ScopeId, ToolResourceDef } from "@xeon/contracts/extensions";
import type {
  CapabilityToolsRegistration,
  DirectToolRegistration,
  ToolMeta,
  ToolRegistration,
} from "@xeon/contracts/services";
import { deriveRisk } from "./policy/modes.ts";
import type { RawCall, RawOutcome, RawToolResult, ToolEntry } from "./types.ts";
import { isJsonObject, isJsonValue, messageOf, sha256Hex } from "./util.ts";

// 등록(ToolRegistration, ToolResourceDef)을 도구 단위 항목(ToolEntry)으로 바꾼다.
// 능력 도구의 ToolSpec → 실행 함수는 F.capabilities.spec §4.2 환원 규칙 5단계를 따른다(L1.tools.spec §4.3).

/** 능력의 서비스 API를 얻는다. 아직 공급자가 없으면 undefined */
export type CapabilityResolver = (key: ServiceKey<unknown>) => unknown;

/** 승인 해결을 기다린 결과. resolved면 도구를 같은 입력으로 다시 부른다 */
export type InputWaitResult = "resolved" | "aborted" | "unknown";

/** `input_required` 변형이 가리키는 승인(approvalId)의 해결을 기다린다. 어댑터가 도구 호출 안에서 부른다(L1.tools.spec §4.3) */
export type InputWaiter = (approvalId: string, signal: AbortSignal) => Promise<InputWaitResult>;

/** 같은 호출에서 `input_required`를 이어 받을 수 있는 횟수. 해결된 승인을 되풀이해 가리키는 도구로 무한히 도는 것을 막는다 */
const MAX_INPUT_ROUNDS = 8;

/**
 * 출력이 승인을 기다리는 `input_required` 변형인가. 판별 필드는 `status: "input_required"`이고 L2 능력(dialog.ask, work.plans)은
 * 자기가 올린 승인의 `approvalId`를 싣는다. approvalId가 없는 변형(MCP의 `inputRequests`)은 여기서 처리하지 않고 일반 결과로 기록한다
 */
function pendingApprovalOf(output: unknown): string | undefined {
  if (!isJsonObject(output) || output["status"] !== "input_required") return undefined;
  const approvalId = output["approvalId"];
  return typeof approvalId === "string" && approvalId.length > 0 ? approvalId : undefined;
}

type MethodInvoker = (input: unknown, options: CallOptions) => Promise<unknown>;

function isMethodInvoker(value: unknown): value is MethodInvoker {
  return typeof value === "function";
}

function textBlock(text: string): TextContent {
  return { type: "text", text };
}

/** 오류 결과. 모델에는 text가 보이고 details는 UI·로그용이다 */
export function errorOutcome(
  text: string,
  details: JsonValue,
  interrupted: boolean = false,
): RawOutcome {
  return { result: { content: [textBlock(text)], details, isError: true }, interrupted };
}

function capabilityErrorDetails(data: CapabilityErrorData): JsonObject {
  return {
    capability: data.capability,
    method: data.method,
    code: data.code,
    message: data.message,
    retryable: data.retryable,
    ...(data.retryAfterMs === undefined ? {} : { retryAfterMs: data.retryAfterMs }),
    ...(data.provider === undefined ? {} : { provider: data.provider }),
    ...(data.detail === undefined ? {} : { detail: data.detail }),
  };
}

/** 서비스 호출의 멱등 키(1~64자). toolCallId에서 결정적으로 만든다 */
async function requestIdFor(toolCallId: string): Promise<string> {
  const plain = `tool:${toolCallId}`;
  if (plain.length <= 64) return plain;
  return `tool:${(await sha256Hex(toolCallId)).slice(0, 40)}`;
}

function callContext(call: RawCall): CallContext {
  return {
    threadId: call.run.threadId,
    turnId: call.run.turnId,
    toolCallId: call.toolCallId,
    caller: { kind: "model", agent: call.run.caller === "main" ? "main" : "subagent" },
  };
}

/** 기본 렌더링: content는 출력의 키 정렬 JSON 텍스트 하나, structuredContent는 출력 그대로 */
function defaultRender(output: unknown): ToolContent | undefined {
  if (!isJsonValue(output)) return undefined;
  return { content: [textBlock(canonicalJson(output))], structuredContent: output };
}

function internalOutcome(spec: ToolSpec, message: string): RawOutcome {
  return errorOutcome(`[internal] ${message}`, {
    code: "internal",
    tool: spec.name,
    method: spec.method,
    message,
  });
}

async function invokeCapability(
  registration: CapabilityToolsRegistration,
  spec: ToolSpec,
  method: MethodDef,
  resolve: CapabilityResolver,
  waitInput: InputWaiter,
  call: RawCall,
): Promise<RawOutcome> {
  const api = resolve(registration.key);
  if (api === undefined || api === null) {
    return errorOutcome(`[unavailable] Capability ${registration.def.id} has no active provider.`, {
      code: "unavailable",
      capability: registration.def.id,
      method: spec.method,
    });
  }
  const invoke: unknown = Reflect.get(Object(api), spec.method);
  if (!isMethodInvoker(invoke)) {
    return internalOutcome(spec, `service method ${spec.method} is not a function`);
  }
  const input = spec.toInput === undefined ? call.params : spec.toInput(call.params);
  const options: CallOptions = {
    signal: call.signal,
    requestId: await requestIdFor(call.toolCallId),
    context: callContext(call),
  };
  type InputStep =
    | { readonly kind: "done"; readonly output: unknown }
    | { readonly kind: "stopped"; readonly outcome: RawOutcome };
  // 도구가 승인을 올리고 `input_required`로 돌아오면 해결을 기다렸다가 같은 입력, 같은 requestId로 다시 부른다(L2.dialog.spec §4.1.2 6번).
  // 도구는 같은 requestId의 재호출에서 저장된 답으로 완료 결과를 낸다
  const settleInput = async (current: unknown, round: number): Promise<InputStep> => {
    const approvalId = pendingApprovalOf(current);
    if (approvalId === undefined) return { kind: "done", output: current };
    if (round >= MAX_INPUT_ROUNDS) {
      return {
        kind: "stopped",
        outcome: errorOutcome(
          `[xeon:input_required_loop] ${spec.name} kept asking for input after ${MAX_INPUT_ROUNDS} rounds.`,
          { code: "input_required_loop", tool: spec.name },
        ),
      };
    }
    const waited = await waitInput(approvalId, call.signal);
    if (waited === "aborted") {
      return {
        kind: "stopped",
        outcome: errorOutcome(
          "[aborted] The tool call was cancelled while waiting for the user.",
          { code: "aborted", tool: spec.name },
          true,
        ),
      };
    }
    if (waited === "unknown") {
      return {
        kind: "stopped",
        outcome: errorOutcome(
          `[xeon:approval_unknown] ${spec.name} is waiting for an approval that this runtime does not know.`,
          { code: "approval_unknown", tool: spec.name },
        ),
      };
    }
    return settleInput(await invoke.call(api, input, options), round + 1);
  };
  let output: unknown;
  try {
    const settled = await settleInput(await invoke.call(api, input, options), 1);
    if (settled.kind === "stopped") return settled.outcome;
    output = settled.output;
  } catch (error) {
    // CapabilityError만 isError 결과로 바꾼다. 그 밖의 예외는 호출자(파이프라인)가 처리한다
    if (!isCapabilityError(error)) throw error;
    return errorOutcome(
      `[${error.data.code}] ${error.data.message}`,
      capabilityErrorDetails(error.data),
      error.data.code === "aborted",
    );
  }
  const rendered: ToolContent | undefined =
    spec.toContent === undefined ? defaultRender(output) : spec.toContent(output);
  if (rendered === undefined) {
    return internalOutcome(spec, "the service output is not JSON and has no toContent");
  }
  const schema = spec.outputSchema ?? method.output;
  if (rendered.structuredContent !== undefined) {
    const checked = parse(schema, rendered.structuredContent);
    if (!checked.ok) {
      return internalOutcome(spec, `structuredContent violates the output schema of ${spec.name}`);
    }
  }
  const result: RawToolResult = {
    content: [...rendered.content],
    details: rendered.details ?? null,
    isError: false,
    ...(rendered.structuredContent === undefined
      ? {}
      : { structuredContent: rendered.structuredContent }),
  };
  return { result, interrupted: false };
}

function capabilityEntries(
  registration: CapabilityToolsRegistration,
  resolve: CapabilityResolver,
  waitInput: InputWaiter,
): readonly ToolEntry[] {
  const { def } = registration;
  return def.tools.map((spec): ToolEntry => {
    const method = def.service.methods[spec.method];
    if (method === undefined) {
      throw new Bug(
        `tools.invalid_registration: ${def.id}/${spec.name} names unknown method ${spec.method}`,
      );
    }
    const policy = registration.policy?.[spec.name];
    return {
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      outputSchema: spec.outputSchema,
      executionMode: spec.executionMode,
      ref: { capability: def.id, name: spec.name },
      capability: { id: def.id, method: spec.method },
      mcpServer: policy?.mcpServer,
      risk: deriveRisk(policy?.risk, spec.hints),
      classes: policy?.classes ?? [],
      hints: spec.hints ?? {},
      replay: spec.replay ?? "unsafe",
      exposure: registration.exposure?.[spec.name] ?? "always",
      outputLimits: registration.outputLimits?.[spec.name] ?? {},
      raw: (call) => invokeCapability(registration, spec, method, resolve, waitInput, call),
      locks: undefined,
    };
  });
}

function directEntry(registration: DirectToolRegistration): ToolEntry {
  const { tool } = registration;
  const mcpServer = registration.policy?.mcpServer;
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    outputSchema: tool.outputSchema,
    executionMode: tool.executionMode,
    ref: { capability: registration.orderKey, name: tool.name },
    capability: undefined,
    mcpServer,
    risk: deriveRisk(registration.policy?.risk, registration.hints),
    classes: registration.policy?.classes ?? [],
    hints: registration.hints ?? {},
    replay: toReplayPolicy(tool.replay),
    exposure: registration.exposure ?? (mcpServer === undefined ? "always" : "auto"),
    outputLimits: registration.outputLimits ?? {},
    raw: async (call) => {
      const result = await tool.execute(call.toolCallId, call.params, call.signal, call.onUpdate);
      // structuredContent는 outputSchema로 검증하고 위반은 internal 오류 결과로 바꾼다(L1.tools.spec §4.3)
      if (tool.outputSchema !== undefined && result.structuredContent !== undefined) {
        if (!parse(tool.outputSchema, result.structuredContent).ok) {
          return errorOutcome(
            `[internal] structuredContent violates the output schema of ${tool.name}`,
            { code: "internal", tool: tool.name },
          );
        }
      }
      return { result, interrupted: result.isError === true && call.signal.aborted };
    },
    locks: undefined,
  };
}

/** 확장 `hostOf(g).registerTool` 결과를 AgentToolResult로 바꾼다 */
function resourceResult(value: unknown): RawToolResult | undefined {
  if (typeof value === "string") return { content: [textBlock(value)], details: null };
  if (!isJsonValue(value)) return undefined;
  return {
    content: [textBlock(canonicalJson(value))],
    details: null,
    structuredContent: value,
  };
}

/** ToolsPort 등록(L1.tools.spec §3.3 register(owner, def) 변환 규칙). hints·정책·노출은 유도 규칙을 따른다 */
export function resourceEntry(owner: ScopeId, def: ToolResourceDef): ToolEntry {
  const extension = owner.split("/")[0] ?? owner;
  return {
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: def.parameters,
    outputSchema: undefined,
    executionMode: undefined,
    ref: { capability: `ext.${extension}`, name: def.name },
    capability: undefined,
    mcpServer: undefined,
    risk: deriveRisk(undefined, undefined),
    classes: [],
    hints: {},
    replay: def.replay,
    exposure: "always",
    outputLimits: {},
    raw: async (call) => {
      if (!isJsonValue(call.params)) {
        return errorOutcome("[invalid_input] The tool arguments are not JSON.", {
          code: "invalid_input",
        });
      }
      try {
        const value = await def.execute(call.params, {
          threadId: call.run.threadId,
          signal: call.signal,
        });
        const result = resourceResult(value);
        if (result === undefined) {
          return errorOutcome("[internal] The tool returned a value that is not JSON.", {
            code: "internal",
            tool: def.name,
          });
        }
        return { result, interrupted: false };
      } catch (error) {
        if (error instanceof Bug) throw error;
        return errorOutcome(
          `[tool_error] ${messageOf(error)}`,
          { code: "tool_error" },
          call.signal.aborted,
        );
      }
    },
    locks: undefined,
  };
}

export function entriesOf(
  registration: ToolRegistration,
  resolve: CapabilityResolver,
  waitInput: InputWaiter,
): readonly ToolEntry[] {
  return registration.kind === "capability"
    ? capabilityEntries(registration, resolve, waitInput)
    : [directEntry(registration)];
}

/** 항목 → 공개 메타. 도구별 한도가 없으면 호출 쪽이 넘긴 설정 한도를 쓴다 */
export function toToolMeta(
  entry: ToolEntry,
  defaults: { readonly maxLines: number; readonly maxBytes: number },
): ToolMeta {
  return {
    name: entry.name,
    label: entry.label,
    ref: entry.ref,
    ...(entry.capability === undefined ? {} : { capability: entry.capability }),
    ...(entry.mcpServer === undefined ? {} : { mcpServer: entry.mcpServer }),
    risk: entry.risk,
    classes: entry.classes,
    hints: entry.hints,
    replay: entry.replay,
    ...(entry.executionMode === undefined ? {} : { executionMode: entry.executionMode }),
    exposure: entry.exposure,
    outputLimits:
      entry.outputLimits === "self"
        ? "self"
        : {
            maxLines: entry.outputLimits.maxLines ?? defaults.maxLines,
            maxBytes: entry.outputLimits.maxBytes ?? defaults.maxBytes,
          },
  };
}
