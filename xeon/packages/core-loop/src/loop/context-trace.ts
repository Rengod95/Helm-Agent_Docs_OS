import { attempt, canonicalJson, type Logger } from "@fresnel/contracts";
import type { AssistantMessage } from "@fresnel/contracts/conversation";
import {
  SKILL_VIEW_TOOL_NAME,
  type AdvertisedFact,
  type AdvertisedToolFact,
  type ContextTraceEvent,
  type ContextTraceSink,
} from "@fresnel/contracts/extensions";
import type { AdvertisedToolset } from "@fresnel/contracts/services";

// 조립 재료와 광고의 읽기 전용 측정(정본 docs/xeon/review/m5/turn-record-metrics.md §4.1 규칙 2·7, §4.5 규칙 26~29).
// 싱크가 없으면 아무것도 만들지 않는다. 싱크가 던지면 경고만 남기고 요청 경로는 그대로 간다.

/** 단계 하나의 광고 도구 줄 상한(§4.1 규칙 8). 넘는 도구는 `toolsOmitted`에 센다 */
const ADVERTISED_TOOL_ROW_CAP = 256;
/** 도구 정의 토큰을 지문으로 기억하는 상한. 넘으면 가장 먼저 넣은 것부터 버린다 */
const TOKEN_MEMO_LIMIT = 16;

/** 글자 수 / 4 올림. 요청 구성 토큰과 같은 어림이다 */
function textTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * 도구의 소유 플러그인(§4.5 규칙 28). `ext.<이름>`은 그 확장, `mcp.<서버>`는 그 서버, 그 밖은 기능 id를 그대로 쓴다(추적 줄과 같다).
 * 기능 id가 비었으면 `none`이다
 */
export function pluginOfCapability(capability: string): string {
  if (capability.startsWith("ext.")) return capability.slice("ext.".length);
  if (capability.startsWith("mcp.")) return capability.slice("mcp.".length);
  return capability === "" ? "none" : capability;
}

/** 지문 → 도구별 토큰. 지문이 같으면 광고 목록의 정의가 같으므로 다시 세지 않는다 */
const tokenMemo = new Map<string, readonly number[]>();

function perToolTokens(toolset: AdvertisedToolset): readonly number[] {
  const known = tokenMemo.get(toolset.fingerprint);
  if (known !== undefined && known.length === toolset.tools.length) return known;
  const counted = toolset.tools.map((tool) => textTokens(canonicalJson(tool.wire)));
  if (tokenMemo.size >= TOKEN_MEMO_LIMIT) {
    const oldest = tokenMemo.keys().next();
    if (oldest.done !== true) tokenMemo.delete(oldest.value);
  }
  tokenMemo.set(toolset.fingerprint, counted);
  return counted;
}

/**
 * 이번 단계의 광고 요약(§3.2 `Advertised`). 광고 목록의 도구(기본은 광고, `activated`면 활성화됨)와 지연 도구, 제거 수를 센다.
 * 도구 줄은 광고 → 활성화 → 지연 순서로 상한까지 싣는다
 */
export function advertisedFactOf(input: {
  readonly toolset: AdvertisedToolset;
  readonly activated: ReadonlySet<string>;
}): AdvertisedFact {
  const { toolset } = input;
  const tokens = perToolTokens(toolset);
  const rows: AdvertisedToolFact[] = [];
  const byPlugin = new Map<
    string,
    { count: number; tokens: number; deferred: number; activated: number }
  >();
  const pluginRow = (
    plugin: string,
  ): { count: number; tokens: number; deferred: number; activated: number } => {
    const found = byPlugin.get(plugin);
    if (found !== undefined) return found;
    const created = { count: 0, tokens: 0, deferred: 0, activated: 0 };
    byPlugin.set(plugin, created);
    return created;
  };
  let advertisedTokens = 0;
  toolset.tools.forEach((tool, index) => {
    const plugin = pluginOfCapability(tool.capability);
    const count = tokens[index] ?? 0;
    const state = input.activated.has(tool.name) ? "activated" : "advertised";
    const row = pluginRow(plugin);
    row.count += 1;
    row.tokens += count;
    advertisedTokens += count;
    if (state === "activated") row.activated += 1;
    rows.push({ name: tool.name, plugin, tokens: count, state });
  });
  for (const ref of toolset.deferred) {
    const plugin = pluginOfCapability(ref.capability);
    pluginRow(plugin).deferred += 1;
    rows.push({ name: ref.name, plugin, tokens: 0, state: "deferred" });
  }
  return {
    count: toolset.tools.length,
    tokens: advertisedTokens,
    deferredCount: toolset.deferred.length,
    removedCount: toolset.removed.length,
    fingerprint: toolset.fingerprint,
    byPlugin: [...byPlugin.entries()]
      .map(([plugin, row]) => ({
        plugin,
        count: row.count,
        tokens: row.tokens,
        deferred: row.deferred,
        activated: row.activated,
      }))
      .toSorted((left, right) =>
        left.plugin < right.plugin ? -1 : left.plugin > right.plugin ? 1 : 0,
      ),
    tools: rows.slice(0, ADVERTISED_TOOL_ROW_CAP),
    toolsOmitted: Math.max(0, rows.length - ADVERTISED_TOOL_ROW_CAP),
  };
}

/** 어시스턴트 메시지의 스킬 본문 읽기 호출(`skill_view`의 `name` 인자가 문자열인 것). 실행 여부는 기록기가 호출 줄에서 본다 */
export function skillReadsOf(
  message: AssistantMessage,
): readonly { readonly toolCallId: string; readonly name: string }[] {
  const reads: { toolCallId: string; name: string }[] = [];
  for (const block of message.content) {
    if (block.type !== "toolCall" || block.name !== SKILL_VIEW_TOOL_NAME) continue;
    const name = block.arguments["name"];
    if (typeof name === "string" && name.length > 0) {
      reads.push({ toolCallId: block.id, name });
    }
  }
  return reads;
}

/**
 * 싱크에 한 줄을 넘긴다. 싱크가 던지면 경고(`loop.context_trace_failed`)만 남기고 돌아온다. 반환값은 없다(읽기 전용)
 */
export function emitContextTrace(
  input: { readonly contextTrace?: ContextTraceSink | undefined; readonly logger: Logger },
  event: ContextTraceEvent,
): void {
  const sink = input.contextTrace;
  if (sink === undefined) return;
  const written = attempt(() => {
    sink.record(event);
  });
  if (!written.ok) {
    input.logger.warn("loop.context_trace_failed", { kind: event.kind });
  }
}
