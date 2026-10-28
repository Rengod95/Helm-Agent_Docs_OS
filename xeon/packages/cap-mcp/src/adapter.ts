import {
  Client,
  isInputRequiredResult,
  type Prompt,
  type Resource,
  type Tool,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  type Transport,
} from "@modelcontextprotocol/client";
import { attemptAsync, err, ok, type Logger, type Result } from "@xeon/contracts";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import { asJsonValue, jsonObjectOr } from "./json.ts";

// SDK 경계 어댑터(L2.mcp.spec §1.3, §4.1, L2.mcp.plan §2). `@modelcontextprotocol/client`와 zod 추론 타입은 이 파일,
// transport/, testing/ 밖으로 나가지 않는다(eng.context-map.design CM-03). 바깥은 이 파일이 내놓는 JSON 모양과
// 패키지 내부 타입만 본다.

/** SDK `Transport`. 전송을 만드는 쪽(transport/, testing/)과 어댑터만 이 타입을 안다 */
export type TransportHandle = Transport;

type VersionNegotiationSetting = "auto" | "legacy" | "pin";

/** 서버 정의가 고정하는 2026 사양 버전. `pin` 협상이 쓴다(L2.mcp.spec §6) */
const PINNED_VERSION = "2026-07-28";

type McpFailureCode =
  | "timeout"
  | "aborted"
  | "server_disconnected"
  | "protocol_error"
  | "input_rounds_exceeded"
  | "server_error"
  | "connect_failed";

/** 서버 호출 실패. 비밀 값을 담지 않는다고 가정하지 않는다: 저장 전에 호출자가 마스킹한다 */
export interface McpFailure {
  readonly code: McpFailureCode;
  readonly message: string;
  /** 서버가 돌려준 JSON-RPC 오류 코드 */
  readonly rpcCode?: number;
}

export interface RawToolAnnotations {
  readonly title?: string;
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly openWorldHint?: boolean;
}

export interface RawTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema: JsonValue;
  readonly annotations?: RawToolAnnotations;
}

export interface RawPrompt {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

interface RawResource {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly size?: number;
}

/** MRTR 연속 정보(라운드 2 이상의 재시도) */
interface RawContinuation {
  readonly inputResponses: JsonObject;
  readonly requestState: string | null;
}

export interface RawInputRequired {
  readonly kind: "input_required";
  readonly inputRequests: JsonObject;
  readonly requestState: string | null;
}

type RawToolOutcome =
  | {
      readonly kind: "complete";
      readonly content: readonly JsonValue[];
      readonly structuredContent?: JsonValue;
      readonly isError: boolean;
    }
  | RawInputRequired;

type RawPromptOutcome =
  | {
      readonly kind: "complete";
      readonly description?: string;
      readonly messages: readonly { readonly role: string; readonly content: JsonValue }[];
    }
  | RawInputRequired;

type RawReadOutcome =
  | { readonly kind: "complete"; readonly contents: readonly JsonValue[] }
  | RawInputRequired;

interface RawCallOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly continuation?: RawContinuation;
}

interface RawListOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

/** 어댑터가 바깥에 내놓는 연결. SDK 객체를 감춘다 */
export interface McpConnection {
  /** 협상된 사양 버전. 알 수 없으면 undefined */
  readonly protocolVersion: string | undefined;
  /** 서버가 선언한 능력 이름(tools, prompts, resources 등) */
  readonly serverCapabilities: readonly string[];
  listTools(options: RawListOptions): Promise<Result<readonly RawTool[], McpFailure>>;
  listPrompts(options: RawListOptions): Promise<Result<readonly RawPrompt[], McpFailure>>;
  listResources(
    cursor: string | undefined,
    options: RawListOptions,
  ): Promise<
    Result<{ readonly resources: readonly RawResource[]; readonly nextCursor?: string }, McpFailure>
  >;
  callTool(
    name: string,
    args: JsonObject,
    options: RawCallOptions,
  ): Promise<Result<RawToolOutcome, McpFailure>>;
  getPrompt(
    name: string,
    args: Readonly<Record<string, string>> | undefined,
    options: RawCallOptions,
  ): Promise<Result<RawPromptOutcome, McpFailure>>;
  readResource(uri: string, options: RawCallOptions): Promise<Result<RawReadOutcome, McpFailure>>;
  /** 연결이 끊기면 한 번 부른다. `close()`로 닫은 경우도 부른다 */
  onClose(listener: () => void): void;
  close(): Promise<void>;
}

export interface ConnectParams {
  readonly transport: TransportHandle;
  readonly negotiation: VersionNegotiationSetting;
  readonly connectTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly client: { readonly name: string; readonly version: string };
  /** 연결 실패 뒤 정리에서 생기는 오류를 남긴다 */
  readonly logger: Logger;
}

type ListedTool = Tool;
type ListedPrompt = Prompt;
type ListedResource = Resource;

// ── 오류 변환 ────────────────────────────────────────────────────────────

function failureOf(cause: unknown): McpFailure {
  if (cause instanceof SdkError) {
    const code = cause.code;
    if (code === SdkErrorCode.RequestTimeout) return { code: "timeout", message: cause.message };
    if (
      code === SdkErrorCode.ConnectionClosed ||
      code === SdkErrorCode.NotConnected ||
      code === SdkErrorCode.SendFailed
    ) {
      return { code: "server_disconnected", message: cause.message };
    }
    if (code === SdkErrorCode.InputRequiredRoundsExceeded) {
      return { code: "input_rounds_exceeded", message: cause.message };
    }
    return { code: "protocol_error", message: cause.message };
  }
  if (cause instanceof ProtocolError) {
    return { code: "server_error", message: cause.message, rpcCode: cause.code };
  }
  if (cause instanceof Error && cause.name === "AbortError") {
    return { code: "aborted", message: cause.message };
  }
  if (cause instanceof Error) return { code: "protocol_error", message: cause.message };
  return { code: "protocol_error", message: "unknown MCP failure" };
}

/** 호출하는 쪽이 신호로 취소했는데 SDK가 제한 시간 오류로 보고하는 경우가 있어 신호를 먼저 본다 */
async function run<T>(
  work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<Result<T, McpFailure>> {
  const outcome = await attemptAsync(work);
  if (outcome.ok) return ok(outcome.value);
  const failure = failureOf(outcome.error.cause);
  if (signal?.aborted === true && failure.code === "timeout") {
    return err({ code: "aborted", message: failure.message });
  }
  return err(failure);
}

function jsonOf(value: unknown): JsonValue {
  return asJsonValue(value) ?? null;
}

function inputRequiredOf(value: unknown): RawInputRequired | undefined {
  if (!isInputRequiredResult(value)) return undefined;
  return {
    kind: "input_required",
    inputRequests: jsonObjectOr(value.inputRequests),
    requestState: typeof value.requestState === "string" ? value.requestState : null,
  };
}

function continuationParams(continuation: RawContinuation | undefined): Record<string, unknown> {
  if (continuation === undefined) return {};
  return {
    inputResponses: continuation.inputResponses,
    ...(continuation.requestState === null ? {} : { requestState: continuation.requestState }),
  };
}

// ── 연결 ─────────────────────────────────────────────────────────────────

/**
 * 전송 위에서 클라이언트를 만들고 연결한다. 능력은 elicitation form·url만 선언한다(§4.1). MRTR은 수동 모드라
 * `input_required`가 호출 결과로 돌아온다(자동 처리는 재시작 뒤 이어지지 않는다).
 */
export async function connectMcp(
  params: ConnectParams,
): Promise<Result<McpConnection, McpFailure>> {
  const mode = params.negotiation === "pin" ? { pin: PINNED_VERSION } : params.negotiation;
  const client = new Client(
    { name: params.client.name, version: params.client.version },
    {
      capabilities: { elicitation: { form: {}, url: {} } },
      versionNegotiation: { mode },
      inputRequired: { autoFulfill: false },
    },
  );
  const closeListeners: (() => void)[] = [];
  // SDK Protocol의 onclose 속성에 닫힘 알림을 건다(DOM 이벤트 대상이 아니다)
  Object.assign(client, {
    onclose: () => {
      for (const listener of closeListeners) listener();
    },
  });
  const connected = await run(() =>
    client.connect(params.transport, {
      timeout: params.connectTimeoutMs,
      signal: params.signal,
    }),
  );
  if (!connected.ok) {
    const closed = await attemptAsync(() => client.close());
    if (!closed.ok) {
      params.logger.warn("mcp.close_after_failed_connect", {
        message: closed.error.cause instanceof Error ? closed.error.cause.message : "unknown",
      });
    }
    return err({
      ...connected.error,
      code: connected.error.code === "timeout" ? "timeout" : "connect_failed",
    });
  }
  return ok(wrap(client, closeListeners, params.logger));
}

function toRawTool(tool: ListedTool): RawTool {
  const annotations = tool.annotations;
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: jsonOf(tool.inputSchema),
    ...(annotations === undefined
      ? {}
      : {
          annotations: {
            ...(annotations.title === undefined ? {} : { title: annotations.title }),
            ...(annotations.readOnlyHint === undefined
              ? {}
              : { readOnlyHint: annotations.readOnlyHint }),
            ...(annotations.destructiveHint === undefined
              ? {}
              : { destructiveHint: annotations.destructiveHint }),
            ...(annotations.idempotentHint === undefined
              ? {}
              : { idempotentHint: annotations.idempotentHint }),
            ...(annotations.openWorldHint === undefined
              ? {}
              : { openWorldHint: annotations.openWorldHint }),
          },
        }),
  };
}

function toRawPrompt(prompt: ListedPrompt): RawPrompt {
  const args: RawPrompt["arguments"][number][] = [];
  for (const argument of prompt.arguments ?? []) {
    args.push({
      name: argument.name,
      ...(argument.description === undefined ? {} : { description: argument.description }),
      ...(argument.required === undefined ? {} : { required: argument.required }),
    });
  }
  return {
    name: prompt.name,
    ...(prompt.title === undefined ? {} : { title: prompt.title }),
    ...(prompt.description === undefined ? {} : { description: prompt.description }),
    arguments: args,
  };
}

function toRawResource(resource: ListedResource): RawResource {
  return {
    uri: resource.uri,
    name: resource.name,
    ...(resource.title === undefined ? {} : { title: resource.title }),
    ...(resource.description === undefined ? {} : { description: resource.description }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    ...(resource.size === undefined ? {} : { size: resource.size }),
  };
}

function callOptions(options: RawCallOptions): {
  timeout: number;
  signal: AbortSignal;
  allowInputRequired: true;
} {
  return { timeout: options.timeoutMs, signal: options.signal, allowInputRequired: true };
}

function listOptions(options: RawListOptions): {
  timeout: number;
  signal: AbortSignal;
  cacheMode: "refresh";
} {
  return { timeout: options.timeoutMs, signal: options.signal, cacheMode: "refresh" };
}

function wrap(client: Client, closeListeners: (() => void)[], logger: Logger): McpConnection {
  const capabilityNames = Object.keys(client.getServerCapabilities() ?? {});
  return {
    protocolVersion: client.getNegotiatedProtocolVersion(),
    serverCapabilities: capabilityNames,
    listTools: (options) =>
      run(async () => {
        const result = await client.listTools(undefined, listOptions(options));
        return result.tools.map(toRawTool);
      }, options.signal),
    listPrompts: (options) =>
      run(async () => {
        const result = await client.listPrompts(undefined, listOptions(options));
        return result.prompts.map(toRawPrompt);
      }, options.signal),
    listResources: (cursor, options) =>
      run(async () => {
        const result = await client.listResources(
          cursor === undefined ? undefined : { cursor },
          listOptions(options),
        );
        return {
          resources: result.resources.map(toRawResource),
          ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        };
      }, options.signal),
    callTool: (name, args, options) =>
      run(async (): Promise<RawToolOutcome> => {
        const result = await client.callTool(
          { name, arguments: args, ...continuationParams(options.continuation) },
          callOptions(options),
        );
        const pending = inputRequiredOf(result);
        if (pending !== undefined) return pending;
        return {
          kind: "complete",
          content: result.content.map(jsonOf),
          ...(result.structuredContent === undefined
            ? {}
            : { structuredContent: jsonOf(result.structuredContent) }),
          isError: result.isError === true,
        };
      }, options.signal),
    getPrompt: (name, args, options) =>
      run(async (): Promise<RawPromptOutcome> => {
        const result = await client.getPrompt(
          {
            name,
            ...(args === undefined ? {} : { arguments: { ...args } }),
            ...continuationParams(options.continuation),
          },
          callOptions(options),
        );
        const pending = inputRequiredOf(result);
        if (pending !== undefined) return pending;
        return {
          kind: "complete",
          ...(result.description === undefined ? {} : { description: result.description }),
          messages: result.messages.map(promptMessageOf),
        };
      }, options.signal),
    readResource: (uri, options) =>
      run(async (): Promise<RawReadOutcome> => {
        const result = await client.readResource(
          { uri, ...continuationParams(options.continuation) },
          callOptions(options),
        );
        const pending = inputRequiredOf(result);
        if (pending !== undefined) return pending;
        return { kind: "complete", contents: result.contents.map(jsonOf) };
      }, options.signal),
    onClose(listener) {
      closeListeners.push(listener);
    },
    async close() {
      const closed = await attemptAsync(() => client.close());
      if (!closed.ok) {
        logger.warn("mcp.close_failed", {
          message: closed.error.cause instanceof Error ? closed.error.cause.message : "unknown",
        });
      }
    },
  };
}

function promptMessageOf(message: { role: string; content: unknown }): {
  readonly role: string;
  readonly content: JsonValue;
} {
  return { role: message.role, content: jsonOf(message.content) };
}
