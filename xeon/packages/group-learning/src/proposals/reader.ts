import type { Result } from "@xeon/contracts";
import type { LearningError } from "../results.ts";
import type { Proposal, ProposalStatus } from "./proposal.ts";

// 대기열 읽기 면. L3.learning.spec §3.7.2의 `x_learning_proposals`·`x_learning_reviews`(이벤트 투영)를 읽는다. 쓰기는 `g.recordPrivate`가 낸 이벤트뿐이고
// 투영기(`learningProjector`)가 이 표를 갱신한다. 조립 루트는 세션 DB의 읽기 구현(`createSqlReader`)을 넘기고, 시험은 이벤트를 접은 구현을 넘긴다.

export type StoreFailure = Extract<LearningError, { kind: "learning.storeUnavailable" }>;
export type StoreResult<T> = Result<T, StoreFailure>;

export type ReviewOutcome = "completed" | "aborted" | "error" | "budget";

/** 검토 하나의 실행 기록(`x_learning_reviews`) */
export interface ReviewRow {
  readonly requestId: string;
  /** 부모 대화 */
  readonly threadId: string;
  readonly childThreadId: string;
  readonly epoch: number;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly outcome: ReviewOutcome | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ProposalFilter {
  readonly statuses?: readonly ProposalStatus[];
  readonly reviewId?: string;
  readonly limit?: number;
}

export interface ReviewFilter {
  readonly threadId?: string;
  readonly unfinished?: boolean;
}

export interface LearningQueueReader {
  getProposal(id: string): Promise<StoreResult<Proposal | undefined>>;
  /** createdAt 내림차순, 같으면 id 오름차순 */
  listProposals(filter: ProposalFilter): Promise<StoreResult<readonly Proposal[]>>;
  getReviewByChild(childThreadId: string): Promise<StoreResult<ReviewRow | undefined>>;
  getReview(threadId: string, requestId: string): Promise<StoreResult<ReviewRow | undefined>>;
  listReviews(filter: ReviewFilter): Promise<StoreResult<readonly ReviewRow[]>>;
}

/** 후보를 목록 순서(createdAt 내림차순, id 오름차순)로 정렬한다. 읽기 구현이 같은 순서를 낸다 */
export function sortProposals(rows: readonly Proposal[]): readonly Proposal[] {
  return rows.toSorted((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
