import { parse, type Logger } from "@xeon/contracts";
import type { EventId, ImageContent, TextContent, ThreadId } from "@xeon/contracts/conversation";
import {
  EXTENSION_KIND_PATTERN,
  InputPlacedPayloadSchema,
  InputQueuedPayloadSchema,
  InputWithdrawnPayloadSchema,
  type DurableEventEnvelope,
  type InputQueuedPayload,
  type InputView,
} from "@xeon/contracts/records";
import type { PostContent, PostItem, RecordKind } from "@xeon/contracts/extensions";
import type { InputDraft, QueuedInput } from "@xeon/contracts/services";
import type { TasksSession } from "./session-port.ts";
import { sourceKeyOf } from "./source-key.ts";

// input.* 이벤트의 payload 변환과 이벤트 피드 읽기. 큐의 정본은 이벤트(와 그 투영 p_inputs)다.

const EXTENSION_KIND_REGEX = new RegExp(EXTENSION_KIND_PATTERN);

/** 피드를 한 번에 읽는 쪽 크기 */
const PAGE_LIMIT = 200;
const SCAN_LIMIT = 5000;

function isRecordKind(value: string): value is RecordKind {
  return EXTENSION_KIND_REGEX.test(value);
}

function contentOf(content: PostContent): string | (TextContent | ImageContent)[] {
  return typeof content === "string" ? content : [...content];
}

export function queuedPayloadOf(draft: InputDraft): InputQueuedPayload {
  const item: PostItem = draft.item;
  return {
    mode: draft.mode,
    item:
      item.kind === "user"
        ? { kind: "user", content: contentOf(item.content) }
        : {
            kind: "context",
            customType: item.customType,
            content: contentOf(item.content),
            display: item.display,
            details: item.details ?? null,
          },
    requestId: draft.requestId,
    source: draft.source,
  };
}

/** payload → InputDraft. context의 customType이 확장 kind 형식이 아니면 undefined */
function draftOfPayload(threadId: ThreadId, payload: InputQueuedPayload): InputDraft | undefined {
  const base = {
    threadId,
    mode: payload.mode,
    requestId: payload.requestId,
    source: payload.source,
  };
  if (payload.item.kind === "user") {
    return { ...base, item: { kind: "user", content: payload.item.content } };
  }
  const customType = payload.item.customType;
  if (!isRecordKind(customType)) return undefined;
  return {
    ...base,
    item: {
      kind: "context",
      customType,
      content: payload.item.content,
      display: payload.item.display,
      details: payload.item.details,
    },
  };
}

/**
 * [afterSeq, headSeq] 구간에서 접두가 맞는 이벤트를 모두 읽는다. 피드의 동기 읽기를 쪽 단위로 이어 붙인다.
 * 중복 판정이나 상태 조회처럼 드문 경로에서만 쓴다
 */
function readThreadEvents(
  session: Pick<TasksSession, "feed">,
  threadId: ThreadId,
  afterSeq: number,
  kindPrefixes: readonly string[],
): readonly DurableEventEnvelope[] {
  const upto = session.feed.headSeq();
  const out: DurableEventEnvelope[] = [];
  let cursor = afterSeq;
  while (cursor < upto) {
    const page = session.feed.read(
      cursor,
      upto,
      { threadIds: [threadId], kindPrefixes },
      PAGE_LIMIT,
      SCAN_LIMIT,
    );
    out.push(...page.events);
    const last = page.events.at(-1);
    const next = page.events.length >= PAGE_LIMIT && last !== undefined ? last.seq : page.scannedTo;
    if (next <= cursor) break;
    cursor = next;
  }
  return out;
}

/** 투영 행(InputView) 하나에 대응하는 input.queued 이벤트를 읽어 QueuedInput으로 만든다 */
export function loadQueuedInput(
  session: Pick<TasksSession, "feed">,
  log: Logger,
  threadId: ThreadId,
  view: InputView,
): QueuedInput | undefined {
  const page = session.feed.read(
    view.seq - 1,
    view.seq,
    { threadIds: [threadId], kindPrefixes: ["input.queued"] },
    1,
    1,
  );
  const event = page.events.find((candidate) => candidate.id === view.inputId);
  if (event === undefined) {
    log.error("tasks.queued_event_missing", { threadId, inputId: view.inputId, seq: view.seq });
    return undefined;
  }
  if (event.detached !== undefined && event.detached.length > 0) {
    // 큰 문자열(이미지 data 등)이 blob 자리표시로 바뀐 입력은 동기 읽기로 되돌릴 수 없다. 자리표시를 모델에 보내지 않는다
    log.error("tasks.queued_input_detached", { threadId, inputId: view.inputId });
    return undefined;
  }
  const parsed = parse(InputQueuedPayloadSchema, event.payload);
  if (!parsed.ok) {
    log.error("tasks.queued_payload_invalid", { threadId, inputId: view.inputId });
    return undefined;
  }
  const draft = draftOfPayload(threadId, parsed.value);
  if (draft === undefined) {
    log.error("tasks.queued_item_invalid", { threadId, inputId: view.inputId });
    return undefined;
  }
  return { ...draft, inputId: event.id, seq: event.seq };
}

export interface FoundInput {
  readonly inputId: EventId;
  readonly seq: number;
}

/** (threadId, 출처 키, requestId)가 같은 input.queued를 찾는다. 투영 밖에서 이벤트로 찾는 드문 경로 */
export function findQueuedEvent(
  session: Pick<TasksSession, "feed">,
  threadId: ThreadId,
  sourceKey: string,
  requestId: string,
): FoundInput | undefined {
  for (const event of readThreadEvents(session, threadId, 0, ["input.queued"])) {
    const parsed = parse(InputQueuedPayloadSchema, event.payload);
    if (!parsed.ok) continue;
    if (parsed.value.requestId === requestId && sourceKeyOf(parsed.value.source) === sourceKey) {
      return { inputId: event.id, seq: event.seq };
    }
  }
  return undefined;
}

/** 입력의 현재 상태. queued 이후의 input.placed·input.withdrawn을 본다 */
export function stateOfInput(
  session: Pick<TasksSession, "feed">,
  threadId: ThreadId,
  found: FoundInput,
): "queued" | "placed" | "withdrawn" {
  for (const event of readThreadEvents(session, threadId, found.seq, [
    "input.placed",
    "input.withdrawn",
  ])) {
    if (event.kind === "input.placed") {
      const parsed = parse(InputPlacedPayloadSchema, event.payload);
      if (parsed.ok && parsed.value.inputId === found.inputId) return "placed";
    } else {
      const parsed = parse(InputWithdrawnPayloadSchema, event.payload);
      if (parsed.ok && parsed.value.inputId === found.inputId) return "withdrawn";
    }
  }
  return "queued";
}
