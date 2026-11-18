import { canonicalJson, err, ok, parse, type Result } from "@fresnel/contracts";
import {
  ItemRecordedPayloadSchema,
  type DurableEventEnvelope,
  type ItemRecordedPayload,
} from "@fresnel/contracts/records";
import { JsonValueSchema, type JsonObject, type JsonValue } from "@fresnel/contracts/conversation";
import { ToolCallPayloadSchema, type ToolCallPayload } from "@fresnel/contracts/extensions";
import type { CallRecord, BacktestItem } from "@fresnel/contracts/wire";

// 지난 턴에 돌려 보기의 입력 재구성(turn-record-metrics.md §4.8 규칙 45). 호출 하나의 훅 입력은 기록된 `CallRecord`와
// 대화 로그의 도구 호출 인자(어시스턴트 항목의 `toolCall` 블록)로 만든다. 도구 레지스트리는 읽지 않는다.
// 이 파일은 순수하다. 로그 사건은 호출하는 쪽이 읽어 넘기고(`threadItemLogOf`), 여기서는 값만 옮긴다.

/** 돌려 볼 수 없는 이유(§3.7). 와이어 값 목록과 같다 */
export type UnreplayableReason = NonNullable<BacktestItem["unreplayableReason"]>;

/** 대화 로그에서 읽은 도구 호출 인자 한 줄 */
interface LoggedToolCall {
  readonly name: string;
  readonly args: JsonObject;
  /** 인자를 모델 출력에서 읽지 못했다(`argumentsError`). 이때 인자는 믿을 수 없다 */
  readonly argumentsError: boolean;
}

/** 대화 로그에서 읽은 도구 결과 한 줄. 훅의 `current` 값(`ToolResultValue`)의 JSON 모양이다 */
interface LoggedToolResult {
  /** JSON 값으로 옮길 수 없었으면 null이다(저장 데이터가 스키마를 벗어남) */
  readonly value: JsonValue | null;
}

/** 대화 하나의 도구 호출 인자와 결과. `toolCallId`로 찾는다 */
export interface ThreadItemLog {
  readonly calls: ReadonlyMap<string, LoggedToolCall>;
  readonly results: ReadonlyMap<string, LoggedToolResult>;
}

/** 로그 한 줄이 스키마를 벗어났다. 저장 데이터가 손상된 것이라 돌려 보기 실행이 실패한다 */
export interface ThreadItemLogCorrupt {
  readonly kind: "log_corrupt";
}

/** 바깥 저장소가 큰 문자열을 옮긴 자리표시(`blob:sha256:<64 hex>`) 모양 */
const QUOTED_BLOB_PLACEHOLDER = /"blob:sha256:[0-9a-f]{64}"/;

/**
 * 값 안에 되살리지 못한 blob 자리표시가 하나라도 있나. 있으면 인자나 결과 본문이 만료된 것이다.
 * 정규화 JSON 문자열에서 따옴표로 둘러싼 자리표시를 찾는다(값이 자리표시와 같은 문자열일 때만 맞는다)
 */
export function hasBlobPlaceholder(value: JsonValue): boolean {
  return QUOTED_BLOB_PLACEHOLDER.test(canonicalJson(value));
}

/**
 * 대화 로그의 `item.recorded` 사건을 도구 호출 인자와 결과의 색인으로 바꾼다. 같은 `toolCallId`가 두 번 나오면 먼저 나온 것을 쓴다.
 * 사건 본문은 `ItemRecordedPayloadSchema`로 검사한다. 맞지 않는 줄이 있으면 손상이다.
 */
export function threadItemLogOf(
  events: readonly DurableEventEnvelope[],
): Result<ThreadItemLog, ThreadItemLogCorrupt> {
  const calls = new Map<string, LoggedToolCall>();
  const results = new Map<string, LoggedToolResult>();
  for (const event of events) {
    if (event.kind !== "item.recorded") continue;
    const parsed = parse(ItemRecordedPayloadSchema, event.payload);
    if (!parsed.ok) return err({ kind: "log_corrupt" });
    collect(parsed.value, calls, results);
  }
  return ok({ calls, results });
}

function collect(
  payload: ItemRecordedPayload,
  calls: Map<string, LoggedToolCall>,
  results: Map<string, LoggedToolResult>,
): void {
  const item = payload.item;
  if (item.kind === "assistant") {
    for (const block of item.message.content) {
      if (block.type !== "toolCall") continue;
      if (calls.has(block.id)) continue;
      calls.set(block.id, {
        name: block.name,
        args: block.arguments,
        argumentsError: block.argumentsError !== undefined,
      });
    }
    return;
  }
  if (item.kind === "toolResult") {
    const id = item.message.toolCallId;
    if (results.has(id)) return;
    const message = item.message;
    const value = parse(JsonValueSchema, {
      content: message.content,
      isError: message.isError,
      ...(message.details === undefined ? {} : { details: message.details }),
    });
    results.set(id, { value: value.ok ? value.value : null });
  }
}

/** 호출 주체를 훅 payload의 `caller` 값으로 옮긴다. 하위 대화의 이름은 기록에 없어 null이다 */
export function callerIdOf(call: CallRecord): string | null {
  if (call.caller === "main") return "main";
  if (call.caller === "plugin")
    return call.callerPlugin === null ? null : `plugin:${call.callerPlugin}`;
  return null;
}

/**
 * 호출 하나의 `ToolCallPayload`(JSON 값)를 만든다. 도구 이름은 기록의 `tool`이고 입력은 로그의 인자다.
 * `hints`는 기록에 없어 싣지 않는다. 스키마를 벗어나면 도구 식별이 옮겨지지 않은 것이라 `tool_unknown`이다.
 */
export function toolCallPayloadOf(
  call: CallRecord,
  args: JsonObject,
): Result<
  { readonly typed: ToolCallPayload; readonly json: JsonValue },
  { readonly kind: "tool_unknown" }
> {
  const caller = callerIdOf(call);
  const draft = {
    toolCallId: call.toolCallId,
    ...(call.parentToolCallId === null ? {} : { parentToolCallId: call.parentToolCallId }),
    toolName: call.tool,
    input: args,
    ...(call.capability === null
      ? {}
      : { capability: { id: call.capability.id, method: call.capability.method } }),
    risk: call.risk,
    ...(caller === null ? {} : { caller }),
  };
  const typed = parse(ToolCallPayloadSchema, draft);
  if (!typed.ok) return err({ kind: "tool_unknown" });
  const json = parse(JsonValueSchema, draft);
  if (!json.ok) return err({ kind: "tool_unknown" });
  return ok({ typed: typed.value, json: json.value });
}
