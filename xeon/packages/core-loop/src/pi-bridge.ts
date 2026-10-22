// F `@xeon/contracts/conversation`의 pi 타입 재노출과 pi 패키지 사이의 경계(CM-03). F가 pi 타입을 그대로 재노출하므로
// (F.conversation.spec §3.1) 메시지·도구·컨텍스트는 변환이나 단언이 필요 없고, 읽기 전용 배열을 가변 배열로 복사할 뿐이다.
// 남은 단언은 하나다: F의 `AssistantMessageEventStream`은 소비 계약(AsyncIterable과 result())만 적은 인터페이스이고
// pi-ai의 같은 이름은 `#private` 클래스라서, 모델 게이트웨이가 낸 스트림을 agent-core에 건널 때만 단언한다.
import type {
  AgentContext as PiAgentContext,
  AgentLoopConfig,
  AgentMessage as PiAgentMessage,
  AgentToolCall as PiToolCall,
  RunToolCallOptions,
  StreamFn as PiStreamFn,
} from "@earendil-works/pi-agent-core";
import type {
  AgentMessage,
  AgentTool,
  AssistantMessage,
  Message,
  StreamFn,
  ToolCall,
} from "@xeon/contracts/conversation";

type PiTools = NonNullable<PiAgentContext["tools"]>;
type PiLlmMessages = Awaited<ReturnType<AgentLoopConfig["convertToLlm"]>>;
type PiStream = Awaited<ReturnType<PiStreamFn>>;

export function toPiMessages(messages: readonly AgentMessage[]): PiAgentMessage[] {
  return [...messages];
}

export function toPiTools(tools: readonly AgentTool[]): PiTools {
  return [...tools];
}

export function toPiLlmMessages(messages: readonly Message[]): PiLlmMessages {
  return [...messages];
}

type PiAssistant = RunToolCallOptions["assistantMessage"];

export function toPiAssistant(message: AssistantMessage): PiAssistant {
  return message;
}

export function toPiToolCall(call: ToolCall): PiToolCall {
  return call;
}

export function fromPiMessage(message: PiAgentMessage): AgentMessage {
  return message;
}

export function fromPiMessages(messages: readonly PiAgentMessage[]): AgentMessage[] {
  return [...messages];
}

function toPiStream(stream: Awaited<ReturnType<StreamFn>>): PiStream {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 모델 게이트웨이가 낸 스트림은 실행 때 pi-ai 스트림이다. F 인터페이스는 클래스 #private을 갖지 않는다 (CM-03)
  return stream as unknown as PiStream;
}

/** F `StreamFn`을 agent-core `StreamFn`으로 건넨다. 요청 본문은 그대로 넘긴다 */
export function toPiStreamFn(streamFn: StreamFn): PiStreamFn {
  return async (model, context, options) => toPiStream(await streamFn(model, context, options));
}
