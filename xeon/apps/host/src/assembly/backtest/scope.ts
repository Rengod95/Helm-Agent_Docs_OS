import { err, ok, type Result } from "@fresnel/contracts";
import type { BacktestScope, ScopeKind, TurnRecord, TurnSummary } from "@fresnel/contracts/wire";
import type { TurnRecordReadPort } from "../measure/turn-read.ts";

// 돌려 볼 턴 고르기(turn-record-metrics.md §4.8 규칙 52). 범위는 `turns`가 있으면 그것만, 없으면 대화 목록과 프로필과 시각으로 고른다.
// 최근 턴은 대화를 가리지 않고 전체에서 가장 나중 N개다. 보관 기간이 지난 턴은 기록이 없어 빠진다.
// 결과는 대화 순서(처음 나온 순서)와 턴 시각순이다. 이것이 돌려 보기의 실행 순서다(규칙 47).

/** 한 번 돌리기의 설정 값(§3.6). 실행 시작 때 한 번 읽는다 */
export interface BacktestSettingsValues {
  readonly maxTurns: number;
  readonly maxCalls: number;
  readonly callTimeoutMs: number;
  readonly totalTimeoutMs: number;
}

/** 고른 턴 하나. 기록 전체를 들고 있다 */
export interface SelectedTurn {
  readonly threadId: string;
  readonly turnId: string;
  readonly startedAt: number;
  readonly record: TurnRecord;
}

/** 턴 고르기가 쓰는 면. 읽기 포트 전체를 넘기지 않는다 */
export interface ScopeSource {
  readonly turns: Pick<TurnRecordReadPort, "list" | "get">;
  /** 알고 있는 대화 id 목록(처음 나온 순서가 실행 순서다) */
  readonly threadIds: () => readonly string[];
}

/** 턴 기록을 읽지 못했다. 실행 전체가 실패한다(턴이 없는 것과 다르다) */
export interface ScopeFailure {
  readonly kind: "turn_read";
  readonly reason: string;
}

/** 최근 턴의 기본 수와 상한(§3.5 표). 상한은 한 번에 돌리는 턴 상한과 50 가운데 작은 값이다 */
const LAST_TURNS_DEFAULT = 20;
const LAST_TURNS_CAP = 50;
/** 목록 한 쪽의 크기(`turnRecord.list`의 상한과 같다) */
const LIST_PAGE = 200;

/** 범위의 기본 포함 집합(§4.8 규칙 52). 테스트 실행과 초안 덧씌움은 `include`로 넣는다 */
const DEFAULT_INCLUDE: readonly ScopeKind[] = ["live"];

/** 목록의 모든 쪽을 읽어 대화 하나의 턴 요약을 모은다 */
function listedOf(
  source: ScopeSource,
  threadId: string,
): Result<readonly TurnSummary[], ScopeFailure> {
  const out: TurnSummary[] = [];
  let cursor: string | undefined;
  let more = true;
  while (more) {
    const page = source.turns.list(
      cursor === undefined
        ? { threadId, limit: LIST_PAGE }
        : { threadId, limit: LIST_PAGE, cursor },
    );
    if (!page.ok) return err({ kind: "turn_read", reason: page.error.kind });
    out.push(...page.value.items);
    cursor = page.value.next ?? undefined;
    more = cursor !== undefined;
  }
  return ok(out);
}

/** 턴 하나의 기록을 읽는다. 기록이 없거나 로그에 없는 턴은 `undefined`(대상이 아님)이다 */
function recordOf(
  source: ScopeSource,
  threadId: string,
  turnId: string,
): Result<TurnRecord | undefined, ScopeFailure> {
  const got = source.turns.get(threadId, turnId);
  if (!got.ok) {
    if (got.error.kind === "turn_missing") return ok(undefined);
    return err({ kind: "turn_read", reason: got.error.kind });
  }
  return ok(got.value.record ?? undefined);
}

/** 범위에 드는 턴을 실행 순서대로 돌려준다. 같은 대화 안에서는 시각순이다 */
export function selectTurns(
  source: ScopeSource,
  scope: BacktestScope,
  settings: BacktestSettingsValues,
): Result<SelectedTurn[], ScopeFailure> {
  const include: readonly ScopeKind[] = scope.include ?? DEFAULT_INCLUDE;
  const picked: SelectedTurn[] = [];

  if (scope.turns !== undefined) {
    for (const ref of scope.turns.slice(0, settings.maxTurns)) {
      const record = recordOf(source, ref.threadId, ref.turnId);
      if (!record.ok) return record;
      if (record.value === undefined || !include.includes(record.value.scope)) continue;
      picked.push({
        threadId: ref.threadId,
        turnId: ref.turnId,
        startedAt: record.value.startedAt,
        record: record.value,
      });
    }
    return ok(
      inExecutionOrder(
        picked,
        scope.turns.map((ref) => ref.threadId),
      ),
    );
  }

  const threadIds = scope.threadIds ?? source.threadIds();
  const candidates: TurnSummary[] = [];
  for (const threadId of threadIds) {
    const listed = listedOf(source, threadId);
    if (!listed.ok) return listed;
    for (const summary of listed.value) {
      if (!include.includes(summary.scope)) continue;
      if (scope.profileId !== undefined && summary.profileId !== scope.profileId) continue;
      if (scope.sinceMs !== undefined && summary.startedAt < scope.sinceMs) continue;
      candidates.push(summary);
    }
  }
  const limit = Math.min(scope.lastTurns ?? LAST_TURNS_DEFAULT, LAST_TURNS_CAP, settings.maxTurns);
  const newest = candidates.toSorted((a, b) => b.startedAt - a.startedAt);
  for (const summary of newest.slice(0, limit)) {
    const record = recordOf(source, summary.threadId, summary.turnId);
    if (!record.ok) return record;
    if (record.value === undefined) continue;
    picked.push({
      threadId: summary.threadId,
      turnId: summary.turnId,
      startedAt: summary.startedAt,
      record: record.value,
    });
  }
  return ok(inExecutionOrder(picked, threadIds));
}

/** 대화는 처음 나온 순서로, 턴은 시각순으로 놓는다. `order`는 대화의 첫 등장 순서다 */
function inExecutionOrder(
  turns: readonly SelectedTurn[],
  threadOrder: readonly string[],
): SelectedTurn[] {
  const rankOf = new Map<string, number>();
  for (const threadId of threadOrder) {
    if (!rankOf.has(threadId)) rankOf.set(threadId, rankOf.size);
  }
  return turns.toSorted((a, b) => {
    const threadRank = (rankOf.get(a.threadId) ?? 0) - (rankOf.get(b.threadId) ?? 0);
    return threadRank !== 0 ? threadRank : a.startedAt - b.startedAt;
  });
}
