import type { Result } from "@fresnel/contracts";
import type {
  TurnSummary,
  WireParams,
  WireRequestOptions,
  WireResult,
} from "@fresnel/contracts/wire";
import {
  callTurnRecord,
  type TurnRecordConnection,
  type TurnRecordFailure,
  type TurnRecordMethod,
} from "./call.ts";

// 턴 기록과 지표의 읽기 함수. 요청과 응답 모양은 F의 메서드 표(`WireParams`, `WireResult`)에서 가져온다.
// 쓰기(`turnRecord.mark`, `findings.dismiss`)도 같은 틀로 낸다.

/** 읽기 결과 하나. 실패 갈래는 `TurnRecordFailure`다 */
export type TurnRecordRead<M extends TurnRecordMethod> = Promise<
  Result<WireResult<M>, TurnRecordFailure>
>;

/** 턴 목록 한 쪽(`turnRecord.list`). `next`가 null이면 마지막 쪽이다 */
export function listTurnRecords(
  connection: TurnRecordConnection,
  params: WireParams<"turnRecord.list">,
  options?: WireRequestOptions,
): TurnRecordRead<"turnRecord.list"> {
  return callTurnRecord(connection, "turnRecord.list", params, options);
}

/** 턴 기록 하나(`turnRecord.get`). 기록이 없으면 `record`가 null이고 `absent`가 이유를 준다 */
export function getTurnRecord(
  connection: TurnRecordConnection,
  params: WireParams<"turnRecord.get">,
  options?: WireRequestOptions,
): TurnRecordRead<"turnRecord.get"> {
  return callTurnRecord(connection, "turnRecord.get", params, options);
}

/** 훅 결과로 턴을 찾는다(`turnRecord.search`). 한 쪽씩 돌려준다 */
export function searchTurnRecords(
  connection: TurnRecordConnection,
  params: WireParams<"turnRecord.search">,
  options?: WireRequestOptions,
): TurnRecordRead<"turnRecord.search"> {
  return callTurnRecord(connection, "turnRecord.search", params, options);
}

/** "지침을 따랐나" 사용자 표시를 남긴다(`turnRecord.mark`). Inject만 하는 플러그인에만 받는다 */
export function markTurnRecord(
  connection: TurnRecordConnection,
  params: WireParams<"turnRecord.mark">,
  options?: WireRequestOptions,
): TurnRecordRead<"turnRecord.mark"> {
  return callTurnRecord(connection, "turnRecord.mark", params, options);
}

/** 지표 정의 목록(`metrics.catalog`). 표시 이름과 단위, 정의 문장을 준다 */
export function metricsCatalog(
  connection: TurnRecordConnection,
  options?: WireRequestOptions,
): TurnRecordRead<"metrics.catalog"> {
  return callTurnRecord(connection, "metrics.catalog", {}, options);
}

/** 지표 값 조회(`metrics.query`). 값마다 `state`와 `reason`이 있어 화면이 없는 값을 0으로 보이지 않게 한다 */
export function queryMetrics(
  connection: TurnRecordConnection,
  params: WireParams<"metrics.query">,
  options?: WireRequestOptions,
): TurnRecordRead<"metrics.query"> {
  return callTurnRecord(connection, "metrics.query", params, options);
}

/** 발견 목록(`findings.list`). `asOf`와 `dataRevision`으로 같은 시점의 결과인지 판단한다 */
export function listFindings(
  connection: TurnRecordConnection,
  params: WireParams<"findings.list">,
  options?: WireRequestOptions,
): TurnRecordRead<"findings.list"> {
  return callTurnRecord(connection, "findings.list", params, options);
}

/** 발견의 근거 한 쪽(`findings.evidence`) */
export function findingEvidence(
  connection: TurnRecordConnection,
  params: WireParams<"findings.evidence">,
  options?: WireRequestOptions,
): TurnRecordRead<"findings.evidence"> {
  return callTurnRecord(connection, "findings.evidence", params, options);
}

/** 발견을 덮는다(`findings.dismiss`). 결과는 빈 값이다 */
export function dismissFinding(
  connection: TurnRecordConnection,
  params: WireParams<"findings.dismiss">,
  options?: WireRequestOptions,
): TurnRecordRead<"findings.dismiss"> {
  return callTurnRecord(connection, "findings.dismiss", params, options);
}

/** 발견 하나의 묶음(`findings.bundle`). 16 KiB 이하이고 id·해시·숫자만 있다 */
export function findingBundle(
  connection: TurnRecordConnection,
  params: WireParams<"findings.bundle">,
  options?: WireRequestOptions,
): TurnRecordRead<"findings.bundle"> {
  return callTurnRecord(connection, "findings.bundle", params, options);
}

/** 프로필 한 개의 플러그인별 비용(`profileCost.get`) */
export function getProfileCost(
  connection: TurnRecordConnection,
  params: WireParams<"profileCost.get">,
  options?: WireRequestOptions,
): TurnRecordRead<"profileCost.get"> {
  return callTurnRecord(connection, "profileCost.get", params, options);
}

/** 테스트 실행 대화 둘 이상을 나란히 비교한다(`testRun.compare`) */
export function compareTestRuns(
  connection: TurnRecordConnection,
  params: WireParams<"testRun.compare">,
  options?: WireRequestOptions,
): TurnRecordRead<"testRun.compare"> {
  return callTurnRecord(connection, "testRun.compare", params, options);
}

/** 쪽 나눔의 상한. 쪽 수를 넘거나 시한이 지나면 멈추고 `truncated`로 알린다. 시계는 주입받는다(TY-21) */
export interface PagePolicy {
  readonly maxPages: number;
  /** 시작부터의 시한(ms). 쪽 요청마다 남은 시간을 그 요청의 시한으로 준다 */
  readonly deadlineMs: number;
  readonly now: () => number;
}

/** 쪽 하나: 항목과 다음 커서. `next`가 null이면 마지막 쪽이다 */
export interface PageOf<T> {
  readonly items: readonly T[];
  readonly next: string | null;
}

/** 모은 항목. `truncated`가 null이면 모든 쪽을 받은 것이고, 아니면 어디서 멈췄는지다 */
export interface CollectedPages<T> {
  readonly items: readonly T[];
  readonly truncated: "pages" | "deadline" | null;
}

/**
 * 커서 쪽 나눔을 끝까지 모은다. `fetchPage`는 커서(첫 쪽은 undefined)와 남은 시한(ms)을 받는다.
 * 쪽을 받다 실패하면 그 실패를 그대로 돌려준다(모은 항목은 버린다). 시한이 지난 뒤의 쪽 요청은 전송 실패(시한)가 된다.
 */
export async function collectPages<T>(
  fetchPage: (
    cursor: string | undefined,
    timeoutMs: number,
  ) => Promise<Result<PageOf<T>, TurnRecordFailure>>,
  policy: PagePolicy,
): Promise<Result<CollectedPages<T>, TurnRecordFailure>> {
  return collectFrom(fetchPage, policy, policy.now() + policy.deadlineMs, undefined, 1, []);
}

/** `collectPages`의 한 쪽. 쪽마다 다음 쪽을 부른다(쪽 수는 상한이 막는다) */
async function collectFrom<T>(
  fetchPage: (
    cursor: string | undefined,
    timeoutMs: number,
  ) => Promise<Result<PageOf<T>, TurnRecordFailure>>,
  policy: PagePolicy,
  deadlineAt: number,
  cursor: string | undefined,
  page: number,
  items: readonly T[],
): Promise<Result<CollectedPages<T>, TurnRecordFailure>> {
  if (page > policy.maxPages) return { ok: true, value: { items, truncated: "pages" } };
  const remaining = deadlineAt - policy.now();
  if (remaining <= 0) return { ok: true, value: { items, truncated: "deadline" } };
  const got = await fetchPage(cursor, remaining);
  if (!got.ok) return { ok: false, error: got.error };
  const all = [...items, ...got.value.items];
  if (got.value.next === null) return { ok: true, value: { items: all, truncated: null } };
  return collectFrom(fetchPage, policy, deadlineAt, got.value.next, page + 1, all);
}

/**
 * 턴 목록을 모든 쪽에 걸쳐 모은다(`turnRecord.list`를 커서로 이어 부른다). `params`에는 커서를 주지 않는다.
 * 첫 쪽 요청에는 커서 키가 없다.
 */
export function listAllTurnRecords(
  connection: TurnRecordConnection,
  params: Omit<WireParams<"turnRecord.list">, "cursor">,
  policy: PagePolicy,
): Promise<Result<CollectedPages<TurnSummary>, TurnRecordFailure>> {
  return collectPages<TurnSummary>(async (cursor, timeoutMs) => {
    const page = await listTurnRecords(
      connection,
      cursor === undefined ? params : { ...params, cursor },
      { timeoutMs },
    );
    if (!page.ok) return { ok: false, error: page.error };
    return { ok: true, value: { items: page.value.items, next: page.value.next } };
  }, policy);
}
