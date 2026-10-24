import {
  InMemoryTransport,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type JSONRPCRequest,
} from "@modelcontextprotocol/client";
import { attemptAsync, detach, parse, parseJson } from "@xeon/contracts";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import { Type } from "typebox";
import type { TransportHandle } from "../adapter.ts";
import { asJsonObject, asJsonValue, jsonObjectOr, stringOf } from "../json.ts";

// 인메모리 전송 위에서 JSON-RPC를 직접 말하는 MCP 서버 스텁이다(L2.mcp.plan §2 testing/stub-server.ts).
// SDK에 서버 패키지가 없어도 2025("legacy")와 2026("modern") 두 시대의 와이어를 흉내 낸다.
// 테스트와 다른 패키지의 테스트(@xeon/cap-mcp/testing)가 쓴다.

export type StubEra = "legacy" | "modern";

export const STUB_MODERN_VERSION = "2026-07-28";
export const STUB_LEGACY_VERSION = "2025-11-25";

/** 도구 핸들러에 넘기는 호출 정보. 라운드는 inputResponses가 있으면 2 이상이다 */
export interface StubCall {
  readonly name: string;
  readonly arguments: JsonObject;
  readonly inputResponses: JsonObject | undefined;
  readonly requestState: string | undefined;
}

export type StubOutcome =
  | {
      readonly kind: "complete";
      readonly content: readonly JsonValue[];
      readonly structuredContent?: JsonValue;
      readonly isError?: boolean;
    }
  | {
      readonly kind: "input_required";
      readonly inputRequests?: JsonObject;
      readonly requestState?: string;
    }
  /** JSON-RPC 오류 응답 */
  | { readonly kind: "rpc_error"; readonly code: number; readonly message: string }
  /** 응답하지 않는다(취소·제한 시간 시험) */
  | { readonly kind: "never" };

export interface StubTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: JsonObject;
  readonly annotations?: JsonObject;
  readonly handle?: (call: StubCall) => StubOutcome | Promise<StubOutcome>;
}

export interface StubPrompt {
  readonly name: string;
  readonly description?: string;
  readonly arguments?: readonly { name: string; description?: string; required?: boolean }[];
  readonly handle?: (args: JsonObject) => JsonValue[] | Promise<JsonValue[]>;
}

export interface StubResource {
  readonly uri: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly text?: string;
}

export interface StubServerOptions {
  readonly era: StubEra;
  readonly tools?: readonly StubTool[];
  readonly prompts?: readonly StubPrompt[];
  readonly resources?: readonly StubResource[];
  /** 참이면 연결 협상(initialize, server/discover)에 응답하지 않는다 */
  readonly silentHandshake?: boolean;
}

export interface StubRequest {
  readonly method: string;
  readonly params: JsonObject;
  /** 이 요청을 받은 연결 번호(1부터) */
  readonly connection: number;
}

type StubReply =
  | { readonly kind: "result"; readonly id: string | number; readonly result: JsonObject }
  | {
      readonly kind: "error";
      readonly id: string | number;
      readonly code: number;
      readonly message: string;
    };

const JsonRpcInboundSchema = Type.Union([
  Type.Object({
    id: Type.Union([Type.String(), Type.Number()]),
    method: Type.String(),
    params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
  Type.Object({ method: Type.String() }),
]);

export interface StubServer {
  /** Streamable HTTP 서버처럼 POST 하나를 처리한다. 가짜 fetch와 루프백 서버가 쓴다 */
  http(request: Request): Promise<Response>;
  /** JSON-RPC 메시지 하나를 처리해 응답 메시지를 돌려준다(전송과 상관없이). 알림과 응답하지 않는 호출은 undefined */
  reply(message: JSONRPCMessage): Promise<JSONRPCMessage | undefined>;
  /** 새 연결을 열고 클라이언트 쪽 전송을 돌려준다. 호출마다 서버 쪽 처리기가 새로 붙는다 */
  connect(): TransportHandle;
  readonly requests: readonly StubRequest[];
  readonly connectionCount: number;
  /** 도구 목록을 바꾼다. 알림은 보내지 않는다 */
  setTools(tools: readonly StubTool[]): void;
  /** 모든 연결의 서버 쪽을 닫아 클라이언트에 연결 끊김으로 보인다 */
  drop(): Promise<void>;
  /** `notifications/tools/list_changed`를 모든 연결에 보낸다 */
  notifyToolsChanged(): Promise<void>;
  /** 열려 있는 첫 연결로 서버 → 클라이언트 요청을 보내고 클라이언트의 응답을 돌려준다(2025 경로의 elicitation 시험) */
  serverRequest(method: string, params: JsonObject): Promise<StubClientReply>;
}

/** 클라이언트가 서버 요청에 돌려준 응답 */
export type StubClientReply =
  | { readonly kind: "result"; readonly result: JsonValue }
  | { readonly kind: "error"; readonly code: number; readonly message: string };

class StubRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const MODERN_RESULT_BASE = { resultType: "complete", ttlMs: 0, cacheScope: "private" } as const;

function toolWire(tool: StubTool): JsonObject {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  };
}

function promptWire(prompt: StubPrompt): JsonObject {
  return {
    name: prompt.name,
    ...(prompt.description === undefined ? {} : { description: prompt.description }),
    arguments: prompt.arguments ?? [],
  };
}

function resourceWire(resource: StubResource): JsonObject {
  return {
    uri: resource.uri,
    name: resource.name,
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
  };
}

function messageOf(reply: StubReply): JSONRPCMessage {
  return reply.kind === "result"
    ? { jsonrpc: "2.0", id: reply.id, result: reply.result }
    : { jsonrpc: "2.0", id: reply.id, error: { code: reply.code, message: reply.message } };
}

export function createStubServer(options: StubServerOptions): StubServer {
  let tools: readonly StubTool[] = options.tools ?? [];
  const prompts = options.prompts ?? [];
  const resources = options.resources ?? [];
  const recorded: StubRequest[] = [];
  const live = new Set<InMemoryTransport>();
  const awaiting = new Map<string | number, (reply: StubClientReply) => void>();
  let nextServerRequest = 1;
  let connections = 0;
  const modern = options.era === "modern";

  const capabilities: JsonObject = {
    tools: { listChanged: true },
    prompts: {},
    resources: {},
  };

  async function runTool(call: StubCall): Promise<StubOutcome> {
    const tool = tools.find((candidate) => candidate.name === call.name);
    if (tool === undefined) return { kind: "rpc_error", code: -32602, message: "unknown tool" };
    if (tool.handle === undefined) {
      return { kind: "complete", content: [{ type: "text", text: `ok ${call.name}` }] };
    }
    return await tool.handle(call);
  }

  function complete(body: JsonObject): JsonObject {
    return modern ? { resultType: "complete", ...body } : body;
  }

  function listed(body: JsonObject): JsonObject {
    return modern ? { ...MODERN_RESULT_BASE, ...body } : body;
  }

  type Handler = (params: JsonObject) => JsonObject | "never" | Promise<JsonObject | "never">;

  async function toolsCall(params: JsonObject): Promise<JsonObject | "never"> {
    const outcome = await runTool({
      name: stringOf(params["name"]) ?? "",
      arguments: jsonObjectOr(params["arguments"]),
      inputResponses: asJsonObject(params["inputResponses"]),
      requestState: stringOf(params["requestState"]),
    });
    if (outcome.kind === "never") return "never";
    if (outcome.kind === "rpc_error") throw new StubRpcError(outcome.code, outcome.message);
    if (outcome.kind === "input_required") {
      if (!modern) throw new StubRpcError(-32603, "input_required needs the 2026 era");
      return {
        resultType: "input_required",
        ...(outcome.inputRequests === undefined ? {} : { inputRequests: outcome.inputRequests }),
        ...(outcome.requestState === undefined ? {} : { requestState: outcome.requestState }),
      };
    }
    return complete({
      content: [...outcome.content],
      ...(outcome.structuredContent === undefined
        ? {}
        : { structuredContent: outcome.structuredContent }),
      ...(outcome.isError === undefined ? {} : { isError: outcome.isError }),
    });
  }

  async function promptsGet(params: JsonObject): Promise<JsonObject> {
    const name = stringOf(params["name"]);
    const found = prompts.find((prompt) => prompt.name === name);
    if (found === undefined) throw new StubRpcError(-32602, "unknown prompt");
    const messages = found.handle
      ? await found.handle(jsonObjectOr(params["arguments"]))
      : [{ role: "user", content: { type: "text", text: `prompt ${found.name}` } }];
    return complete({ messages });
  }

  function resourcesRead(params: JsonObject): JsonObject {
    const uri = stringOf(params["uri"]);
    const found = resources.find((resource) => resource.uri === uri);
    if (found === undefined) throw new StubRpcError(-32002, "resource not found");
    return listed({
      contents: [
        { uri: found.uri, mimeType: found.mimeType ?? "text/plain", text: found.text ?? "" },
      ],
    });
  }

  const handlers: Readonly<Record<string, Handler>> = {
    initialize: () => {
      if (modern) throw new StubRpcError(-32601, "Method not found");
      return {
        protocolVersion: STUB_LEGACY_VERSION,
        capabilities,
        serverInfo: { name: "stub", version: "0.0.0" },
      };
    },
    "server/discover": () => {
      if (!modern) throw new StubRpcError(-32601, "Method not found");
      return listed({ supportedVersions: [STUB_MODERN_VERSION], capabilities });
    },
    ping: () => complete({}),
    "tools/list": () => listed({ tools: tools.map(toolWire) }),
    "prompts/list": () => listed({ prompts: prompts.map(promptWire) }),
    "resources/list": () => listed({ resources: resources.map(resourceWire) }),
    "resources/read": resourcesRead,
    "prompts/get": promptsGet,
    "tools/call": toolsCall,
  };

  async function answer(request: JSONRPCRequest): Promise<JsonObject | "never"> {
    const handler = Object.hasOwn(handlers, request.method) ? handlers[request.method] : undefined;
    if (handler === undefined) {
      throw new StubRpcError(-32601, `Method not found: ${request.method}`);
    }
    return await handler(jsonObjectOr(request.params));
  }

  async function respondRequest(
    message: JSONRPCRequest,
    connection: number,
  ): Promise<StubReply | undefined> {
    const params = jsonObjectOr(message.params);
    recorded.push({ method: message.method, params, connection });
    const handshake = message.method === "initialize" || message.method === "server/discover";
    if (options.silentHandshake === true && handshake) return undefined;
    const outcome = await attemptAsync(() => answer(message));
    if (outcome.ok) {
      return outcome.value === "never"
        ? undefined
        : { kind: "result", id: message.id, result: outcome.value };
    }
    const rpc =
      outcome.error.cause instanceof StubRpcError
        ? outcome.error.cause
        : new StubRpcError(-32603, "stub failure");
    return { kind: "error", id: message.id, code: rpc.code, message: rpc.message };
  }

  /** 메시지 하나를 처리한다. 요청이면 응답을 돌려주고, 클라이언트가 보낸 응답이면 기다리던 쪽에 넘긴다 */
  async function respond(
    message: JSONRPCMessage,
    connection: number,
  ): Promise<StubReply | undefined> {
    if (isJSONRPCRequest(message)) return await respondRequest(message, connection);
    if (isJSONRPCResultResponse(message)) {
      awaiting.get(message.id)?.({ kind: "result", result: asJsonValue(message.result) ?? null });
      awaiting.delete(message.id);
    } else if (isJSONRPCErrorResponse(message) && message.id !== undefined) {
      awaiting.get(message.id)?.({
        kind: "error",
        code: message.error.code,
        message: message.error.message,
      });
      awaiting.delete(message.id);
    } else if (isJSONRPCNotification(message)) {
      recorded.push({ method: message.method, params: jsonObjectOr(message.params), connection });
    }
    return undefined;
  }

  async function deliver(
    server: InMemoryTransport,
    message: JSONRPCMessage,
    connection: number,
  ): Promise<void> {
    const reply = await respond(message, connection);
    if (reply !== undefined) await server.send(messageOf(reply));
  }

  function noteFailure(method: string, connection: number, cause: unknown): void {
    recorded.push({
      method,
      params: { reason: cause instanceof Error ? cause.message : "unknown" },
      connection,
    });
  }

  function attach(server: InMemoryTransport, connection: number): void {
    // InMemoryTransport의 콜백 속성에 처리기를 건다(DOM 이벤트 대상이 아니다)
    Object.assign(server, {
      onmessage: (message: JSONRPCMessage) => {
        // 서버 쪽이 이미 닫힌 뒤의 응답은 버린다. 기록에는 남긴다
        detach(deliver(server, message, connection), (cause) =>
          noteFailure("stub.deliver_failed", connection, cause),
        );
      },
      onclose: () => {
        live.delete(server);
      },
    });
  }

  /** Streamable HTTP 서버처럼 POST 한 번을 처리한다(가짜 fetch와 루프백 서버가 쓴다) */
  async function http(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const parsed = parseJson(await request.text());
    if (!parsed.ok) return new Response("bad json", { status: 400 });
    const message = parse(JsonRpcInboundSchema, parsed.value);
    if (!message.ok) return new Response("bad message", { status: 400 });
    if (!("id" in message.value)) return new Response(null, { status: 202 });
    const frame: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: message.value.id,
      method: message.value.method,
      ...(message.value.params === undefined ? {} : { params: message.value.params }),
    };
    const reply = await respond(frame, 0);
    if (reply === undefined) return new Response(null, { status: 202 });
    return new Response(JSON.stringify(messageOf(reply)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return {
    http,
    async reply(message) {
      const reply = await respond(message, 0);
      return reply === undefined ? undefined : messageOf(reply);
    },
    connect(): TransportHandle {
      const [client, server] = InMemoryTransport.createLinkedPair();
      connections += 1;
      live.add(server);
      attach(server, connections);
      // 서버 쪽도 시작해야 메시지를 받는다
      detach(server.start(), (cause) => noteFailure("stub.start_failed", connections, cause));
      return client;
    },
    get requests(): readonly StubRequest[] {
      return recorded;
    },
    get connectionCount(): number {
      return connections;
    },
    setTools(next: readonly StubTool[]): void {
      tools = next;
    },
    async drop(): Promise<void> {
      await Promise.all([...live].map((server) => server.close()));
    },
    serverRequest(method, params) {
      const target = [...live][0];
      if (target === undefined) {
        return Promise.resolve({ kind: "error", code: -32000, message: "no live connection" });
      }
      const id = `srv-${nextServerRequest}`;
      nextServerRequest += 1;
      const { promise, resolve } = Promise.withResolvers<StubClientReply>();
      awaiting.set(id, resolve);
      detach(target.send({ jsonrpc: "2.0", id, method, params }), (cause) =>
        noteFailure("stub.server_request_failed", connections, cause),
      );
      return promise;
    },
    async notifyToolsChanged(): Promise<void> {
      await Promise.all(
        [...live].map((server) =>
          server.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
        ),
      );
    },
  };
}
