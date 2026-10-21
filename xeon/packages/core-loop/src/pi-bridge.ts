// F `@xeon/contracts/conversation`의 pi 타입 거울과 설치된 pi 패키지 타입 사이의 부패 방지 계층(CM-03).
// 런타임 값은 같다. F의 거울 타입이 `TranscriptContext` 브랜드, `constrainedSampling`, 스트림 클래스의 #private 같은
// 선언 차이를 가져서 F → pi 방향 대입이 막힌다. 이 차이를 이 파일의 함수 몇 개로만 건넌다.
// F가 pi 타입 재노출(F.conversation.spec §3.1)로 바뀌면 이 파일의 단언이 필요 없어진다.
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
  TranscriptContext,
} from "@xeon/contracts/conversation";

type PiTools = NonNullable<PiAgentContext["tools"]>;
type PiLlmMessages = Awaited<ReturnType<AgentLoopConfig["convertToLlm"]>>;
type PiStream = Awaited<ReturnType<PiStreamFn>>;
type PiTranscript = Parameters<PiStreamFn>[1];

export function toPiMessages(messages: readonly AgentMessage[]): PiAgentMessage[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- F 거울 AgentMessage와 pi AgentMessage는 런타임 모양이 같다 (CM-03, 이 파일 머리말)
  return [...messages] as PiAgentMessage[];
}

export function toPiTools(tools: readonly AgentTool[]): PiTools {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- F 거울 AgentTool의 constrainedSampling 선언이 다를 뿐 런타임 모양은 같다 (CM-03)
  return [...tools] as PiTools;
}

export function toPiLlmMessages(messages: readonly Message[]): PiLlmMessages {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- F 거울 Message와 pi Message는 런타임 모양이 같다 (CM-03)
  return [...messages] as PiLlmMessages;
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

function fromPiTranscript(context: PiTranscript): TranscriptContext {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- F 거울 TranscriptContext의 unique symbol 브랜드는 타입에만 있다 (CM-03)
  return context as unknown as TranscriptContext;
}

function toPiStream(stream: Awaited<ReturnType<StreamFn>>): PiStream {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 모델 게이트웨이가 낸 스트림은 실행 때 pi-ai 스트림이다. F 거울은 클래스 #private을 갖지 않는다 (CM-03)
  return stream as unknown as PiStream;
}

/** F `StreamFn`을 agent-core `StreamFn`으로 건넨다. 요청 본문은 그대로 넘긴다 */
export function toPiStreamFn(streamFn: StreamFn): PiStreamFn {
  return async (model, context, options) =>
    toPiStream(await streamFn(model, fromPiTranscript(context), options));
}
