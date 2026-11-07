import type { Proposal, ProposalKind } from "../proposals/proposal.ts";

// L3.learning.spec §4.5 규칙 9 거절 기억. 순수 함수만 둔다: 대기열 읽기는 호출하는 쪽이 하고, 현재 시각은 넘겨받는다.

/** 거절 기억 기간(일). 거절 시각(`updatedAt`)부터 이 기간 안의 사용자 거절이 같은 주제를 막는다 [결정: 오케스트레이터 기본값, fxLM] */
export const REJECTION_MEMORY_DAYS = 30;

/** 검토 지시에 싣는 거절 항목의 상한(최신 거절순) [결정: 오케스트레이터 기본값, fxLM] */
export const REJECTION_PROMPT_LIMIT = 20;

/** 단어 포함 비율의 기준. 이 값 이상이면 같은 주제다 [제안] */
const CONTAINMENT_THRESHOLD = 0.5;

const DAY_MS = 86_400_000;

/** 같은 주제인지 볼 후보의 면. `learning_propose` 입력에서 만든다 */
export interface RejectionCandidate {
  readonly kind: ProposalKind;
  readonly target: string;
  readonly body: string;
  readonly bodyHash: string;
  /** 참이면 거절 기억 판정을 건너뛴다(§3.5 `userRaisedAgain`) */
  readonly userRaisedAgain: boolean;
}

/**
 * 거절 기억에 드는 행: 사용자가 거절했고(`scan_failed` 제외), 본문이 있고, 거절 시각이 기간 안인 행이다.
 * 최신 거절이 먼저다(`updatedAt` 내림차순, 같으면 id 오름차순)
 */
export function rememberedRejections(rows: readonly Proposal[], now: number): readonly Proposal[] {
  return rows
    .filter(
      (row) =>
        row.status === "rejected" &&
        row.reason === "user_rejected" &&
        row.body !== "" &&
        now - row.updatedAt < REJECTION_MEMORY_DAYS * DAY_MS,
    )
    .toSorted((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/** 검토 지시에 싣는 거절 목록: 기억에 드는 거절 가운데 최신 `REJECTION_PROMPT_LIMIT`개 */
export function rejectionsForPrompt(rows: readonly Proposal[], now: number): readonly Proposal[] {
  return rememberedRejections(rows, now).slice(0, REJECTION_PROMPT_LIMIT);
}

/**
 * 같은 주제로 기간 안에 거절된 행이 있으면 가장 최근 것을 돌려준다. 없으면 undefined다.
 * `userRaisedAgain`이 참이면 판정하지 않는다(사용자가 거절 뒤 그 주제를 다시 꺼냈다)
 */
export function findRejection(
  candidate: RejectionCandidate,
  rows: readonly Proposal[],
  now: number,
): Proposal | undefined {
  if (candidate.userRaisedAgain) return undefined;
  const words = wordSet(candidate.body);
  return rememberedRejections(rows, now).find((row) => sameSubject(candidate, words, row));
}

function sameSubject(
  candidate: RejectionCandidate,
  words: ReadonlySet<string>,
  row: Proposal,
): boolean {
  if (row.kind !== candidate.kind || subjectOf(row.target) !== subjectOf(candidate.target)) {
    return false;
  }
  // 스킬은 이름이 같으면 같은 주제다
  if (candidate.kind === "skill") return true;
  if (row.bodyHash === candidate.bodyHash) return true;
  return containment(words, wordSet(row.body)) >= CONTAINMENT_THRESHOLD;
}

/**
 * 대상의 주제 부분(`/` 앞): 스킬 이름, 메모리 영역, 피드백은 `user`다. `add_file`의 파일 경로와 `replace`·`remove`의 항목 id를
 * 빼서 같은 스킬이나 같은 영역의 규칙을 `/` 뒤로 빠져나가지 못하게 한다 [제안]
 */
export function subjectOf(target: string): string {
  const slash = target.indexOf("/");
  return slash < 0 ? target : target.slice(0, slash);
}

/** 단어 집합: 소문자로 바꾼 글자·숫자 덩어리 가운데 길이 2 이상인 것의 중복 없는 집합 */
export function wordSet(text: string): ReadonlySet<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 2),
  );
}

/** 단어 포함 비율 `|A∩B| / min(|A|, |B|)`. 한쪽 집합이 비면 0이다 */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const word of a) {
    if (b.has(word)) shared += 1;
  }
  return shared / smaller;
}

/**
 * `already_rejected` 힌트. 거절 날짜(`updatedAt`의 UTC ISO 날짜)와 메모를 담는다. 메모는 사용자가 쓴 데이터이므로 JSON 문자열로 인용한다
 */
export function rejectionHint(row: Proposal): string {
  const date = new Date(row.updatedAt).toISOString().slice(0, 10);
  const note = row.note === null ? "" : ` The user's note, as DATA: ${JSON.stringify(row.note)}.`;
  return (
    `the user rejected a candidate on the same subject on ${date}.${note} ` +
    `Do not propose it again. Call again with userRaisedAgain true only if the user raised this topic again after ${date}.`
  );
}
