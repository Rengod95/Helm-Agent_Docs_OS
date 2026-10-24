// 큰 문자열 분리(L1.persistence.spec §4.11, PS-15, eng.transactions.design §4.3 0단계, F.records.spec §3.4 규칙 4·5).
// 트랜잭션 밖에서만 부른다(TX-04): blob 파일 쓰기가 들어 있다.
import { err, ok, type Result } from "@xeon/contracts";
import {
  BLOB_PLACEHOLDER_PREFIX,
  ENVELOPE_MAX_BYTES,
  type BlobError,
  type BlobRef,
  type DetachedField,
  type DurableEventDraft,
  type StoreService,
} from "@xeon/contracts/records";

/** 이 크기(UTF-8 바이트) 이상인 문자열만 분리 후보다. 작은 값을 blob으로 옮기면 읽기만 느려진다 */
const DETACH_MIN_BYTES: number = 64 * 1024;

/**
 * envelope가 이 크기를 넘으면 분리한다. 커밋이 채우는 seq, recordedAt, parentId의 자릿수가 아직 정해지지 않았으므로
 * 상한보다 조금 낮게 잡는다. 이 여유보다 큰 envelope는 분리 후에도 남지 않도록 목표까지 계속 옮긴다
 */
const DETACH_TARGET_BYTES: number = ENVELOPE_MAX_BYTES - 1024;

const encoder = new TextEncoder();

/** 커밋이 채우기 전 초안의 envelope 크기를 어림한다. 채워질 필드는 가장 긴 모양으로 대신한다 */
function draftEnvelopeBytes(draft: DurableEventDraft): number {
  const padded = {
    ...draft,
    seq: 9_999_999_999_999,
    recordedAt: 9_999_999_999_999,
    parentId: draft.parentId ?? "evt_00000000000000000000000000",
  };
  return encoder.encode(JSON.stringify(padded)).length;
}

export function needsDetach(draft: DurableEventDraft): boolean {
  return draftEnvelopeBytes(draft) > DETACH_TARGET_BYTES;
}

/** RFC 6901 토큰 이스케이프 */
function escapeToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

interface Candidate {
  readonly tokens: readonly string[];
  readonly bytes: Uint8Array;
}

/** payload 안의 분리 후보 문자열을 큰 것부터 모은다. 이미 자리표시인 문자열은 건너뛴다 */
function collectCandidates(
  node: unknown,
  tokens: readonly string[],
  out: Candidate[],
  detached: ReadonlySet<string>,
): void {
  if (typeof node === "string") {
    // UTF-16 코드 유닛 하나는 UTF-8로 최대 3바이트다. 이보다 짧으면 후보가 될 수 없다
    if (node.length * 3 < DETACH_MIN_BYTES) return;
    const pointer = pointerOf(tokens);
    if (detached.has(pointer)) return;
    const bytes = encoder.encode(node);
    if (bytes.length >= DETACH_MIN_BYTES) out.push({ tokens, bytes });
    return;
  }
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    for (const [index, item] of items.entries()) {
      collectCandidates(item, [...tokens, String(index)], out, detached);
    }
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, member] of Object.entries(node)) {
      collectCandidates(member, [...tokens, key], out, detached);
    }
  }
}

export function pointerOf(tokens: readonly string[]): string {
  return tokens.length === 0 ? "" : `/${tokens.map(escapeToken).join("/")}`;
}

/** 위치의 값을 바꾼 새 값. 원본은 바꾸지 않는다 */
function withValueAt(root: unknown, tokens: readonly string[], value: string): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return value;
  if (Array.isArray(root)) {
    const items: readonly unknown[] = root;
    return items.map((item, position) =>
      String(position) === head ? withValueAt(item, rest, value) : item,
    );
  }
  if (typeof root === "object" && root !== null) {
    return Object.fromEntries(
      Object.entries(root).map(([key, member]): [string, unknown] => [
        key,
        key === head ? withValueAt(member, rest, value) : member,
      ]),
    );
  }
  return root;
}

export type PutBlob = StoreService["putBlob"];

function withDetached(
  draft: DurableEventDraft,
  payload: unknown,
  detached: readonly DetachedField[],
): DurableEventDraft {
  return { ...draft, payload, detached: [...detached] };
}

/**
 * envelope가 상한에 가까운 초안의 큰 문자열을 blob으로 옮긴다. 큰 것부터 하나씩 옮기며 목표 크기 이하가 되면 멈춘다.
 * 옮긴 자리는 `blob:sha256:<hex>` 자리표시 문자열이고 `detached`에 위치와 BlobRef를 적는다.
 * 후보를 모두 옮겨도 크면 남은 것을 그대로 돌려준다(커밋이 store.event_too_large로 알린다: 명시 BlobRef를 쓰지 않은 생산자 결함).
 * 분리할 것이 없으면 같은 초안을 돌려준다.
 */
export function detachLarge(
  draft: DurableEventDraft,
  putBlob: PutBlob,
): Result<DurableEventDraft, BlobError> {
  if (!needsDetach(draft)) return ok(draft);
  const already = draft.detached ?? [];
  const candidates: Candidate[] = [];
  collectCandidates(draft.payload, [], candidates, new Set(already.map((field) => field.pointer)));
  candidates.sort((a, b) => b.bytes.length - a.bytes.length);

  let current: DurableEventDraft = draft;
  const fields: DetachedField[] = [...already];
  for (const candidate of candidates) {
    if (!needsDetach(current)) break;
    const stored = putBlob(candidate.bytes, null);
    if (!stored.ok) return err(stored.error);
    const ref: BlobRef = stored.value;
    fields.push({ pointer: pointerOf(candidate.tokens), ref });
    current = withDetached(
      current,
      withValueAt(current.payload, candidate.tokens, `${BLOB_PLACEHOLDER_PREFIX}${ref.sha256}`),
      fields,
    );
  }
  return ok(current);
}
