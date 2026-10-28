import { ok } from "@xeon/contracts";
import {
  applyLearningEvent,
  decodeEvent,
  type LearningQueueReader,
  type ProjectionRows,
  type Proposal,
  type ReviewRow,
} from "../../src/index.ts";

// 투영의 메모리 구현. 같은 규칙(`applyLearningEvent`)으로 기록을 접어 행을 만든다. SQL 투영기와 읽기 구현은 apps/host 시험이 실제 세션 DB로 확인한다.

export interface FoldedEvent {
  readonly kind: string;
  readonly payload: unknown;
}

function key(threadId: string, requestId: string): string {
  return `${threadId}|${requestId}`;
}

export function createMemoryRows(): ProjectionRows & {
  readonly proposals: Map<string, Proposal>;
  readonly reviews: Map<string, ReviewRow>;
} {
  const proposals = new Map<string, Proposal>();
  const reviews = new Map<string, ReviewRow>();
  return {
    proposals,
    reviews,
    getProposal: (id) => proposals.get(id),
    putProposal(proposal) {
      proposals.set(proposal.id, proposal);
    },
    getReview: (threadId, requestId) => reviews.get(key(threadId, requestId)),
    putReview(review) {
      reviews.set(key(review.threadId, review.requestId), review);
    },
  };
}

/** 기록을 순서대로 접는다. 후보를 만든 자식 thread의 기록이 먼저 오도록 호출하는 쪽이 정한다 */
export function foldEvents(events: readonly FoldedEvent[]): ReturnType<typeof createMemoryRows> {
  const rows = createMemoryRows();
  for (const event of events) {
    const decoded = decodeEvent(event.kind, event.payload);
    if (decoded !== undefined) applyLearningEvent(rows, decoded);
  }
  return rows;
}

/** 읽을 때마다 기록을 새로 접는 읽기 구현. `events()`는 그때까지 커밋된 기록 전부를 접는 순서로 돌려준다 */
export function foldReader(events: () => readonly FoldedEvent[]): LearningQueueReader {
  return {
    getProposal: (id) => Promise.resolve(ok(foldEvents(events()).proposals.get(id))),
    listProposals(filter) {
      const rows = [...foldEvents(events()).proposals.values()]
        .filter(
          (row) =>
            (filter.statuses === undefined || filter.statuses.includes(row.status)) &&
            (filter.reviewId === undefined || row.reviewId === filter.reviewId),
        )
        .toSorted((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return Promise.resolve(ok(filter.limit === undefined ? rows : rows.slice(0, filter.limit)));
    },
    getReviewByChild: (child) =>
      Promise.resolve(
        ok([...foldEvents(events()).reviews.values()].find((row) => row.childThreadId === child)),
      ),
    getReview: (threadId, requestId) =>
      Promise.resolve(ok(foldEvents(events()).reviews.get(`${threadId}|${requestId}`))),
    listReviews: (filter) =>
      Promise.resolve(
        ok(
          [...foldEvents(events()).reviews.values()].filter(
            (row) =>
              (filter.threadId === undefined || row.threadId === filter.threadId) &&
              (filter.unfinished !== true || row.finishedAt === null),
          ),
        ),
      ),
  };
}
