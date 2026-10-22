import {
  Type,
  type Static,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import type { SchemaProof, SchemaSound } from "../../base/index.ts";
import {
  JsonObjectSchema,
  JsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "../../conversation/index.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";
import { ImageBlobRefSchema } from "./workspace.ts";

// L2.mcp.spec §3.1~§3.2. McpService(Cordis 서비스 xeon.mcp)는 services/mcp.ts에 있다(F.capabilities.spec §3.12 규칙 7).

// ── 서버 정의 (§3.1) ───────────────────────────────────────────────────

export const MCP_SERVER_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,31}$";
export const McpServerIdSchema: TString = Type.String({ pattern: MCP_SERVER_ID_PATTERN });

/** F.wire-settings.spec §3.8.1 SecretRef 형식 */
const SecretRefParam = Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$" });
const EnvName = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" });
const HeaderName = Type.String({ pattern: "^[A-Za-z0-9-]{1,128}$" });

export type McpTransport =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      cwd?: string;
      /** 값은 secret:// 참조만. 실행 직전에 L0.secrets가 주입한다 */
      env?: Record<string, string>;
    }
  | {
      /** Streamable HTTP */
      type: "http";
      url: string;
      headers?: Record<string, string>;
      /** OAuth 사용(2차) */
      oauth?: boolean;
    }
  | {
      /** 2025 이전 서버 호환 */
      type: "sse";
      url: string;
      headers?: Record<string, string>;
    };
const mcpTransportShape = Type.Union([
  Type.Object({
    type: Type.Literal("stdio"),
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(EnvName, SecretRefParam)),
  }),
  Type.Object({
    type: Type.Literal("http"),
    url: Type.String({ pattern: "^https?://" }),
    headers: Type.Optional(Type.Record(HeaderName, SecretRefParam)),
    oauth: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    type: Type.Literal("sse"),
    url: Type.String({ pattern: "^https?://" }),
    headers: Type.Optional(Type.Record(HeaderName, SecretRefParam)),
  }),
]);
export const McpTransportSchema: TUnsafe<McpTransport> = Type.Unsafe<McpTransport>(
  mcpTransportShape satisfies SchemaSound<McpTransport, typeof mcpTransportShape>,
);

export const McpApprovalModeSchema: TUnion<
  [TLiteral<"prompt">, TLiteral<"auto">, TLiteral<"deny">]
> = Type.Union([Type.Literal("prompt"), Type.Literal("auto"), Type.Literal("deny")]);
export type McpApprovalMode = Static<typeof McpApprovalModeSchema>;

export type McpServerDef = {
  title?: string;
  transport: McpTransport;
  /** 기본 true */
  enabled?: boolean;
  tools?: {
    /** 노출할 서버 도구 이름. 없으면 전부 */
    allow?: string[];
    /** 노출하지 않을 서버 도구 이름. allow보다 우선 */
    deny?: string[];
    /** 서버 도구 이름 → 승인 모드. 없으면 l2.mcp.approvalMode */
    approval?: Record<string, McpApprovalMode>;
  };
  timeouts?: { connectMs?: number; callMs?: number };
  /** 참이면 annotations를 승인 정책 입력으로 쓴다(§3.4). 기본 false */
  trustAnnotations?: boolean;
};
const mcpServerDefShape = Type.Object({
  title: Type.Optional(Type.String({ maxLength: 80 })),
  transport: McpTransportSchema,
  enabled: Type.Optional(Type.Boolean()),
  tools: Type.Optional(
    Type.Object({
      allow: Type.Optional(Type.Array(Type.String())),
      deny: Type.Optional(Type.Array(Type.String())),
      approval: Type.Optional(Type.Record(Type.String(), McpApprovalModeSchema)),
    }),
  ),
  timeouts: Type.Optional(
    Type.Object({
      connectMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
      callMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 3600000 })),
    }),
  ),
  trustAnnotations: Type.Optional(Type.Boolean()),
});
export const McpServerDefSchema: TUnsafe<McpServerDef> = Type.Unsafe<McpServerDef>(
  mcpServerDefShape satisfies SchemaProof<McpServerDef, typeof mcpServerDefShape>,
);

// ── 능력 정의 mcp.client (§3.2) ────────────────────────────────────────

export const McpServerStateSchema: TUnion<
  [
    TLiteral<"disabled">,
    TLiteral<"connecting">,
    TLiteral<"connected">,
    TLiteral<"reconnecting">,
    TLiteral<"failed">,
    TLiteral<"blocked">,
  ]
> = Type.Union([
  Type.Literal("disabled"),
  Type.Literal("connecting"),
  Type.Literal("connected"),
  Type.Literal("reconnecting"),
  Type.Literal("failed"),
  Type.Literal("blocked"),
]);
export type McpServerState = Static<typeof McpServerStateSchema>;

export type McpServerStatus = {
  server: string;
  title?: string;
  /** 정의 출처. 예: "settings:user", "settings:project", "mcpjson:project", "ext:<확장 이름>" */
  source: string;
  state: McpServerState;
  transport: "stdio" | "http" | "sse";
  /** 협상된 사양 버전. 예: "2026-07-28", "2025-11-25" */
  protocolVersion?: string;
  toolCount: number;
  promptCount: number;
  resourceCount?: number;
  /** 비밀 값을 담지 않는다 */
  lastError?: { code: string; message: string; at: number };
  /** blocked일 때 사유: "denied_by_policy" | "not_in_allowlist" | "managed_only" | "untrusted_project" */
  blockedReason?: string;
};
const mcpServerStatusShape = Type.Object({
  server: McpServerIdSchema,
  title: Type.Optional(Type.String()),
  source: Type.String(),
  state: McpServerStateSchema,
  transport: Type.Union([Type.Literal("stdio"), Type.Literal("http"), Type.Literal("sse")]),
  protocolVersion: Type.Optional(Type.String()),
  toolCount: Type.Integer({ minimum: 0 }),
  promptCount: Type.Integer({ minimum: 0 }),
  resourceCount: Type.Optional(Type.Integer({ minimum: 0 })),
  lastError: Type.Optional(
    Type.Object({ code: Type.String(), message: Type.String(), at: Type.Integer() }),
  ),
  blockedReason: Type.Optional(Type.String()),
});
export const McpServerStatusSchema: TUnsafe<McpServerStatus> = Type.Unsafe<McpServerStatus>(
  mcpServerStatusShape satisfies SchemaProof<McpServerStatus, typeof mcpServerStatusShape>,
);

/** MRTR 연속 정보. 첫 라운드에는 두지 않는다 */
export type McpContinuation = {
  /** 이번에 보낼 라운드 번호(2부터) */
  round: number;
  /** 입력 요청 키 → 응답. 값 모양은 MCP 사양을 따른다 */
  inputResponses: JsonObject;
  /** 직전 라운드의 requestState. 바이트 그대로 돌려보낸다 */
  requestState: string | null;
};
const mcpContinuationShape = Type.Object({
  round: Type.Integer({ minimum: 2 }),
  inputResponses: JsonObjectSchema,
  requestState: Type.Union([Type.String(), Type.Null()]),
});
export const McpContinuationSchema: TUnsafe<McpContinuation> = Type.Unsafe<McpContinuation>(
  mcpContinuationShape satisfies SchemaProof<McpContinuation, typeof mcpContinuationShape>,
);

/** 입력 요청을 사람에게 묻기 위한 질문. 승인 요청 payload에 싣는다(§4.6) */
export type McpQuestion =
  | {
      key: string;
      kind: "elicitation_form";
      server: string;
      message: string;
      requestedSchema: JsonValue;
    }
  | { key: string; kind: "elicitation_url"; server: string; message: string; url: string }
  | { key: string; kind: "sampling"; server: string; summary: string };
const mcpQuestionShape = Type.Union([
  Type.Object({
    key: Type.String(),
    kind: Type.Literal("elicitation_form"),
    server: McpServerIdSchema,
    message: Type.String(),
    requestedSchema: JsonValueSchema,
  }),
  Type.Object({
    key: Type.String(),
    kind: Type.Literal("elicitation_url"),
    server: McpServerIdSchema,
    message: Type.String(),
    url: Type.String(),
  }),
  Type.Object({
    key: Type.String(),
    kind: Type.Literal("sampling"),
    server: McpServerIdSchema,
    summary: Type.String(),
  }),
]);
export const McpQuestionSchema: TUnsafe<McpQuestion> = Type.Unsafe<McpQuestion>(
  mcpQuestionShape satisfies SchemaSound<McpQuestion, typeof mcpQuestionShape>,
);

/** input_required 변형. F.conversation.spec §3.6 InputRequiredInfo에 questions와 round를 더한다 */
export type McpInputRequired = {
  status: "input_required";
  /** 응답을 받은 라운드 번호 */
  round: number;
  inputRequests: JsonObject;
  requestState: string | null;
  questions: McpQuestion[];
};
const inputRequiredShape = Type.Object({
  status: Type.Literal("input_required"),
  round: Type.Integer({ minimum: 1 }),
  inputRequests: JsonObjectSchema,
  requestState: Type.Union([Type.String(), Type.Null()]),
  questions: Type.Array(McpQuestionSchema),
});
const InputRequiredVariant: TUnsafe<McpInputRequired> = Type.Unsafe<McpInputRequired>(
  inputRequiredShape satisfies SchemaProof<McpInputRequired, typeof inputRequiredShape>,
);

/** 서버 결과 내용을 Xeon 쪽 모양으로 바꾼 것. 이미지는 blob으로 옮긴다 */
type McpBlob = Static<typeof ImageBlobRefSchema>;
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; blob: McpBlob; mimeType: string }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string }
  | { type: "resource"; uri: string; mimeType?: string; text?: string; blob?: McpBlob }
  /** audio 등 다루지 않는 종류. 모델에는 설명 텍스트로 보낸다 */
  | { type: "unsupported"; originalType: string };
const mcpContentShape = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String() }),
  Type.Object({
    type: Type.Literal("image"),
    blob: ImageBlobRefSchema,
    mimeType: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("resource_link"),
    uri: Type.String(),
    name: Type.Optional(Type.String()),
    mimeType: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal("resource"),
    uri: Type.String(),
    mimeType: Type.Optional(Type.String()),
    text: Type.Optional(Type.String()),
    blob: Type.Optional(ImageBlobRefSchema),
  }),
  Type.Object({ type: Type.Literal("unsupported"), originalType: Type.String() }),
]);
export const McpContentSchema: TUnsafe<McpContent> = Type.Unsafe<McpContent>(
  mcpContentShape satisfies SchemaSound<McpContent, typeof mcpContentShape>,
);

export type McpToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};
export type McpToolInfo = {
  server: string;
  /** 서버가 광고한 원래 이름 */
  name: string;
  /** Xeon 기계 이름(§3.3). 노출하지 않는 도구는 null */
  machineName: string | null;
  title?: string;
  description?: string;
  inputSchema: JsonValue;
  annotations?: McpToolAnnotations;
  exposed: boolean;
  /** 노출하지 않는 사유: "denied" | "not_allowed" | "name_conflict" | "name_invalid" | "schema_invalid" */
  hiddenReason?: string;
};
const mcpToolInfoShape = Type.Object({
  server: McpServerIdSchema,
  name: Type.String(),
  machineName: Type.Union([Type.String(), Type.Null()]),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  inputSchema: JsonValueSchema,
  annotations: Type.Optional(
    Type.Object({
      readOnlyHint: Type.Optional(Type.Boolean()),
      destructiveHint: Type.Optional(Type.Boolean()),
      idempotentHint: Type.Optional(Type.Boolean()),
      openWorldHint: Type.Optional(Type.Boolean()),
    }),
  ),
  exposed: Type.Boolean(),
  hiddenReason: Type.Optional(Type.String()),
});
export const McpToolInfoSchema: TUnsafe<McpToolInfo> = Type.Unsafe<McpToolInfo>(
  mcpToolInfoShape satisfies SchemaProof<McpToolInfo, typeof mcpToolInfoShape>,
);

// 메서드 입출력 ----------------------------------------------------------

/** 입력이 없는 메서드와 도구가 쓴다 */
export const ListServersInput: TObject<{}> = Type.Object({});

export type ListServersOutputValue = { servers: McpServerStatus[] };
const listServersOutputShape = Type.Object({ servers: Type.Array(McpServerStatusSchema) });
export const ListServersOutput: TUnsafe<ListServersOutputValue> =
  Type.Unsafe<ListServersOutputValue>(
    listServersOutputShape satisfies SchemaProof<
      ListServersOutputValue,
      typeof listServersOutputShape
    >,
  );

export type McpServerRef = { server: string };
const serverRefShape = Type.Object({ server: McpServerIdSchema });
export const McpServerRefSchema: TUnsafe<McpServerRef> = Type.Unsafe<McpServerRef>(
  serverRefShape satisfies SchemaProof<McpServerRef, typeof serverRefShape>,
);

export type ListToolsOutputValue = { tools: McpToolInfo[] };
const listToolsOutputShape = Type.Object({ tools: Type.Array(McpToolInfoSchema) });
export const ListToolsOutput: TUnsafe<ListToolsOutputValue> = Type.Unsafe<ListToolsOutputValue>(
  listToolsOutputShape satisfies SchemaProof<ListToolsOutputValue, typeof listToolsOutputShape>,
);

export type CallToolInputValue = {
  server: string;
  tool: string;
  arguments: JsonObject;
  continuation?: McpContinuation;
};
const callToolInputShape = Type.Object({
  server: McpServerIdSchema,
  tool: Type.String({ minLength: 1 }),
  arguments: JsonObjectSchema,
  continuation: Type.Optional(McpContinuationSchema),
});
export const CallToolInput: TUnsafe<CallToolInputValue> = Type.Unsafe<CallToolInputValue>(
  callToolInputShape satisfies SchemaProof<CallToolInputValue, typeof callToolInputShape>,
);

export type CallToolOutputValue =
  | {
      status: "complete";
      content: McpContent[];
      structuredContent?: JsonValue;
      /** 서버가 결과에 isError를 표시함 */
      isError: boolean;
      truncated?: { shownBytes: number; totalBytes: number };
    }
  | McpInputRequired;
const callToolOutputShape = Type.Union([
  Type.Object({
    status: Type.Literal("complete"),
    content: Type.Array(McpContentSchema),
    structuredContent: Type.Optional(JsonValueSchema),
    isError: Type.Boolean(),
    truncated: Type.Optional(
      Type.Object({ shownBytes: Type.Integer(), totalBytes: Type.Integer() }),
    ),
  }),
  InputRequiredVariant,
]);
export const CallToolOutput: TUnsafe<CallToolOutputValue> = Type.Unsafe<CallToolOutputValue>(
  callToolOutputShape satisfies SchemaSound<CallToolOutputValue, typeof callToolOutputShape>,
);

export type PromptInfo = {
  server: string;
  name: string;
  title?: string;
  description?: string;
  arguments: { name: string; description?: string; required?: boolean }[];
};
const promptInfoShape = Type.Object({
  server: McpServerIdSchema,
  name: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  arguments: Type.Array(
    Type.Object({
      name: Type.String(),
      description: Type.Optional(Type.String()),
      required: Type.Optional(Type.Boolean()),
    }),
  ),
});
export const PromptInfoSchema: TUnsafe<PromptInfo> = Type.Unsafe<PromptInfo>(
  promptInfoShape satisfies SchemaProof<PromptInfo, typeof promptInfoShape>,
);

export type ListPromptsOutputValue = { prompts: PromptInfo[] };
const listPromptsOutputShape = Type.Object({ prompts: Type.Array(PromptInfoSchema) });
export const ListPromptsOutput: TUnsafe<ListPromptsOutputValue> =
  Type.Unsafe<ListPromptsOutputValue>(
    listPromptsOutputShape satisfies SchemaProof<
      ListPromptsOutputValue,
      typeof listPromptsOutputShape
    >,
  );

export type GetPromptInputValue = {
  server: string;
  name: string;
  arguments?: Record<string, string>;
  continuation?: McpContinuation;
};
const getPromptInputShape = Type.Object({
  server: McpServerIdSchema,
  name: Type.String({ minLength: 1 }),
  arguments: Type.Optional(Type.Record(Type.String(), Type.String())),
  continuation: Type.Optional(McpContinuationSchema),
});
export const GetPromptInput: TUnsafe<GetPromptInputValue> = Type.Unsafe<GetPromptInputValue>(
  getPromptInputShape satisfies SchemaProof<GetPromptInputValue, typeof getPromptInputShape>,
);

export type GetPromptOutputValue =
  | {
      status: "complete";
      description?: string;
      messages: { role: "user" | "assistant"; content: McpContent }[];
    }
  | McpInputRequired;
const getPromptOutputShape = Type.Union([
  Type.Object({
    status: Type.Literal("complete"),
    description: Type.Optional(Type.String()),
    messages: Type.Array(
      Type.Object({
        role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
        content: McpContentSchema,
      }),
    ),
  }),
  InputRequiredVariant,
]);
export const GetPromptOutput: TUnsafe<GetPromptOutputValue> = Type.Unsafe<GetPromptOutputValue>(
  getPromptOutputShape satisfies SchemaSound<GetPromptOutputValue, typeof getPromptOutputShape>,
);

export type ResourceInfo = {
  server: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
};
const resourceInfoShape = Type.Object({
  server: McpServerIdSchema,
  uri: Type.String(),
  name: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  mimeType: Type.Optional(Type.String()),
  size: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const ResourceInfoSchema: TUnsafe<ResourceInfo> = Type.Unsafe<ResourceInfo>(
  resourceInfoShape satisfies SchemaProof<ResourceInfo, typeof resourceInfoShape>,
);

export type ListResourcesInputValue = {
  server?: string;
  /** 서버별 페이지 커서. 키는 서버 id */
  cursor?: Record<string, string>;
};
const listResourcesInputShape = Type.Object({
  server: Type.Optional(McpServerIdSchema),
  cursor: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export const ListResourcesInput: TUnsafe<ListResourcesInputValue> =
  Type.Unsafe<ListResourcesInputValue>(
    listResourcesInputShape satisfies SchemaProof<
      ListResourcesInputValue,
      typeof listResourcesInputShape
    >,
  );

export type ListResourcesOutputValue = {
  resources: ResourceInfo[];
  nextCursor?: Record<string, string>;
};
const listResourcesOutputShape = Type.Object({
  resources: Type.Array(ResourceInfoSchema),
  nextCursor: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export const ListResourcesOutput: TUnsafe<ListResourcesOutputValue> =
  Type.Unsafe<ListResourcesOutputValue>(
    listResourcesOutputShape satisfies SchemaProof<
      ListResourcesOutputValue,
      typeof listResourcesOutputShape
    >,
  );

export type ReadResourceInputValue = {
  server: string;
  uri: string;
  continuation?: McpContinuation;
};
const readResourceInputShape = Type.Object({
  server: McpServerIdSchema,
  uri: Type.String({ minLength: 1 }),
  continuation: Type.Optional(McpContinuationSchema),
});
export const ReadResourceInput: TUnsafe<ReadResourceInputValue> =
  Type.Unsafe<ReadResourceInputValue>(
    readResourceInputShape satisfies SchemaProof<
      ReadResourceInputValue,
      typeof readResourceInputShape
    >,
  );

export type ReadResourceOutputValue =
  | { status: "complete"; contents: McpContent[] }
  | McpInputRequired;
const readResourceOutputShape = Type.Union([
  Type.Object({ status: Type.Literal("complete"), contents: Type.Array(McpContentSchema) }),
  InputRequiredVariant,
]);
export const ReadResourceOutput: TUnsafe<ReadResourceOutputValue> =
  Type.Unsafe<ReadResourceOutputValue>(
    readResourceOutputShape satisfies SchemaSound<
      ReadResourceOutputValue,
      typeof readResourceOutputShape
    >,
  );

export type ReadResourceToolParamsValue = { server: string; uri: string };
const readResourceToolParamsShape = Type.Object({
  server: McpServerIdSchema,
  uri: Type.String({ minLength: 1 }),
});
export const ReadResourceToolParams: TUnsafe<ReadResourceToolParamsValue> =
  Type.Unsafe<ReadResourceToolParamsValue>(
    readResourceToolParamsShape satisfies SchemaProof<
      ReadResourceToolParamsValue,
      typeof readResourceToolParamsShape
    >,
  );

const MCP_ERRORS = {
  server_unknown: { description: "정의에 없는 서버 id", retryable: false },
  server_blocked: { description: "허용·차단 정책이나 관리 잠금으로 막힌 서버", retryable: false },
  server_disconnected: { description: "서버 연결이 끊겨 있음", retryable: true },
  tool_unknown: { description: "서버가 광고하지 않은 도구", retryable: false },
  input_rounds_exceeded: {
    description: "input_required 라운드가 l2.mcp.inputRequired.maxRounds를 넘음",
    retryable: false,
  },
  input_unsupported: {
    description: "서버가 선언하지 않은 입력 종류를 요청함",
    retryable: false,
  },
  protocol_error: { description: "서버 응답이 사양을 위반함", retryable: false },
} as const;

// ── 경계 감싸기와 렌더러 (순수 함수) ────────────────────────────────────

export const UNTRUSTED_MCP_OPEN: string = "<untrusted_mcp_content";
export const UNTRUSTED_MCP_CLOSE: string = "</untrusted_mcp_content>";

/**
 * 서버가 준 텍스트를 모델에 보일 때의 경계(L2.readme §5.3 표지 명명 규칙). 순수 함수.
 * 본문 안의 경계 표지는 `<`를 `&lt;`로 바꿔 무력화한 뒤 감싼다. server는 서버 id나 "resource"다.
 */
export function wrapUntrustedMcp(server: string, text: string): string {
  const neutralized = text.replace(/<(\/?untrusted_mcp_content)/gi, "&lt;$1");
  return `${UNTRUSTED_MCP_OPEN} server="${server}">\n${neutralized}\n${UNTRUSTED_MCP_CLOSE}`;
}

/** 서버 목록의 모델용 렌더링 */
export function renderServers(out: ListServersOutputValue): ToolContent {
  const lines = out.servers.map(
    (s) =>
      `${s.server} ${s.state} 도구 ${s.toolCount}개${s.lastError ? ` 오류: ${s.lastError.code}` : ""}`,
  );
  return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: out };
}

export function renderResources(out: ListResourcesOutputValue): ToolContent {
  const lines = out.resources.map((r) => `${r.server} ${r.uri}${r.title ? ` ${r.title}` : ""}`);
  return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: out };
}

function contentLine(c: McpContent): string {
  if (c.type === "text") return c.text;
  if (c.type === "resource" && c.text !== undefined) return c.text;
  return `[${c.type}]`;
}

/** 리소스 읽기 결과의 모델용 렌더링. toContent는 서버 id를 모르므로 감싸기 표지에 "resource"를 쓴다 */
export function renderRead(out: ReadResourceOutputValue): ToolContent {
  if (out.status === "input_required") {
    return {
      content: [{ type: "text", text: "서버가 추가 입력을 요구함" }],
      structuredContent: out,
    };
  }
  const parts = out.contents.map(contentLine);
  return {
    content: [{ type: "text", text: wrapUntrustedMcp("resource", parts.join("\n\n")) }],
    structuredContent: out,
  };
}

type McpMethods = {
  readonly listServers: MethodDef<typeof ListServersInput, typeof ListServersOutput>;
  readonly status: MethodDef<typeof McpServerRefSchema, typeof McpServerStatusSchema>;
  readonly connect: MethodDef<typeof McpServerRefSchema, typeof McpServerStatusSchema>;
  readonly reconnect: MethodDef<typeof McpServerRefSchema, typeof McpServerStatusSchema>;
  readonly disable: MethodDef<typeof McpServerRefSchema, typeof McpServerStatusSchema>;
  readonly listTools: MethodDef<typeof McpServerRefSchema, typeof ListToolsOutput>;
  readonly callTool: MethodDef<typeof CallToolInput, typeof CallToolOutput>;
  readonly listPrompts: MethodDef<typeof McpServerRefSchema, typeof ListPromptsOutput>;
  readonly getPrompt: MethodDef<typeof GetPromptInput, typeof GetPromptOutput>;
  readonly listResources: MethodDef<typeof ListResourcesInput, typeof ListResourcesOutput>;
  readonly readResource: MethodDef<typeof ReadResourceInput, typeof ReadResourceOutput>;
};

export const McpClient: CapabilityDef<
  McpMethods,
  readonly [
    ToolSpec<"listServers", typeof ListServersInput, McpMethods["listServers"]>,
    ToolSpec<"listResources", typeof ListResourcesInput, McpMethods["listResources"]>,
    ToolSpec<"readResource", typeof ReadResourceToolParams, McpMethods["readResource"]>,
  ]
> = defineCapability({
  id: "mcp.client",
  version: "1.0.0",
  description: "MCP 서버 연결 관리와 서버 도구·프롬프트·리소스 호출.",
  service: {
    methods: {
      listServers: {
        description: "정의된 서버와 상태 목록.",
        input: ListServersInput,
        output: ListServersOutput,
        replay: "safe",
      },
      status: {
        description: "서버 하나의 상태.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        replay: "safe",
        errors: MCP_ERRORS,
      },
      connect: {
        description: "꺼진 서버를 이 세션에서 켜고 연결한다.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        errors: MCP_ERRORS,
      },
      reconnect: {
        description: "연결을 닫고 다시 연결한다. 도구 목록을 다시 읽는다.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        errors: MCP_ERRORS,
      },
      disable: {
        description: "이 세션에서 서버를 끈다. 도구는 다음 단계 경계에서 빠진다.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        errors: MCP_ERRORS,
      },
      listTools: {
        description: "서버가 광고한 도구와 노출 여부.",
        input: McpServerRefSchema,
        output: ListToolsOutput,
        replay: "safe",
        errors: MCP_ERRORS,
      },
      callTool: {
        description: "서버 도구를 호출한다. input_required면 연속 정보를 돌려준다.",
        input: CallToolInput,
        output: CallToolOutput,
        replay: "unsafe",
        errors: MCP_ERRORS,
      },
      listPrompts: {
        description: "서버 프롬프트 목록.",
        input: McpServerRefSchema,
        output: ListPromptsOutput,
        replay: "safe",
        errors: MCP_ERRORS,
      },
      getPrompt: {
        description: "프롬프트를 인자로 펼친다.",
        input: GetPromptInput,
        output: GetPromptOutput,
        replay: "safe",
        errors: MCP_ERRORS,
      },
      listResources: {
        description: "리소스 목록. server가 없으면 연결된 모든 서버.",
        input: ListResourcesInput,
        output: ListResourcesOutput,
        replay: "safe",
        errors: MCP_ERRORS,
      },
      readResource: {
        description: "리소스 하나를 읽는다.",
        input: ReadResourceInput,
        output: ReadResourceOutput,
        replay: "safe",
        errors: MCP_ERRORS,
      },
    },
  },
  tools: [
    {
      name: "mcp_servers",
      label: "MCP 서버 상태",
      method: "listServers",
      parameters: ListServersInput,
      description: "연결된 MCP 서버와 상태, 도구 수를 보여 준다.",
      toContent: renderServers,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, idempotent: true },
    },
    {
      name: "mcp_list_resources",
      label: "MCP 리소스 목록",
      method: "listResources",
      parameters: ListResourcesInput,
      description: "MCP 서버가 제공하는 리소스(uri, 이름)를 나열한다. server를 주면 그 서버만.",
      toContent: renderResources,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, idempotent: true, openWorld: true },
    },
    {
      name: "mcp_read_resource",
      label: "MCP 리소스 읽기",
      method: "readResource",
      parameters: ReadResourceToolParams,
      toInput: (p) => ({ server: p.server, uri: p.uri }),
      description: "MCP 리소스 하나를 읽는다. 내용은 신뢰하지 않는 외부 내용이다.",
      toContent: renderRead,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, idempotent: true, openWorld: true },
    },
  ],
});
export const McpClientKey: ServiceKey<CapabilityApi<typeof McpClient>> = serviceKey(McpClient);
