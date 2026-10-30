import { assertNever, err, ok, parse, parseJson, type Logger, type Result } from "@xeon/contracts";
import {
  BlobRefSchema,
  type BlobError,
  type BlobRef,
  type StoreService,
} from "@xeon/contracts/records";
import { Type } from "typebox";
import { failure, type KnowledgeFailure } from "../errors.ts";
import { utf8Encode } from "../hash.ts";
import { KNOWLEDGE_OWNER } from "../migrations.ts";
import { treeOf, type Tree } from "../skills/tree.ts";

// L2.knowledge.spec §4.7.1 전후 내용은 파일별 blob과 그 목록 blob(manifest)으로 둔다. 같은 내용은 한 번만 저장된다.
// 원장 행과 제안 행이 가리키는 블롭은 `cap.knowledge`가 행 id로 고정한다(L0.store §3.4). 고정은 트랜잭션 밖에서 한다.

/** 이 패키지가 쓰는 StoreService 부분형: blob 읽기와 쓰기, 행 id로 고정과 해제 */
export type BlobPort = Pick<StoreService, "putBlob" | "readBlob" | "pinBlob" | "unpinBlob">;

/** 저장한 트리. `manifest`는 목록 blob의 참조이고, `refs`는 목록이 가리키는 파일 blob과 목록 blob 전부다 */
export interface StoredTree {
  readonly manifest: BlobRef;
  readonly refs: readonly BlobRef[];
}

const ManifestSchema = Type.Array(
  Type.Object({ path: Type.String({ maxLength: 512 }), blob: BlobRefSchema }),
);

function blobFailure(error: BlobError, what: string): KnowledgeFailure {
  switch (error.kind) {
    case "disk_full":
      return failure("unavailable", `${what}: disk full`, { cause: error });
    case "blob_missing":
    case "blob_corrupt":
    case "io":
      return failure("internal", `${what}: ${error.kind}`, { cause: error });
    default:
      return assertNever(error, "BlobError");
  }
}

/** 트리의 파일을 blob으로 저장하고 목록 blob과 그 파일 blob들의 참조를 돌려준다. 트랜잭션 밖에서만 부른다(TX-04) */
export function putTree(blobs: BlobPort, tree: Tree): Result<StoredTree, KnowledgeFailure> {
  const entries: { path: string; blob: BlobRef }[] = [];
  const refs: BlobRef[] = [];
  for (const file of tree.files) {
    const stored = blobs.putBlob(file.bytes, null);
    if (!stored.ok) return err(blobFailure(stored.error, "store blob"));
    entries.push({ path: file.path, blob: stored.value });
    refs.push(stored.value);
  }
  const listing = blobs.putBlob(utf8Encode(JSON.stringify(entries)), "application/json");
  if (!listing.ok) return err(blobFailure(listing.error, "store manifest"));
  return ok({ manifest: listing.value, refs: [...refs, listing.value] });
}

/**
 * 블롭 `refs`를 `refKey`(원장 행 id 또는 제안 id)로 고정한다. 행을 쓰기 전에 부른다. 첫 실패에서 멈추고, 그때까지 건 고정은 남으므로
 * 행이 쓰이지 않았으면 `unpinBlobs`로 푼다
 */
export function pinBlobs(
  blobs: BlobPort,
  refKey: string,
  refs: readonly BlobRef[],
): Result<void, KnowledgeFailure> {
  for (const ref of refs) {
    const pinned = blobs.pinBlob(KNOWLEDGE_OWNER, ref.sha256, refKey);
    if (!pinned.ok) return err(blobFailure(pinned.error, "pin blob"));
  }
  return ok(undefined);
}

/**
 * `refKey`가 건 고정을 모두 푼다. 행이 쓰이지 않았거나 행을 지웠을 때 부른다. 풀지 못하면 기록만 남긴다: 남은 고정은 블롭을
 * 지우지 않게 막는 쪽이라 데이터는 잃지 않는다
 */
export function unpinBlobs(blobs: BlobPort, logger: Logger, refKey: string): void {
  const released = blobs.unpinBlob(KNOWLEDGE_OWNER, refKey);
  if (!released.ok) {
    logger.error("knowledge.blob.unpin_failed", { refKey, cause: released.error.kind });
  }
}

/** 목록 blob에서 트리를 되살린다 */
export function readTree(blobs: BlobPort, manifest: BlobRef): Result<Tree, KnowledgeFailure> {
  const listing = blobs.readBlob(manifest);
  if (!listing.ok) return err(blobFailure(listing.error, "read manifest"));
  const json = parseJson(new TextDecoder().decode(listing.value));
  if (!json.ok) return err(failure("internal", "manifest is not JSON", { cause: json.error }));
  const entries = parse(ManifestSchema, json.value);
  if (!entries.ok)
    return err(failure("internal", "manifest is malformed", { cause: entries.error }));
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const entry of entries.value) {
    const content = blobs.readBlob(entry.blob);
    if (!content.ok) return err(blobFailure(content.error, `read blob ${entry.path}`));
    files.push({ path: entry.path, bytes: content.value });
  }
  return ok(treeOf(files));
}
