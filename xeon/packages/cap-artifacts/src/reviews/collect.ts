import { err, ok, parse, type Result } from "@xeon/contracts";
import { FileChangeSchema } from "@xeon/contracts/capabilities";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  ItemRecordedPayloadSchema,
  type DurableEventEnvelope,
  type EventFeed,
  type ReadFailure,
} from "@xeon/contracts/records";

// L2.artifacts.spec §4.2.1. 도구 결과(`item.recorded`의 toolResult)에서 workspace 쓰기 도구의 변경 기록(`FileChange`)을 모은다.
// 이벤트를 읽는다. `p_tool_calls` 같은 다른 컨텍스트 테이블은 읽지 않는다(CM-02).

export interface CollectedDiff {
  readonly toolCallId: string;
  readonly diff: string;
}

const PAGE = 2000;

/**
 * 접두가 맞는 이벤트를 커밋 순서로 모두 읽는다. `threadId`가 없으면 모든 세션의 이벤트다(산출물 목록과 찾기에 쓴다).
 */
export function readEvents(
  feed: Pick<EventFeed, "headSeq" | "read">,
  threadId: ThreadId | undefined,
  kindPrefixes: readonly string[],
): Result<readonly DurableEventEnvelope[], ReadFailure> {
  const head = feed.headSeq();
  if (!head.ok) return head;
  const events: DurableEventEnvelope[] = [];
  let after = 0;
  while (after < head.value) {
    const page = feed.read(
      after,
      head.value,
      threadId === undefined ? { kindPrefixes } : { threadIds: [threadId], kindPrefixes },
      PAGE,
      PAGE * 4,
    );
    if (!page.ok) return page;
    events.push(...page.value.events);
    if (page.value.scannedTo <= after) break;
    after = page.value.scannedTo;
  }
  return ok(events);
}

/**
 * `turn`이면 그 turn의 도구 결과를, `toolCalls`면 지정한 호출의 결과를 호출 순서로 돌려준다.
 * 오류 결과, 변경 기록이 없는 결과, 바뀐 줄이 없는 결과(diff가 빔)는 건너뛴다.
 */
export function collectDiffs(
  feed: Pick<EventFeed, "headSeq" | "read">,
  threadId: ThreadId,
  source:
    | { readonly type: "turn"; readonly turnId: TurnId }
    | { readonly type: "toolCalls"; readonly toolCallIds: readonly string[] },
): Result<readonly CollectedDiff[], ReadFailure> {
  const events = readEvents(feed, threadId, ["item.recorded"]);
  if (!events.ok) return err(events.error);
  const wanted = source.type === "toolCalls" ? new Set(source.toolCallIds) : undefined;
  const out: CollectedDiff[] = [];
  for (const event of events.value) {
    if (source.type === "turn" && event.turnId !== source.turnId) continue;
    const payload = parse(ItemRecordedPayloadSchema, event.payload);
    if (!payload.ok || payload.value.item.kind !== "toolResult") continue;
    const message = payload.value.item.message;
    if (message.isError) continue;
    if (wanted !== undefined && !wanted.has(message.toolCallId)) continue;
    const change = parse(FileChangeSchema, message.details);
    if (!change.ok || change.value.diff === "") continue;
    out.push({ toolCallId: message.toolCallId, diff: change.value.diff });
  }
  return ok(out);
}
