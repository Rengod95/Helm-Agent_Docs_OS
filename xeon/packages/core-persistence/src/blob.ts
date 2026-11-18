// 큰 값 분리와 되돌리기(L1.persistence.spec §4.11, PS-15, eng.transactions.design §4.3 0단계, F.records.spec §3.4 규칙 4·5).
// 분리는 트랜잭션 밖에서만 부른다(TX-04): blob 파일 쓰기가 들어 있다. 되돌리기는 읽기 연결 안에서도 부를 수 있다(파일 읽기뿐이다).
import { Bug, err, ok, parseJson, type Logger, type Result } from "@fresnel/contracts";
import {
  BLOB_PLACEHOLDER_PREFIX,
  ENVELOPE_MAX_BYTES,
  type BlobError,
  type BlobRef,
  type DetachedField,
  type DurableEventDraft,
  type StoreService,
} from "@fresnel/contracts/records";

/** 이 크기(UTF-8 바이트, JSON 하위 값은 직렬화 바이트) 이상인 값만 분리 후보다. 작은 값을 blob으로 옮기면 읽기만 느려진다 */
const DETACH_MIN_BYTES: number = 64 * 1024;

/**
 * envelope가 이 크기를 넘으면 분리한다. 커밋이 채우는 seq, recordedAt, parentId의 자릿수가 아직 정해지지 않았으므로
 * 상한보다 조금 낮게 잡는다. 이 여유보다 큰 envelope는 분리 후에도 남지 않도록 목표까지 계속 옮긴다
 */
const DETACH_TARGET_BYTES: number = ENVELOPE_MAX_BYTES - 1024;

/** `detached` 배열의 최대 개수(F.records.spec §3.1 envelope 스키마 maxItems). 넘으면 더 옮기지 않고 커밋의 크기 검사가 알린다 */
const DETACHED_MAX_ITEMS: number = 256;

/** 되돌릴 때 쓰는 자리표시 모양의 임시 해시. 스키마 검사용이고 실제 자리표시는 blob을 쓴 뒤 정한다 */
const PLACEHOLDER_SHAPE: string = `${BLOB_PLACEHOLDER_PREFIX}${"0".repeat(64)}`;

const JSON_MEDIA_TYPE = "application/json";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** envelope의 JSON 바이트를 어림한다. 채워질 필드는 가장 긴 모양으로 대신하고, `detached`는 주어진 배열 그대로 넣는다 */
function envelopeBytes(
  draft: DurableEventDraft,
  detached: readonly DetachedField[] | undefined,
): number {
  const padded = {
    ...draft,
    detached,
    seq: 9_999_999_999_999,
    recordedAt: 9_999_999_999_999,
    parentId: draft.parentId ?? "evt_00000000000000000000000000",
  };
  return byteLength(JSON.stringify(padded));
}

export function needsDetach(draft: DurableEventDraft): boolean {
  return envelopeBytes(draft, draft.detached) > DETACH_TARGET_BYTES;
}

/** RFC 6901 토큰 이스케이프 */
function escapeToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function pointerOf(tokens: readonly string[]): string {
  return tokens.length === 0 ? "" : `/${tokens.map(escapeToken).join("/")}`;
}

/** RFC 6901 포인터 토큰 해석(`pointerOf`의 역) */
function pointerTokens(pointer: string): readonly string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** `pointer`가 `ancestor`와 같거나 그 아래인가. 포인터 구분자는 `/`뿐이다(토큰 안의 `/`는 `~1`이다) */
function isSameOrBelow(pointer: string, ancestor: string): boolean {
  return pointer === ancestor || pointer.startsWith(`${ancestor}/`);
}

interface Candidate {
  readonly pointer: string;
  readonly tokens: readonly string[];
  /** 고르는 순서와 문턱에 쓰는 크기: 문자열은 UTF-8 바이트, 하위 값은 JSON 직렬화 바이트 */
  readonly size: number;
  /** envelope 안에서 이 값이 차지하는 JSON 바이트(따옴표와 이스케이프 포함). 자리표시로 바꿀 때 줄어드는 양이다 */
  readonly jsonBytes: number;
  /** 문자열은 UTF-8 바이트를 한 번만 만든 것을 든다. 하위 값은 옮길 때 직렬화한다(그 전에는 다시 만들지 않는다) */
  readonly source:
    | { readonly kind: "string"; readonly bytes: Uint8Array }
    | { readonly kind: "json"; readonly value: object };
}

/**
 * 값의 JSON 직렬화 바이트 수를 한 번의 순회로 구하고, 문턱을 넘는 후보를 `out`에 모은다.
 * 하위 값마다 따로 직렬화하지 않는다(400 MB 값을 여러 번 다시 쓰지 않는다)
 */
function measure(node: unknown, tokens: readonly string[], out: Candidate[]): number {
  if (typeof node === "string") {
    const jsonBytes = byteLength(JSON.stringify(node));
    // UTF-16 코드 유닛 하나는 UTF-8로 최대 3바이트다. 이보다 짧으면 문턱에 닿을 수 없다
    if (node.length * 3 >= DETACH_MIN_BYTES) {
      const bytes = encoder.encode(node);
      if (bytes.length >= DETACH_MIN_BYTES) {
        out.push({
          pointer: pointerOf(tokens),
          tokens,
          size: bytes.length,
          jsonBytes,
          source: { kind: "string", bytes },
        });
      }
    }
    return jsonBytes;
  }
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    let total = 2;
    for (const [index, item] of items.entries()) {
      if (index > 0) total += 1;
      total += measure(item, [...tokens, String(index)], out);
    }
    return finishContainer(node, total, tokens, out);
  }
  if (typeof node === "object" && node !== null) {
    let total = 2;
    let first = true;
    for (const [key, member] of Object.entries(node)) {
      // JSON.stringify는 undefined 멤버를 건너뛴다
      if (member === undefined) continue;
      if (!first) total += 1;
      first = false;
      total += byteLength(JSON.stringify(key)) + 1 + measure(member, [...tokens, key], out);
    }
    return finishContainer(node, total, tokens, out);
  }
  // 배열 안의 undefined는 JSON에서 null이다
  if (node === undefined) return byteLength("null");
  return byteLength(JSON.stringify(node));
}

/** 루트 객체·배열은 후보가 아니다: 루트를 자리표시로 바꾸면 payload 전체가 문자열이 되어 투영기와 스키마가 읽지 못한다 */
function finishContainer(
  node: object,
  total: number,
  tokens: readonly string[],
  out: Candidate[],
): number {
  if (tokens.length > 0 && total >= DETACH_MIN_BYTES) {
    out.push({
      pointer: pointerOf(tokens),
      tokens,
      size: total,
      jsonBytes: total,
      source: { kind: "json", value: node },
    });
  }
  return total;
}

/** 위치의 값을 바꾼 새 값. 원본은 바꾸지 않는다 */
function withValueAt(root: unknown, tokens: readonly string[], value: unknown): unknown {
  return updateAt(root, tokens, () => value);
}

/**
 * 위치의 값을 `update`의 결과로 바꾼 새 값. 원본은 바꾸지 않는다. 위치가 없으면 원본 그대로다.
 * 되돌리기와 분리가 함께 쓴다
 */
function updateAt(
  root: unknown,
  tokens: readonly string[],
  update: (current: unknown) => unknown,
): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return update(root);
  if (Array.isArray(root)) {
    const items: readonly unknown[] = root;
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) return root;
    return items.map((item, position) =>
      position === index ? updateAt(item, rest, update) : item,
    );
  }
  if (typeof root === "object" && root !== null && head in root) {
    return Object.fromEntries(
      Object.entries(root).map(([key, member]): [string, unknown] => [
        key,
        key === head ? updateAt(member, rest, update) : member,
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
 * envelope가 상한에 가까운 초안의 큰 값을 blob으로 옮긴다(L1.persistence.spec §4.11).
 * 후보는 64 KiB 이상인 문자열과 64 KiB 이상인 객체·배열(루트 제외)이다. 큰 것부터 하나씩 옮기며 목표 크기 이하가 되면 멈춘다.
 * - 옮긴 자리는 `blob:sha256:<hex>` 자리표시 문자열이다. 객체·배열은 JSON 텍스트를 blob에 쓰고 `encoding: "json"`을 적는다.
 * - 이미 옮긴 값의 안(또는 그 자체)은 다시 고르지 않는다. 큰 값 안에 든 후보는 큰 값이 옮겨지면 함께 사라진다.
 * - `fits`가 거짓이면 그 후보는 건너뛴다. 자리표시로 바꾼 payload가 kind 스키마를 지키지 않으면 투영기가 읽다가 깨지기 때문이다.
 * - `detached`는 256개를 넘지 않는다. 더 옮길 자리가 없으면 남은 것을 그대로 돌려주고 커밋의 크기 검사가 알린다.
 * 분리할 것이 없으면 같은 초안을 돌려준다.
 */
export function detachLarge(
  draft: DurableEventDraft,
  putBlob: PutBlob,
  fits: (payload: unknown) => boolean = () => true,
): Result<DurableEventDraft, BlobError> {
  const already = draft.detached ?? [];
  // envelope 크기는 한 번 재고, 옮길 때마다 바뀐 만큼만 더한다(전체를 다시 직렬화하지 않는다)
  let bytes = envelopeBytes(draft, already);
  if (bytes <= DETACH_TARGET_BYTES) return ok(draft);

  const candidates: Candidate[] = [];
  measure(draft.payload, [], candidates);
  // 큰 것부터. 같은 크기는 나온 순서(앞선 위치 먼저)를 지킨다. 객체는 항상 자기 안의 후보보다 커서 부모가 먼저 온다
  candidates.sort((a, b) => b.size - a.size);

  const fields: DetachedField[] = [...already];
  const taken: string[] = already.map((field) => field.pointer);
  let current: DurableEventDraft = draft;
  for (const candidate of candidates) {
    if (bytes <= DETACH_TARGET_BYTES || fields.length >= DETACHED_MAX_ITEMS) break;
    if (taken.some((ancestor) => isSameOrBelow(candidate.pointer, ancestor))) continue;
    const json = candidate.source.kind === "json";
    if (json && !fits(withValueAt(current.payload, candidate.tokens, PLACEHOLDER_SHAPE))) continue;
    const data =
      candidate.source.kind === "string"
        ? candidate.source.bytes
        : encoder.encode(JSON.stringify(candidate.source.value));
    const stored = putBlob(data, json ? JSON_MEDIA_TYPE : null);
    if (!stored.ok) return err(stored.error);
    const ref: BlobRef = stored.value;
    const field: DetachedField = json
      ? { pointer: candidate.pointer, ref, encoding: "json" }
      : { pointer: candidate.pointer, ref };
    const placeholder = `${BLOB_PLACEHOLDER_PREFIX}${ref.sha256}`;
    bytes +=
      byteLength(JSON.stringify(placeholder)) -
      candidate.jsonBytes +
      byteLength(JSON.stringify(field)) +
      (fields.length > 0 ? 1 : 0);
    fields.push(field);
    taken.push(candidate.pointer);
    current = withDetached(
      current,
      withValueAt(current.payload, candidate.tokens, placeholder),
      fields,
    );
  }
  return ok(current);
}

/** 되돌리기에 쓰는 저장소 읽기와 경고 기록 통로 */
export interface BlobSource {
  readonly readBlob: StoreService["readBlob"] | undefined;
  readonly logger: Logger | undefined;
}

/**
 * 분리 항목을 blob 내용으로 되돌린다(F.records.spec §3.4 규칙 5: 읽는 쪽은 `detached`를 되돌린 뒤 소비한다).
 * 항목마다 위치의 값이 그 항목의 자리표시와 같을 때만 바꾼다.
 * blob이 없거나 `encoding: "json"` blob이 JSON으로 읽히지 않으면 자리표시를 남기고 경고한다.
 * 바깥 위치부터 되돌리므로 JSON blob 안에 든 자리표시도 뒤에서 되돌려진다.
 */
export function restoreDetached(
  payload: unknown,
  detached: readonly DetachedField[],
  source: BlobSource,
): unknown {
  const fields = detached
    .map((field) => ({ field, tokens: pointerTokens(field.pointer) }))
    .toSorted((a, b) => a.tokens.length - b.tokens.length);
  if (fields.length === 0) return payload;
  const { readBlob, logger } = source;
  if (readBlob === undefined) {
    throw new Bug("store.blob_unavailable: restoring a detached field needs readBlob");
  }
  let current = payload;
  for (const { field, tokens } of fields) {
    current = updateAt(current, tokens, (value) => restoreValue(value, field, readBlob, logger));
  }
  return current;
}

function restoreValue(
  value: unknown,
  field: DetachedField,
  readBlob: NonNullable<StoreService["readBlob"]>,
  logger: Logger | undefined,
): unknown {
  // 항목이 가리키는 위치에 그 자리표시가 없으면 손대지 않는다(문자열이 우연히 닮았어도 분리 항목이 아니다)
  if (value !== `${BLOB_PLACEHOLDER_PREFIX}${field.ref.sha256}`) return value;
  const blob = readBlob(field.ref);
  if (!blob.ok) {
    logger?.warn("session.hydrate_missing_blob", {
      pointer: field.pointer,
      sha256: field.ref.sha256,
      reason: blob.error.kind,
    });
    return value;
  }
  const text = decoder.decode(blob.value);
  if (field.encoding !== "json") return text;
  const parsed = parseJson(text);
  if (!parsed.ok) {
    // 읽히지 않는 blob은 없는 blob과 같이 다룬다
    logger?.warn("session.hydrate_bad_blob", {
      pointer: field.pointer,
      sha256: field.ref.sha256,
      reason: "json",
    });
    return value;
  }
  return parsed.value;
}
