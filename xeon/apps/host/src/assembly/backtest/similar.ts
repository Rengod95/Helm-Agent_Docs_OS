import type { BacktestSummary } from "@fresnel/contracts/wire";

// 비슷하지만 못 잡은 호출(turn-record-metrics.md §4.8 규칙 51). 후보가 통과시킨 호출만 대상이고, 후보가 막은 호출과
// 같은 도구에 같은 대상(`targetKey`)이거나 문자열 인자 토큰의 자카드 겹침이 0.6 이상이면 든다. 최대 20개다.
// 토큰 규칙은 `core-tools/src/call-trace.ts`의 `argTokensOf`와 같다. 그 함수는 패키지 색인에 없어 여기에 같은 규칙을 둔다.

/** 비슷함을 볼 때의 겹침 기준(규칙 51) */
const OVERLAP_MIN = 0.6;
/** 결과에 싣는 최대 개수(§3.7) */
export const SIMILAR_MAX = 20;

/** 토큰 목록 상한과 글자 범위(`argTokensOf`와 같다) */
const TOKEN_LIMIT = 64;
const TOKEN_MIN_CHARS = 2;
const TOKEN_MAX_CHARS = 64;
const TOKEN_SEPARATOR = /[^\p{L}\p{M}\p{N}]+/u;

/** 최상위 문자열 인자를 키 순서로 읽어 토큰 목록을 만든다. 처음 나온 순서로 중복을 뺀다 */
export function argTokensOf(args: Readonly<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const key of Object.keys(args).toSorted()) {
    const value = args[key];
    if (typeof value !== "string") continue;
    for (const piece of value.split(TOKEN_SEPARATOR)) {
      const word = Array.from(piece.toLowerCase());
      if (word.length < TOKEN_MIN_CHARS) continue;
      seen.add(word.slice(0, TOKEN_MAX_CHARS).join(""));
      if (seen.size >= TOKEN_LIMIT) return [...seen];
    }
  }
  return [...seen];
}

/** 두 토큰 목록의 자카드 겹침. 둘 다 비었으면 0이다 */
export function jaccardOf(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let both = 0;
  for (const token of left) if (right.has(token)) both += 1;
  const union = left.size + right.size - both;
  return union === 0 ? 0 : both / union;
}

/** 유사 판정에 드는 호출 한 줄. `role`은 후보의 결과가 막음(`stopped`)인지 통과(`passed`)인지다 */
export interface SimilarCall {
  readonly toolCallId: string;
  readonly tool: string;
  readonly targetKey: string | null;
  readonly argTokens: readonly string[];
  readonly role: "stopped" | "passed" | "other";
}

/**
 * 후보가 통과시킨 호출마다 후보가 막은 호출과 비슷한 것을 찾는다. 같은 대상이 먼저이고(점수 없음), 없으면 겹침이 가장 큰 것이다.
 * 결과에는 호출 id만 싣는다.
 */
export function similarNotCaughtOf(
  calls: readonly SimilarCall[],
): BacktestSummary["similarNotCaught"] {
  const blocked = calls.filter((call) => call.role === "stopped");
  const out: BacktestSummary["similarNotCaught"][number][] = [];
  for (const call of calls) {
    if (out.length >= SIMILAR_MAX) break;
    if (call.role !== "passed") continue;
    const sameTarget = blocked.find(
      (other) =>
        other.tool === call.tool && call.targetKey !== null && other.targetKey === call.targetKey,
    );
    if (sameTarget !== undefined) {
      out.push({
        toolCallId: call.toolCallId,
        similarTo: sameTarget.toolCallId,
        why: "same_tool_same_target",
        score: null,
      });
      continue;
    }
    let best: { readonly id: string; readonly score: number } | undefined;
    for (const other of blocked) {
      if (other.tool !== call.tool) continue;
      const score = jaccardOf(call.argTokens, other.argTokens);
      if (score < OVERLAP_MIN) continue;
      if (best === undefined || score > best.score) best = { id: other.toolCallId, score };
    }
    if (best !== undefined) {
      out.push({
        toolCallId: call.toolCallId,
        similarTo: best.id,
        why: "arg_overlap",
        score: best.score,
      });
    }
  }
  return out;
}
