import { err, ok, parse, type Logger, type ParseError, type Result } from "@xeon/contracts";
import type {
  EventId,
  ItemRecord,
  JsonValue,
  Message,
  SystemMessage,
  ThreadId,
} from "@xeon/contracts/conversation";
import {
  BranchSummarizedPayloadSchema,
  CompactedPayloadSchema,
  ItemRecordedPayloadSchema,
  type BranchSummarizedPayload,
  type CompactedPayload,
  type DurableEventEnvelope,
  type SessionService,
} from "@xeon/contracts/records";
import type { ContextError } from "@xeon/contracts/services";
import { branchSummaryMessage, compactionSummaryMessage, itemToMessage } from "./convert.ts";

// 가지 읽기와 투영. assemble(조립), compact(컴팩션), summarizeBranch(가지 요약)가 같은 읽기 규칙을 쓴다.

/** 가지를 읽는 데 필요한 세션 서비스 부분형 */
export interface BranchReaderDeps {
  readonly session: Pick<SessionService, "readBranch" | "hydrate">;
  readonly logger?: Logger;
}

/** 가지 위 이벤트 하나를 조립에 쓰는 모양으로 읽은 것. 조립에 쓰지 않는 이벤트는 undefined */
export type Projected =
  | { readonly type: "item"; readonly item: ItemRecord }
  | { readonly type: "compacted"; readonly payload: CompactedPayload }
  | { readonly type: "branch_summary"; readonly payload: BranchSummarizedPayload };

export interface CompactionHead {
  /** 가지 위 thread.compacted 이벤트의 위치 */
  readonly index: number;
  readonly eventId: EventId;
  readonly firstKeptEventId: EventId;
  /** 가지 위 firstKeptEventId 이벤트의 위치 */
  readonly firstKeptIndex: number;
  readonly summary: string;
  readonly details: JsonValue;
  readonly recordedAt: number;
}

function projectionFailed(event: DurableEventEnvelope, error: ParseError): ContextError {
  const issue = error.issues[0];
  const detail = issue === undefined ? "" : ` ${issue.path} ${issue.message}`;
  return { kind: "projection_failed", message: `${event.kind} ${event.id}${detail}` };
}

function projectEvent(event: DurableEventEnvelope): Result<Projected | undefined, ContextError> {
  if (event.kind === "item.recorded") {
    const parsed = parse(ItemRecordedPayloadSchema, event.payload);
    if (!parsed.ok) return err(projectionFailed(event, parsed.error));
    return ok({ type: "item", item: parsed.value.item });
  }
  if (event.kind === "thread.compacted") {
    const parsed = parse(CompactedPayloadSchema, event.payload);
    if (!parsed.ok) return err(projectionFailed(event, parsed.error));
    return ok({ type: "compacted", payload: parsed.value });
  }
  if (event.kind === "thread.branch_summarized") {
    const parsed = parse(BranchSummarizedPayloadSchema, event.payload);
    if (!parsed.ok) return err(projectionFailed(event, parsed.error));
    return ok({ type: "branch_summary", payload: parsed.value });
  }
  return ok(undefined);
}

export function projectBranch(
  events: readonly DurableEventEnvelope[],
): Result<readonly (Projected | undefined)[], ContextError> {
  const projected: (Projected | undefined)[] = [];
  for (const event of events) {
    const one = projectEvent(event);
    if (!one.ok) return one;
    projected.push(one.value);
  }
  return ok(projected);
}

/** leaf에서 루트까지 거슬러 읽은 가지를 루트→leaf 순서로 돌려준다. detached 필드는 블롭에서 되돌린다 */
export async function readBranchEvents(
  deps: BranchReaderDeps,
  threadId: ThreadId,
  leaf: EventId | undefined,
  signal: AbortSignal | undefined,
): Promise<Result<readonly DurableEventEnvelope[], ContextError>> {
  const events: DurableEventEnvelope[] = [];
  for await (const read of deps.session.readBranch(threadId, leaf)) {
    if (signal?.aborted === true) return err({ kind: "aborted", message: "assemble aborted" });
    if (!read.ok) {
      return err({ kind: "read_failed", message: `session read failed: ${read.error.kind}` });
    }
    const event = read.value;
    const detached = event.detached !== undefined && event.detached.length > 0;
    events.push(detached ? await deps.session.hydrate(event) : event);
  }
  const last = events.at(-1);
  if (last === undefined || (leaf !== undefined && last.id !== leaf)) {
    return err({
      kind: "branch_not_found",
      message: `leaf ${leaf ?? "(current)"} is not on thread ${threadId}`,
    });
  }
  return ok(events);
}

/**
 * 가지 위 마지막 thread.compacted가 머리다(§4.8). firstKeptEventId가 가지에 없거나 컴팩션보다 뒤면
 * 손상으로 보고 머리를 무시한다(§5). 투영 오류로 올리지 않고 로그만 남긴다
 */
export function findHead(
  deps: BranchReaderDeps,
  events: readonly DurableEventEnvelope[],
  projected: readonly (Projected | undefined)[],
): CompactionHead | null {
  for (let index = projected.length - 1; index >= 0; index -= 1) {
    const entry = projected[index];
    const event = events[index];
    if (entry?.type !== "compacted" || event === undefined) continue;
    const { firstKeptEventId, summary, details } = entry.payload;
    const firstKeptIndex = events.findIndex((candidate) => candidate.id === firstKeptEventId);
    if (firstKeptIndex < 0 || firstKeptIndex > index) {
      deps.logger?.warn("context.compaction_head_invalid", {
        eventId: event.id,
        firstKeptEventId,
      });
      return null;
    }
    return {
      index,
      eventId: event.id,
      firstKeptEventId,
      firstKeptIndex,
      summary,
      details,
      recordedAt: event.recordedAt,
    };
  }
  return null;
}

/** 완료된 system item의 메시지. 그 밖의 항목은 undefined */
export function systemMessageOf(entry: Projected | undefined): SystemMessage | undefined {
  if (entry?.type !== "item" || entry.item.kind !== "system") return undefined;
  return entry.item.status === "in_progress" ? undefined : entry.item.message;
}

/**
 * 기록된 접두의 위치. 머리가 있으면 머리 뒤 첫 system item(컴팩션이 같은 커밋에 새 접두를 넣는다, §4.6 5번),
 * 없으면 가지의 첫 system item이다. item.recorded의 system item에는 purpose가 남지 않으므로(F.conversation
 * ItemRecord) 위치로 알아본다. 접두 뒤의 system item은 도구 변경·절 갱신이다. 없으면 -1
 */
export function findPrefixIndex(
  projected: readonly (Projected | undefined)[],
  head: CompactionHead | null,
): number {
  const from = head === null ? 0 : head.index + 1;
  for (let index = from; index < projected.length; index += 1) {
    if (systemMessageOf(projected[index]) !== undefined) return index;
  }
  return -1;
}

/**
 * 컴팩션 머리와 기록된 접두를 반영한 모델 컨텍스트 메시지(§4.1 0~2). 접두는 호출자가 정해 첫 메시지로 넣는다.
 * 도구 변경·절 갱신 item은 접두 뒤 위치 그대로 두고, 머리 앞에 기록된 것은 새 접두가 반영하므로 뺀다.
 * volatile, 변경 덧붙이기, 지점 처리는 하지 않는다
 */
export function effectiveMessages(
  events: readonly DurableEventEnvelope[],
  projected: readonly (Projected | undefined)[],
  head: CompactionHead | null,
  prefixIndex: number,
  prefixMessage: SystemMessage | undefined,
): Message[] {
  const messages: Message[] = prefixMessage === undefined ? [] : [prefixMessage];
  if (head !== null) messages.push(compactionSummaryMessage(head.summary, head.recordedAt));
  const startIndex = head === null ? 0 : head.firstKeptIndex;
  for (let index = startIndex; index < projected.length; index += 1) {
    const entry = projected[index];
    if (entry === undefined || entry.type === "compacted" || index === prefixIndex) continue;
    if (entry.type === "branch_summary") {
      const event = events[index];
      if (event !== undefined) {
        messages.push(branchSummaryMessage(entry.payload.summary, event.recordedAt));
      }
      continue;
    }
    if (entry.item.status === "in_progress") continue;
    // 머리 앞에 기록된 도구 변경·절 갱신은 새 접두가 이미 반영하고 있다
    if (entry.item.kind === "system" && head !== null && index < head.index) continue;
    messages.push(itemToMessage(entry.item));
  }
  return messages;
}

export function isSystem(message: Message): message is SystemMessage {
  return message.role === "system";
}
