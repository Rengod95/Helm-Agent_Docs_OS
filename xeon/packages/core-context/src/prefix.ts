import { createHash } from "node:crypto";
import { Bug, canonicalJson } from "@xeon/contracts";
import {
  toJsonSchema,
  toolOrderKey,
  toolsetFingerprint,
  type OrderedTool,
  type ToolsetFingerprint,
} from "@xeon/contracts/capabilities";
import type { SystemMessage, TextContent, Tool } from "@xeon/contracts/conversation";

// L1.context.spec §4.2 접두 고정. 접두는 대화 첫머리의 시스템 메시지 하나다.
// 만드는 값은 입력과 가지(타임스탬프)에서만 정해진다. 시계와 난수를 쓰지 않으므로 같은 입력이면 같은 바이트다.

export interface PrefixInput {
  readonly basePrompt: string;
  /** context 계층 절. 키는 절 이름 */
  readonly sections: Readonly<Record<string, string>>;
  readonly tools: readonly OrderedTool[];
  readonly timestamp: number;
}

/** 도구 순서를 F의 정렬 키로 고정한다. 입력 순서와 무관하게 같은 결과를 낸다 */
function sortTools(tools: readonly OrderedTool[]): readonly OrderedTool[] {
  return tools.toSorted(toolOrderKey);
}

/**
 * 파라미터 스키마를 평범한 JSON 스키마로 바꾼다. TypeBox 내부 키(~kind 등)를 지우므로
 * 이벤트로 저장했다 읽어도 정규화 JSON이 변하지 않는다
 */
function plainParameters(tool: OrderedTool): Tool["parameters"] {
  const json = toJsonSchema(tool.wire.parameters);
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Bug(`prefix.parameters_not_object: ${tool.name}`);
  }
  return json;
}

function toolDeclaration(tool: OrderedTool): Tool {
  return {
    name: tool.wire.name,
    description: tool.wire.description,
    parameters: plainParameters(tool),
  };
}

/** 고정 접두 SystemMessage { content: basePrompt, sections, toolsAdded: 정렬 전체 } */
export function buildPrefixMessage(input: PrefixInput): SystemMessage {
  const sections: Record<string, string> = {};
  for (const name of Object.keys(input.sections).toSorted()) {
    const text = input.sections[name];
    if (text !== undefined) sections[name] = text;
  }
  return {
    role: "system",
    content: input.basePrompt,
    ...(Object.keys(sections).length === 0 ? {} : { sections }),
    toolsAdded: sortTools(input.tools).map(toolDeclaration),
    timestamp: input.timestamp,
  };
}

/** 접두 SystemMessage를 정규화 JSON으로 만든 sha256 hex */
export function prefixHash(message: SystemMessage): string {
  return createHash("sha256").update(canonicalJson(message)).digest("hex");
}

/**
 * 접두가 광고한 도구 목록의 지문. 기록된 접두에서도 계산해야 해서 접두의 toolsAdded에서 만든다.
 * 지문은 능력 ID를 쓰지 않으므로(canonicalToolset) capability는 비워 둔다
 */
export function prefixToolset(message: SystemMessage): Promise<ToolsetFingerprint> {
  const advertised: OrderedTool[] = (message.toolsAdded ?? []).map((tool) => ({
    capability: "",
    name: tool.name,
    wire: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
  return toolsetFingerprint(advertised);
}

function systemText(content: SystemMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((block: TextContent) => block.text).join("");
}

/**
 * 시스템 메시지들을 앞에서부터 합쳐 현재 프롬프트·절·도구 상태를 담은 시스템 메시지 하나로 만든다
 * (pi-ai getCurrentSystemMessage와 같은 규칙: 뒤의 content는 "\n\n"로 이어 붙이고, 절은 이름별로 덮고
 * null이면 지우며, 도구는 제거 뒤 추가를 적용한다). 메시지가 하나뿐이면 그대로 돌려준다
 */
export function replaySystemMessages(
  messages: readonly SystemMessage[],
): SystemMessage | undefined {
  const [first] = messages;
  if (first === undefined) return undefined;
  if (messages.length === 1) return first;
  const content: string[] = [];
  const sections = new Map<string, string>();
  const tools = new Map<string, Tool>();
  for (const message of messages) {
    const text = systemText(message.content);
    if (text.length > 0) content.push(text);
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
    for (const removed of message.toolsRemoved ?? []) tools.delete(removed.name);
    for (const added of message.toolsAdded ?? []) tools.set(added.name, added);
  }
  return {
    role: "system",
    content: content.join("\n\n"),
    ...(sections.size === 0 ? {} : { sections: Object.fromEntries(sections) }),
    ...(tools.size === 0 ? {} : { toolsAdded: [...tools.values()] }),
    timestamp: first.timestamp,
  };
}
