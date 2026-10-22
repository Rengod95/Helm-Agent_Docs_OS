// F.conversation.spec §3.1.1 에이전트 루프 타입 (adr.0009). 타입만 둔다. 값 export 0건.
// 이름과 필드는 pi-agent-core 1.3.0 types.ts에서 출발했다(MIT, Copyright (c) 2025 Mario Zechner).
// pi-agent-core는 import하지 않는다. `any`를 쓰지 않고 AgentMessage는 닫힌 유니온이다.
import type { Static, TSchema } from "typebox";
import type { XeonCustomMessage } from "./hierarchy.ts";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ImageContent,
  JsonObject,
  JsonValue,
  Message,
  TextContent,
  Tool,
  ToolResultMessage,
  Usage,
} from "./pi.ts";

/** 대화 기록에 들어가는 메시지. 닫힌 유니온이고 선언 병합은 없다. 확장 구분은 XeonCustomMessage.customType */
export type AgentMessage = Message | XeonCustomMessage;

/** 어시스턴트 메시지의 도구 호출 블록 하나 */
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/** 도구 결과. 필드 뜻은 pi-agent-core 1.3.0 AgentToolResult와 같다(F.conversation.spec §3.6 3채널) */
export interface AgentToolResult<TDetails extends JsonValue | undefined = JsonValue | undefined> {
  content: (TextContent | ImageContent)[];
  details: TDetails;
  structuredContent?: JsonValue;
  usage?: Usage;
  isError?: boolean;
  terminate?: boolean;
}

export type AgentToolUpdateCallback<
  TDetails extends JsonValue | undefined = JsonValue | undefined,
> = (partial: AgentToolResult<TDetails>) => void;

export type ToolExecutionMode = "sequential" | "parallel";

/** 실행할 수 있는 도구. pi-ai Tool(이름·설명·parameters)에 실행 정보를 더한다 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue | undefined = JsonValue | undefined,
> extends Tool<TParameters> {
  label: string;
  outputSchema?: TSchema;
  replay?: "never" | "safe";
  executionMode?: ToolExecutionMode;
  execute(
    toolCallId: string,
    params: Static<TParameters>,
    signal: AbortSignal,
    onUpdate: AgentToolUpdateCallback<TDetails>,
  ): Promise<AgentToolResult<TDetails>>;
}

/** 요청 하나의 입력. 루프는 이 값을 요청마다 새로 받고 고치지 않는다 */
export interface AgentContext {
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentTool[];
}

/** 루프 이벤트. 변형 이름은 pi와 같다(확장 지점 이름, F.conversation.spec §3.5.4) */
export type AgentEvent =
  | { readonly type: "agent_start" }
  | { readonly type: "agent_end"; readonly messages: readonly AgentMessage[] }
  | { readonly type: "turn_start" }
  | {
      readonly type: "turn_end";
      readonly message: AssistantMessage;
      readonly toolResults: readonly ToolResultMessage[];
    }
  | { readonly type: "message_start"; readonly message: AgentMessage }
  | {
      readonly type: "message_update";
      readonly message: AssistantMessage;
      readonly assistantMessageEvent: AssistantMessageEvent;
    }
  | { readonly type: "message_end"; readonly message: AgentMessage }
  | {
      readonly type: "tool_execution_start";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: JsonObject;
    }
  | {
      readonly type: "tool_execution_update";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: JsonObject;
      readonly partialResult: AgentToolResult;
    }
  | {
      readonly type: "tool_execution_end";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly result: AgentToolResult;
      readonly isError: boolean;
      readonly durationMs?: number;
    };
