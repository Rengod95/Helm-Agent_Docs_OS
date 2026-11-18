import { parse, err, ok, type Result } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import type { EventFeed } from "@fresnel/contracts/records";
import type { EventFilter } from "@fresnel/contracts/wire";

// 대화 로그(내구 사건 피드)에서 턴의 시작 시각을 찾는다. 턴 기록의 `absent` 판정이 쓴다(정본 §3.5).
// 턴 기록 행은 보관 정리로 지워질 수 있지만 로그의 `turn.started`는 남는다. 그래서 로그가 턴을 알아야 `purged`와 `turnNotFound`를 가를 수 있다.
// 피드는 `turn.started`만 훑는다(한 대화의 턴 시작 사건은 턴 수만큼이라 쪽 단위로 훑어도 짧다).

/** 한 번에 읽을 행 수와 훑을 행 수의 상한(연결 한도 `replayBatchMaxEvents`, `scanLimit`과 같은 값) */
const PAGE_LIMIT = 500;
const SCAN_LIMIT = 10_000;

/**
 * 턴의 `turn.started` 사건 시각. 로그에 없으면 undefined다. 대화 id 모양이 틀리면 없는 것과 같다.
 * 피드를 읽지 못하면 오류 값이다(`reason`은 피드의 `kind`).
 */
export function turnStartedAtInLog(
  feed: Pick<EventFeed, "headSeq" | "read">,
  threadId: string,
  turnId: string,
): Result<number | undefined, { readonly reason: string }> {
  const parsed = parse(ThreadIdSchema, threadId);
  if (!parsed.ok) return ok(undefined);
  const head = feed.headSeq();
  if (!head.ok) return err({ reason: head.error.kind });
  const filter: EventFilter = { threadIds: [parsed.value], kindPrefixes: ["turn.started"] };
  let after = 0;
  while (after < head.value) {
    const page = feed.read(after, head.value, filter, PAGE_LIMIT, SCAN_LIMIT);
    if (!page.ok) return err({ reason: page.error.kind });
    for (const event of page.value.events) {
      if (event.turnId === turnId) return ok(event.recordedAt);
    }
    // 앞으로 가지 않는 읽기는 끝낸다(무한 반복을 막는다)
    if (page.value.scannedTo <= after) break;
    after = page.value.scannedTo;
  }
  return ok(undefined);
}
