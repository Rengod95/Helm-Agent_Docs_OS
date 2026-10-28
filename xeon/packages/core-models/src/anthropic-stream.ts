import { parseJson } from "@xeon/contracts";

// L1.models.spec §3.1, L2.web.spec §4.8.4. pi-ai anthropic-messages 어댑터는 서버 도구 블록(server_tool_use,
// web_search_tool_result)을 AssistantMessage에 싣지 않는다. 그래서 어댑터가 `onProviderStreamEvent`로 넘기는 원시 SSE 이벤트를
// 이 모듈이 다시 모아 응답 블록으로 만든다. 순수 함수이고 모양을 모르는 이벤트는 무시한다.

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export interface AccumulatedMessage {
  /** 응답 content 블록. 인덱스 순서이고 이어 요청에 그대로 되돌려 보낼 수 있는 모양이다 */
  readonly blocks: readonly JsonRecord[];
  /** message_delta의 stop_reason. 이벤트가 없으면 null */
  readonly stopReason: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** usage.server_tool_use.web_search_requests */
  readonly searchRequests: number;
  /** 스트림 안의 error 이벤트 */
  readonly streamError: { readonly type: string; readonly message: string } | null;
}

export interface StreamAccumulator {
  push(event: unknown): void;
  snapshot(): AccumulatedMessage;
}

interface Slot {
  readonly block: JsonRecord;
  /** server_tool_use 입력의 부분 JSON */
  json: string;
}

export function createStreamAccumulator(): StreamAccumulator {
  const slots = new Map<number, Slot>();
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let searchRequests = 0;
  let streamError: AccumulatedMessage["streamError"] = null;

  function readUsage(usage: unknown): void {
    if (!isRecord(usage)) return;
    const input = num(usage["input_tokens"]);
    if (input !== undefined) inputTokens = input;
    const output = num(usage["output_tokens"]);
    if (output !== undefined) outputTokens = output;
    const tool = usage["server_tool_use"];
    if (isRecord(tool)) {
      const requests = num(tool["web_search_requests"]);
      if (requests !== undefined) searchRequests = requests;
    }
  }

  return {
    push(event) {
      if (!isRecord(event)) return;
      const type = str(event["type"]);
      if (type === "message_start") {
        const message = event["message"];
        if (isRecord(message)) readUsage(message["usage"]);
      } else if (type === "content_block_start") {
        const index = num(event["index"]);
        const block = event["content_block"];
        if (index === undefined || !isRecord(block)) return;
        const copy: JsonRecord = structuredClone(block);
        if (copy["type"] === "text" && typeof copy["text"] !== "string") copy["text"] = "";
        slots.set(index, { block: copy, json: "" });
      } else if (type === "content_block_delta") {
        const slot = slots.get(num(event["index"]) ?? -1);
        const delta = event["delta"];
        if (slot === undefined || !isRecord(delta)) return;
        const deltaType = str(delta["type"]);
        if (deltaType === "text_delta") {
          slot.block["text"] = `${str(slot.block["text"]) ?? ""}${str(delta["text"]) ?? ""}`;
        } else if (deltaType === "input_json_delta") {
          slot.json += str(delta["partial_json"]) ?? "";
        } else if (deltaType === "citations_delta") {
          const citation = delta["citation"];
          if (!isRecord(citation)) return;
          const existing = slot.block["citations"];
          const list: unknown[] = [];
          if (Array.isArray(existing)) {
            for (const item of existing) list.push(item);
          }
          list.push(citation);
          slot.block["citations"] = list;
        }
      } else if (type === "content_block_stop") {
        const slot = slots.get(num(event["index"]) ?? -1);
        if (slot === undefined || slot.json.length === 0) return;
        const parsed = parseJson(slot.json);
        if (parsed.ok && isRecord(parsed.value)) slot.block["input"] = parsed.value;
      } else if (type === "message_delta") {
        const delta = event["delta"];
        if (isRecord(delta)) stopReason = str(delta["stop_reason"]) ?? stopReason;
        readUsage(event["usage"]);
      } else if (type === "error") {
        const error = event["error"];
        if (isRecord(error)) {
          streamError = {
            type: str(error["type"]) ?? "error",
            message: str(error["message"]) ?? "",
          };
        }
      }
    },
    snapshot() {
      const blocks = [...slots.entries()]
        .toSorted((a, b) => a[0] - b[0])
        .map(([, slot]) => slot.block);
      return { blocks, stopReason, inputTokens, outputTokens, searchRequests, streamError };
    },
  };
}
