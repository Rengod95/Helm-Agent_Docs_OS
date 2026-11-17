import type { ImageContent, JsonValue, TextContent } from "@fresnel/contracts/conversation";
import type { EffectStatus } from "@fresnel/contracts/records";
import type { CallerId, ToolResultView, ToolRisk } from "@fresnel/contracts/services";
import { TOOL_RISK_ORDER } from "@fresnel/contracts/services";

// 플러그인 기능 호출(L1.tools §4.6, hooks-core-boundary §5.3)의 순수 도우미. 파이프라인의 상태를 만지지 않는다.

const PLUGIN_PREFIX = "plugin:";

/** 플러그인 호출의 호출 주체. 이름은 확장 이름 스키마를 이미 통과한 값이어야 한다 */
export function pluginCallerOf(name: string): CallerId {
  return `${PLUGIN_PREFIX}${name}`;
}

/** 호출 주체가 플러그인 기능 호출이면 그 플러그인 이름. 아니면 undefined */
export function pluginNameOf(caller: CallerId): string | undefined {
  return caller.startsWith(PLUGIN_PREFIX) ? caller.slice(PLUGIN_PREFIX.length) : undefined;
}

/** 요청 id 길이 상한(재생 멱등 키, hooks-core-boundary §4.6) */
const PLUGIN_REQUEST_ID_MAX = 64;

export function isPluginRequestId(requestId: string): boolean {
  return requestId.length >= 1 && requestId.length <= PLUGIN_REQUEST_ID_MAX;
}

/**
 * 플러그인 호출 하나의 도구 호출 id. 같은 (스코프, 요청 id)면 같은 값이라 효과 기록과 재생 검사가 이 값으로 같은 호출을 알아본다.
 * 해시를 쓰므로 `\0` 구분자로 두 값을 이어도 서로 섞이지 않는다
 */
export function pluginToolCallIdOf(
  scopeId: string,
  requestId: string,
  sha256Hex: (text: string) => string,
): string {
  return `plg:${sha256Hex(`${scopeId}\0${requestId}`)}`;
}

/** 위험 등급의 순서 값. 클수록 위험하다 */
export function riskRankOf(risk: ToolRisk): number {
  return TOOL_RISK_ORDER.indexOf(risk);
}

/** 도구 결과를 플러그인 호출의 결과 값으로 옮긴다. 텍스트 내용만 모으고 이미지는 뺀다 */
export function viewOfExecution(
  result: {
    readonly content: readonly (TextContent | ImageContent)[];
    readonly structuredContent?: JsonValue | undefined;
    readonly details?: JsonValue | undefined;
  },
  isError: boolean,
): ToolResultView {
  return {
    content: result.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter((text) => text !== "")
      .join("\n"),
    structuredContent: result.structuredContent ?? null,
    isError,
    details: result.details ?? null,
  };
}

/** 저장된 효과 결과(durable)에서 되살린 값. 내용 텍스트와 details는 기록되지 않으므로 비어 있다 */
export function viewOfRecord(
  status: EffectStatus,
  structuredContent: JsonValue | null,
): ToolResultView {
  return {
    content: "",
    structuredContent,
    isError: status !== "ok",
    details: null,
  };
}
