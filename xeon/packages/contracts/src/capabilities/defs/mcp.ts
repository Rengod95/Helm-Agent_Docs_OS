import {
  Type,
  type Static,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { assertNever, type SchemaProof, type SchemaSound } from "../../base/index.ts";
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

// L2.mcp.spec §3.1~§3.2. McpService(Cordis 서비스 fresnel.mcp)는 services/mcp.ts에 있다(F.capabilities.spec §3.12 규칙 7).

// ── 서버 정의 (§3.1) ───────────────────────────────────────────────────

export const MCP_SERVER_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,31}$";
export const McpServerIdSchema: TString = Type.String({ pattern: MCP_SERVER_ID_PATTERN });

/** secret:// 참조 또는 평문. 참조 형식과 시크릿 이름 패턴 검사는 cap-mcp가 정의를 읽을 때 한다(L2.mcp.spec §3.1) */
const McpValue = Type.String({ maxLength: 8192 });
const EnvName = Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" });
const HeaderName = Type.String({ pattern: "^[A-Za-z0-9-]{1,128}$" });

export type McpTransport =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      cwd?: string;
      /** 값은 secret:// 참조 또는 평문 문자열이다. secret:// 참조는 실행 직전에 L0.secrets가 주입한다 */
      env?: Record<string, string>;
    }
  | {
      /** Streamable HTTP */
      type: "http";
      url: string;
      /** 값은 secret:// 참조 또는 평문 문자열이다 */
      headers?: Record<string, string>;
      /** OAuth 사용(2차) */
      oauth?: boolean;
    }
  | {
      /** 2025 이전 서버 호환 */
      type: "sse";
      url: string;
      /** 값은 secret:// 참조 또는 평문 문자열이다 */
      headers?: Record<string, string>;
    };
const mcpTransportShape = Type.Union([
  Type.Object({
    type: Type.Literal("stdio"),
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    cwd: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(EnvName, McpValue)),
  }),
  Type.Object({
    type: Type.Literal("http"),
    url: Type.String({ pattern: "^https?://" }),
    headers: Type.Optional(Type.Record(HeaderName, McpValue)),
    oauth: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    type: Type.Literal("sse"),
    url: Type.String({ pattern: "^https?://" }),
    headers: Type.Optional(Type.Record(HeaderName, McpValue)),
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
  /** 서버별 샌드박스 설정. 있으면 출처별 기본값보다 우선한다(L2.mcp.spec §4.3, M3-REQ-97) */
  sandbox?: boolean;
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
  sandbox: Type.Optional(Type.Boolean()),
});
export const McpServerDefSchema: TUnsafe<McpServerDef> = Type.Unsafe<McpServerDef>(
  mcpServerDefShape satisfies SchemaProof<McpServerDef, typeof mcpServerDefShape>,
);

// ── 기능 정의 mcp.client (§3.2) ────────────────────────────────────────

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

/**
 * 서버가 막힌 사유(McpServerStatus.blockedReason). approval_required는 시크릿 env가 있는 stdio 서버가
 * 사용자의 기동 승인을 기다리는 경우다(L2.mcp.spec §4.3). sandbox_unavailable은 샌드박스에 넣어야 하는 stdio 서버를
 * 이 기기에서 격리할 수 없어 띄우지 않은 경우다(L0.process.spec §4.9).
 */
export const McpBlockedReasonSchema: TUnion<
  [
    TLiteral<"denied_by_policy">,
    TLiteral<"not_in_allowlist">,
    TLiteral<"managed_only">,
    TLiteral<"untrusted_project">,
    TLiteral<"approval_required">,
    TLiteral<"sandbox_unavailable">,
  ]
> = Type.Union([
  Type.Literal("denied_by_policy"),
  Type.Literal("not_in_allowlist"),
  Type.Literal("managed_only"),
  Type.Literal("untrusted_project"),
  Type.Literal("approval_required"),
  Type.Literal("sandbox_unavailable"),
]);
export type McpBlockedReason = Static<typeof McpBlockedReasonSchema>;

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
  /** 시크릿 값을 담지 않는다 */
  lastError?: { code: string; message: string; at: number };
  /** blocked일 때 사유: "denied_by_policy" | "not_in_allowlist" | "managed_only" | "untrusted_project" | "approval_required" | "sandbox_unavailable" */
  blockedReason?: McpBlockedReason;
  /** 연결된 서버가 광고했지만 노출하지 않은 도구와 사유(예: name_conflict). 없으면 생략 */
  hiddenTools?: { name: string; reason: string }[];
  /** 마지막 연결 실패 때 서버 stderr의 끝 줄들(마스킹, 최대 5줄). 연결되면 비운다. 없으면 생략 */
  stderrTail?: string[];
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
  blockedReason: Type.Optional(McpBlockedReasonSchema),
  hiddenTools: Type.Optional(
    Type.Array(Type.Object({ name: Type.String(), reason: Type.String() })),
  ),
  stderrTail: Type.Optional(Type.Array(Type.String())),
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
export const McpInputRequiredSchema: TUnsafe<McpInputRequired> = Type.Unsafe<McpInputRequired>(
  inputRequiredShape satisfies SchemaProof<McpInputRequired, typeof inputRequiredShape>,
);

/** 서버 결과 내용을 Fresnel 쪽 모양으로 바꾼 것. 이미지는 blob으로 옮긴다 */
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
  /** Fresnel 기계 이름(§3.3). 노출하지 않는 도구는 null */
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
  McpInputRequiredSchema,
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
  McpInputRequiredSchema,
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
  McpInputRequiredSchema,
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
  server_unknown: { description: "Server id not in the definitions", retryable: false },
  server_blocked: {
    description: "Server blocked by an allow/deny policy or a managed lock",
    retryable: false,
  },
  server_disconnected: { description: "Server connection is down", retryable: true },
  tool_unknown: { description: "Tool the server does not advertise", retryable: false },
  input_rounds_exceeded: {
    description: "input_required rounds exceed l2.mcp.inputRequired.maxRounds",
    retryable: false,
  },
  input_unsupported: {
    description: "Server requested an input kind it did not declare",
    retryable: false,
  },
  protocol_error: { description: "Server response violates the spec", retryable: false },
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

/**
 * 서버가 꺼졌거나 막힌 이유를 모델이 할 일과 함께 영어로 적는다. 연결 중이거나 실패한 서버에는 사유를 붙이지 않는다
 * (실패는 `error:` 코드가 따로 보인다).
 */
function serverReason(server: McpServerStatus): string | undefined {
  if (server.state === "disabled") return "disabled (setting or turned off for this conversation)";
  if (server.state !== "blocked") return undefined;
  switch (server.blockedReason) {
    case "approval_required":
      return "waiting for the user to approve starting this server; tell the user to approve the pending start card, its tools join at the next step after approval (do not conclude that no MCP tools exist)";
    case "denied_by_policy":
    case "not_in_allowlist":
    case "managed_only":
      return "blocked by settings (deniedServers/allowlist/managed policy)";
    case "untrusted_project":
      return "project folder not trusted";
    case "sandbox_unavailable":
      return "cannot start: sandbox unavailable on this machine";
    case undefined:
      return "blocked (reason unknown)";
    default:
      return assertNever(server.blockedReason, "serverReason");
  }
}

/** 노출하지 않은 도구 사유의 영어 설명. 모르는 사유는 코드만 보인다 */
const HIDDEN_REASON_TEXT: ReadonlyMap<string, string> = new Map([
  ["name_conflict", "another server exposes the same tool name"],
  ["name_invalid", "the name is not a valid tool name"],
  ["schema_invalid", "the input schema is not supported"],
  ["denied", "the server definition denies this tool"],
  ["not_allowed", "the server definition does not allow this tool"],
]);

function hiddenToolText(tool: { name: string; reason: string }): string {
  // 숨은 도구 이름은 서버가 정한 값이라 검증되지 않았다. 따옴표로 묶어 데이터로 보인다
  const explanation = HIDDEN_REASON_TEXT.get(tool.reason);
  const reason = explanation === undefined ? tool.reason : `${tool.reason}: ${explanation}`;
  return `${JSON.stringify(tool.name)} (${reason})`;
}

function serverLine(server: McpServerStatus): string {
  const error = server.lastError === undefined ? "" : ` error: ${server.lastError.code}`;
  const reason = serverReason(server);
  const hidden = server.hiddenTools ?? [];
  const hiddenPart =
    hidden.length === 0 ? "" : `; hidden tools: ${hidden.map(hiddenToolText).join(", ")}`;
  return `${server.server} ${server.state} ${server.toolCount} tools${error}${reason === undefined ? "" : ` - ${reason}`}${hiddenPart}`;
}

/** 서버 목록의 모델용 렌더링 */
export function renderServers(out: ListServersOutputValue): ToolContent {
  const lines = out.servers.map(serverLine);
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
      content: [{ type: "text", text: "Server requires additional input" }],
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
  description: "Manages MCP server connections and calls server tools, prompts, and resources.",
  service: {
    methods: {
      listServers: {
        description: "Defined servers and their states.",
        input: ListServersInput,
        output: ListServersOutput,
        replay: "safe",
        readOnly: true,
      },
      status: {
        description: "State of one server.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        replay: "safe",
        readOnly: true,
        errors: MCP_ERRORS,
      },
      connect: {
        description: "Turns on and connects a disabled server in this session.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        errors: MCP_ERRORS,
      },
      reconnect: {
        description: "Closes the connection and reconnects. Rereads the tool list.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        errors: MCP_ERRORS,
      },
      disable: {
        description:
          "Disables the server in this session. Its tools drop out at the next step boundary.",
        input: McpServerRefSchema,
        output: McpServerStatusSchema,
        errors: MCP_ERRORS,
      },
      listTools: {
        description: "Tools the server advertises and whether each one is exposed.",
        input: McpServerRefSchema,
        output: ListToolsOutput,
        replay: "safe",
        readOnly: true,
        errors: MCP_ERRORS,
      },
      callTool: {
        description:
          "Calls a server tool. If the result is input_required, returns continuation info.",
        input: CallToolInput,
        output: CallToolOutput,
        replay: "unsafe",
        errors: MCP_ERRORS,
      },
      listPrompts: {
        description: "List of server prompts.",
        input: McpServerRefSchema,
        output: ListPromptsOutput,
        replay: "safe",
        readOnly: true,
        errors: MCP_ERRORS,
      },
      getPrompt: {
        description: "Expands a prompt with arguments.",
        input: GetPromptInput,
        output: GetPromptOutput,
        replay: "safe",
        readOnly: true,
        errors: MCP_ERRORS,
      },
      listResources: {
        description: "Resource list. If server is omitted, all connected servers.",
        input: ListResourcesInput,
        output: ListResourcesOutput,
        replay: "safe",
        readOnly: true,
        errors: MCP_ERRORS,
      },
      readResource: {
        description: "Reads one resource.",
        input: ReadResourceInput,
        output: ReadResourceOutput,
        replay: "safe",
        readOnly: true,
        errors: MCP_ERRORS,
      },
    },
  },
  tools: [
    {
      name: "mcp_servers",
      label: "MCP Server Status",
      method: "listServers",
      parameters: ListServersInput,
      description: "Shows connected MCP servers, their states, and tool counts.",
      toContent: renderServers,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, idempotent: true },
    },
    {
      name: "mcp_list_resources",
      label: "List MCP Resources",
      method: "listResources",
      parameters: ListResourcesInput,
      description:
        "Lists resources (uri, name) that MCP servers provide. If server is given, only that server is listed.",
      toContent: renderResources,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, idempotent: true, openWorld: true },
    },
    {
      name: "mcp_read_resource",
      label: "Read MCP Resource",
      method: "readResource",
      parameters: ReadResourceToolParams,
      toInput: (p) => ({ server: p.server, uri: p.uri }),
      description: "Reads one MCP resource. Its content is untrusted external content.",
      toContent: renderRead,
      replay: "safe",
      executionMode: "parallel",
      hints: { readOnly: true, idempotent: true, openWorld: true },
    },
  ],
});
export const McpClientKey: ServiceKey<CapabilityApi<typeof McpClient>> = serviceKey(McpClient);
