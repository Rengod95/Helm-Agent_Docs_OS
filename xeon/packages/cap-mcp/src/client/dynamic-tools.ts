import { assertNever } from "@xeon/contracts";
import { Type } from "typebox";
import {
  CapabilityError,
  MAX_TOOL_DESCRIPTION,
  toolOrderKey,
  TOOL_NAME_WIRE_PATTERN,
  wrapUntrustedMcp,
  type CallToolOutputValue,
  type McpContent,
  type McpContinuation,
  type McpQuestion,
  type McpToolInfo,
  type OrderedTool,
  type ToolHints,
  type ToolWire,
} from "@xeon/contracts/capabilities";
import type {
  AgentToolResult,
  ImageContent,
  InputRequiredInfo,
  JsonObject,
  JsonValue,
  ReplayPolicy,
  TextContent,
} from "@xeon/contracts/conversation";
import type { RawTool } from "../adapter.ts";
import { asJsonObject } from "../json.ts";
import { byteOrder } from "../order.ts";
import { filterTool } from "../servers/policy.ts";
import type { ServerDefinition } from "../types.ts";
import { mapAnnotations } from "./annotations.ts";
import { schemaProblem } from "./schema-check.ts";

// L2.mcp.spec §3.3~§3.4, §4.5. 서버가 광고한 도구를 모델에게 보이는 동적 도구로 만든다.

const WIRE_NAME = new RegExp(TOOL_NAME_WIRE_PATTERN);

/**
 * 기계 이름 생성. 규칙은 F.capabilities.spec §10 미결의 결정을 따른다(a 충돌 시 등록 거부, b 접두, c 충돌한 쪽만 접두).
 * 결정 전에는 서버가 광고한 이름을 그대로 쓰고 겹치면 늦게 온 쪽을 노출하지 않는다(§5 5번). 이름을 바꾸는 규칙이
 * 생기면 이 함수 하나만 고친다.
 */
export function mcpToolName(_server: string, tool: string): string {
  return tool;
}

export interface McpExecuteContext {
  readonly signal: AbortSignal;
  /** `toolCallId`에서 만든 값. 라운드마다 `#r<n>`을 붙여 쓴다 */
  readonly requestId: string;
  readonly threadId?: string;
  /** 같은 도구 호출의 다음 라운드(2 이상)에서만 있다 */
  readonly continuation?: McpContinuation;
}

/** `AgentToolResult`에 상태와 연속 정보를 더한 결과(L2.mcp.spec §3.3) */
export type McpToolResult = AgentToolResult & {
  status?: "complete" | "input_required";
  inputRequired?: InputRequiredInfo;
};

export interface McpDynamicTool {
  /** 서버 id. 정책 `resource.mcpServer`와 같은 값 */
  readonly server: string;
  /** 서버가 광고한 원래 이름 */
  readonly serverToolName: string;
  /** F.capabilities.spec §4.5 순서 키의 capability 자리 */
  readonly orderKey: `mcp.${string}`;
  readonly wire: ToolWire;
  readonly label: string;
  readonly hints: ToolHints;
  readonly replay: ReplayPolicy;
  readonly executionMode: "parallel";
  /** 신뢰하지 않은 annotations 원본 등 표시용 조각 */
  readonly details: JsonObject | undefined;
  execute(args: JsonObject, context: McpExecuteContext): Promise<McpToolResult>;
}

/** 서버 호출을 수행하는 쪽(service). 실패는 CapabilityError로 거부한다 */
export type McpToolInvoker = (
  server: string,
  tool: string,
  args: JsonObject,
  context: McpExecuteContext,
) => Promise<CallToolOutputValue>;

// ── 노출 결정 ────────────────────────────────────────────────────────────

export interface ExposureInput {
  readonly server: ServerDefinition;
  readonly tools: readonly RawTool[];
}

function annotationsOf(tool: RawTool): McpToolInfo["annotations"] {
  const a = tool.annotations;
  if (a === undefined) return undefined;
  return {
    ...(a.readOnlyHint === undefined ? {} : { readOnlyHint: a.readOnlyHint }),
    ...(a.destructiveHint === undefined ? {} : { destructiveHint: a.destructiveHint }),
    ...(a.idempotentHint === undefined ? {} : { idempotentHint: a.idempotentHint }),
    ...(a.openWorldHint === undefined ? {} : { openWorldHint: a.openWorldHint }),
  };
}

function infoOf(
  server: string,
  tool: RawTool,
  machineName: string | null,
  hiddenReason: string | undefined,
): McpToolInfo {
  const annotations = annotationsOf(tool);
  return {
    server,
    name: tool.name,
    machineName,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(annotations === undefined ? {} : { annotations }),
    exposed: machineName !== null,
    ...(hiddenReason === undefined ? {} : { hiddenReason }),
  };
}

/**
 * 서버마다 광고한 도구에서 노출할 것을 정한다. 서버 id 바이트 순으로 처리해 이름이 겹치면 뒤쪽을 숨긴다(§5 5번).
 * 걸러진 도구도 결과에 남아 `listTools`가 사유를 보인다.
 */
export function resolveExposure(
  inputs: readonly ExposureInput[],
  reserved: ReadonlySet<string>,
): ReadonlyMap<string, readonly McpToolInfo[]> {
  const ordered = inputs.toSorted((a, b) => byteOrder(a.server.id, b.server.id));
  const taken = new Set<string>(reserved);
  const result = new Map<string, readonly McpToolInfo[]>();
  for (const { server, tools } of ordered) {
    const infos: McpToolInfo[] = [];
    for (const tool of tools) {
      const verdict = filterTool(server.def, tool.name);
      if (!verdict.exposed) {
        infos.push(infoOf(server.id, tool, null, verdict.reason));
        continue;
      }
      const machine = mcpToolName(server.id, tool.name);
      if (!WIRE_NAME.test(machine)) {
        infos.push(infoOf(server.id, tool, null, "name_invalid"));
        continue;
      }
      if (schemaProblem(tool.inputSchema) !== undefined) {
        infos.push(infoOf(server.id, tool, null, "schema_invalid"));
        continue;
      }
      if (taken.has(machine)) {
        infos.push(infoOf(server.id, tool, null, "name_conflict"));
        continue;
      }
      taken.add(machine);
      infos.push(infoOf(server.id, tool, machine, undefined));
    }
    result.set(server.id, infos);
  }
  return result;
}

// ── 결과 변환 (모델용) ───────────────────────────────────────────────────

function textOf(server: string, text: string): TextContent {
  return { type: "text", text: wrapUntrustedMcp(server, text) };
}

function blobPlaceholder(sha256: string): string {
  return `blob:sha256:${sha256}`;
}

/** 서버 내용을 모델이 보는 블록으로 바꾼다. 서버가 만든 모든 텍스트는 untrusted 표지로 감싼다(§4.5) */
function renderContent(
  server: string,
  content: readonly McpContent[],
): (TextContent | ImageContent)[] {
  const out: (TextContent | ImageContent)[] = [];
  for (const block of content) {
    switch (block.type) {
      case "text":
        out.push(textOf(server, block.text));
        break;
      case "image":
        out.push({
          type: "image",
          data: blobPlaceholder(block.blob.sha256),
          mimeType: block.mimeType,
        });
        break;
      case "resource_link":
        out.push(
          textOf(
            server,
            `[resource_link] ${block.uri}${block.name === undefined ? "" : ` ${block.name}`}`,
          ),
        );
        break;
      case "resource":
        if (block.text !== undefined) out.push(textOf(server, block.text));
        else
          out.push(
            textOf(
              server,
              `[resource] ${block.uri}${block.blob === undefined ? "" : ` ${blobPlaceholder(block.blob.sha256)}`}`,
            ),
          );
        break;
      case "unsupported":
        out.push({ type: "text", text: `[지원하지 않는 내용: ${block.originalType}]` });
        break;
      default:
        return assertNever(block, "renderContent");
    }
  }
  return out;
}

function questionsDetails(questions: readonly McpQuestion[]): JsonValue {
  return questions.map((question): JsonValue => ({ ...question }));
}

/** 도구 호출 출력 → 모델 도구 결과. `input_required`는 최종 결과가 아니다(§4.6 1번) */
function toToolResult(
  server: string,
  tool: string,
  output: CallToolOutputValue,
  extra: JsonObject | undefined,
): McpToolResult {
  if (output.status === "input_required") {
    return {
      content: [
        {
          type: "text",
          text: "The MCP server needs more input from the user before it can continue.",
        },
      ],
      details: {
        server,
        tool,
        round: output.round,
        questions: questionsDetails(output.questions),
        ...extra,
      },
      status: "input_required",
      inputRequired: { inputRequests: output.inputRequests, requestState: output.requestState },
    };
  }
  const content = renderContent(server, output.content);
  return {
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    details: {
      server,
      tool,
      ...(output.truncated === undefined ? {} : { truncated: { ...output.truncated } }),
      ...extra,
    },
    ...(output.structuredContent === undefined
      ? {}
      : { structuredContent: output.structuredContent }),
    isError: output.isError,
    status: "complete",
  };
}

function failureResult(server: string, tool: string, error: CapabilityError): McpToolResult {
  return {
    content: [{ type: "text", text: `[xeon:${error.data.code}] ${error.data.message}` }],
    details: { server, tool, code: error.data.code, retryable: error.data.retryable },
    isError: true,
    status: "complete",
  };
}

// ── 도구 만들기 ──────────────────────────────────────────────────────────

/** 노출이 정해진 도구 하나를 실행 가능한 동적 도구로 만든다 */
export function createDynamicTool(
  info: McpToolInfo,
  raw: RawTool,
  server: ServerDefinition,
  invoke: McpToolInvoker,
): McpDynamicTool | undefined {
  if (info.machineName === null) return undefined;
  const mapped = mapAnnotations(
    raw.name,
    raw.title,
    raw.annotations,
    server.def.trustAnnotations === true,
  );
  const description = (raw.description ?? raw.title ?? raw.name).slice(0, MAX_TOOL_DESCRIPTION);
  return {
    server: server.id,
    serverToolName: raw.name,
    orderKey: `mcp.${server.id}`,
    wire: {
      name: info.machineName,
      description,
      // xeon-disable-next-line xeon/type-unsafe -- 서버가 준 JSON Schema는 데이터이고 정적 타입을 주장하지 않는다. 노출 전에 schemaProblem이 크기, 깊이, 외부 $ref를 검사했다 (eng.typescript.guide TY-26)
      parameters: Type.Unsafe(asJsonObject(raw.inputSchema) ?? {}),
    },
    label: mapped.label,
    hints: mapped.hints,
    replay: "unsafe",
    executionMode: "parallel",
    details: mapped.details,
    async execute(args, context) {
      try {
        const output = await invoke(server.id, raw.name, args, context);
        return toToolResult(server.id, raw.name, output, mapped.details);
      } catch (caught) {
        if (caught instanceof CapabilityError) return failureResult(server.id, raw.name, caught);
        throw caught;
      }
    },
  };
}

/** 순서와 fingerprint 계산에 쓰는 모양. 순서 키의 capability 자리는 `mcp.<서버 id>`다 */
export function orderedOf(tools: readonly McpDynamicTool[]): readonly OrderedTool[] {
  return tools
    .map((tool): OrderedTool => ({
      capability: tool.orderKey,
      name: tool.wire.name,
      wire: tool.wire,
    }))
    .toSorted(toolOrderKey);
}
