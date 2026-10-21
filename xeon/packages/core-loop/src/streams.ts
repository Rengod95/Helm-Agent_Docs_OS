import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  JsonValue,
} from "@xeon/contracts/conversation";

/** 슬롯 대기 중 취소된 모델 요청에 돌려주는 스트림: 종결 이벤트 하나로 `aborted`를 낸다 */
export function abortedStream(
  api: string,
  provider: string,
  model: string,
  timestamp: number,
): AssistantMessageEventStream {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api,
    provider,
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "aborted",
    errorMessage: "model request cancelled while waiting for a slot",
    timestamp,
  };
  const event: AssistantMessageEvent = { type: "error", reason: "aborted", error: message };
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      yield event;
    },
    result: () => Promise.resolve(message),
  };
}

/** JSON 값인지 얕게 확인한다. 도구 결과의 `details`(pi는 any)를 기록 모양으로 옮길 때 쓴다 */
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) return value.every(isJsonValue);
      return Object.values(value).every(isJsonValue);
    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      return false;
    default:
      return false;
  }
}

export function jsonOrUndefined(value: unknown): JsonValue | undefined {
  return isJsonValue(value) ? value : undefined;
}
