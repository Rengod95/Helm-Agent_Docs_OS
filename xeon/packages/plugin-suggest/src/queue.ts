import { attemptAsync, parse, parseJson } from "@fresnel/contracts";
import {
  isCapabilityError,
  type CapabilityApi,
  type KnowledgeLedger,
} from "@fresnel/contracts/capabilities";
import {
  knowledgeStatusesOf,
  proposalRowOf,
  type ProposalListResult,
  type ProposalStatusWire,
} from "@fresnel/contracts/wire";
import { Type } from "typebox";

// 제안 목록과 대기 개수. 지식 대기열(`knowledge.ledger`의 `proposals`)을 호스트 wire `proposal.list`와 같은 규칙으로 읽는다:
// 행 모양은 F의 `proposalRowOf`, 정렬은 `createdAt` 내림차순(같으면 id 오름차순), 커서는 불투명 base64url JSON이다.
// 결정(승인과 거절)은 이 플러그인의 일이 아니다. 사용자만 하며 호스트 wire `proposal.decide`가 한다.

/** 이 플러그인이 쓰는 대기열 읽기 하나. 기능 API는 이 모양을 채운다. 시험은 같은 모양의 대역을 준다 */
export type LedgerReader = Pick<CapabilityApi<typeof KnowledgeLedger>, "proposals">;

const DEFAULT_LIMIT = 50;
/** 쪽 크기 상한. 요청한 `limit`이 더 커도 이 크기로 줄여 돌려주고 `nextCursor`가 이어 간다 */
const PAGE_MAX = 100;
/** 같은 `createdAt`의 행이 쪽 경계에 걸릴 때를 위한 여유 행 수(대기열의 같은 시각 정렬은 id 내림차순이라 합친 목록과 반대다) */
const TIE_PAD = 50;
/** 대기열 한 번 읽기의 상한(`knowledge.ledger` proposals의 limit 최대) */
export const LEDGER_MAX = 200;

interface RowKey {
  readonly createdAt: number;
  readonly id: string;
}

/** 합친 목록의 순서: `createdAt` 내림차순, 같으면 id 오름차순 */
function compareKeys(a: RowKey, b: RowKey): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

const CursorSchema = Type.Object(
  {
    createdAt: Type.Integer({ minimum: 0 }),
    source: Type.Literal("knowledge"),
    id: Type.String(),
  },
  { additionalProperties: false },
);

/** 호스트 `proposal.list`의 커서와 같은 모양이다(출처는 지식으로 고정). 같은 커서를 두 쪽이 읽는다 */
function encodeCursor(row: RowKey): string {
  const cursor = { createdAt: row.createdAt, source: "knowledge", id: row.id };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** 불투명 커서. 읽을 수 없으면 undefined이고 호출한 쪽은 처음부터 읽는다 */
function decodeCursor(text: string | undefined): RowKey | undefined {
  if (text === undefined) return undefined;
  const json = parseJson(Buffer.from(text, "base64url").toString("utf8"));
  if (!json.ok) return undefined;
  const parsed = parse(CursorSchema, json.value);
  return parsed.ok ? parsed.value : undefined;
}

function afterCursor(row: RowKey, cursor: RowKey | undefined): boolean {
  return cursor === undefined || compareKeys(row, cursor) > 0;
}

/** 목록 메서드의 입력(`SuggestListParams`의 값). 출처는 받지 않는다: 이 플러그인은 지식 대기열만 읽는다 */
export interface SuggestListParams {
  readonly status?: readonly ProposalStatusWire[];
  readonly limit?: number;
  readonly cursor?: string;
}

/**
 * 제안 목록 한 쪽. 호스트 `proposal.list`의 지식 출처 경로와 같은 결과를 낸다. 읽기가 기능 오류로 실패하면
 * `unavailable`에 `knowledge`를 올리고 빈 목록을 준다. 다른 실패는 호출한 쪽(확장 메서드 처리기)에 그대로 던진다.
 */
export async function listSuggestions(
  ledger: LedgerReader,
  params: SuggestListParams,
): Promise<ProposalListResult> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, PAGE_MAX);
  const cursor = decodeCursor(params.cursor);
  const statuses = knowledgeStatusesOf(params.status);
  // 지식 상태가 하나도 없는 필터는 빈 목록이다(읽지 않는다)
  if (statuses === undefined) return { proposals: [], nextCursor: null, unavailable: [] };
  const read = await attemptAsync(() =>
    ledger.proposals({
      ...(statuses.length === 0 ? {} : { statuses: [...statuses] }),
      limit: Math.min(limit + 1 + TIE_PAD, LEDGER_MAX),
      // 커서가 있으면 그 시각 이전(같은 시각 포함)부터 읽는다. 같은 시각의 앞선 행은 `afterCursor`로 거른다
      ...(cursor === undefined
        ? {}
        : { before: { createdAt: cursor.createdAt + 1, proposalId: "" } }),
    }),
  );
  if (!read.ok) {
    if (isCapabilityError(read.error.cause)) {
      return { proposals: [], nextCursor: null, unavailable: ["knowledge"] };
    }
    throw read.error.cause;
  }
  const ordered = read.value.proposals
    .map(proposalRowOf)
    .toSorted(compareKeys)
    .filter((row) => afterCursor(row, cursor));
  const page = ordered.slice(0, limit);
  const last = page.at(-1);
  return {
    proposals: page,
    nextCursor: ordered.length > limit && last !== undefined ? encodeCursor(last) : null,
    unavailable: [],
  };
}

/** 대기 개수 결과. 읽지 못하면 `unavailable`이고 개수는 없다 */
export type PendingCount =
  | { readonly ok: true; readonly count: number; readonly capped: boolean }
  | { readonly ok: false; readonly reason: "unavailable" };

/**
 * 대기(`pending`) 제안 수. 대기 목록을 상한(`LEDGER_MAX`) 안에서 세므로 `capped`가 참이면 그 이상이 더 있을 수 있다.
 */
export async function countPending(ledger: LedgerReader): Promise<PendingCount> {
  const read = await attemptAsync(() =>
    ledger.proposals({ statuses: ["pending"], limit: LEDGER_MAX }),
  );
  if (!read.ok) {
    if (isCapabilityError(read.error.cause)) return { ok: false, reason: "unavailable" };
    throw read.error.cause;
  }
  const count = read.value.proposals.length;
  return { ok: true, count, capped: count === LEDGER_MAX };
}
