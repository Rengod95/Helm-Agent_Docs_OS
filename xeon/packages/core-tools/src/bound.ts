import { parse } from "@xeon/contracts";
import type {
  ImageContent,
  JsonObject,
  JsonValue,
  TextContent,
} from "@xeon/contracts/conversation";
import {
  BlobRefSchema,
  type BlobError,
  type BlobRef,
  type StoreService,
} from "@xeon/contracts/records";
import type { BoundedResult, OutputLimits } from "@xeon/contracts/services";
import type { OutputTruncator, RawToolResult } from "./types.ts";
import { isJsonObject, isJsonValue, utf8Bytes } from "./util.ts";

// L1.tools.spec §3.7, §4.8 결과 경계화. 한도를 넘는 텍스트는 원문을 blob으로 옮기고 모델에는 미리보기와 안내 문장을 준다.
// 절단 함수는 L0 platform-exec의 durable truncate 포크이고 이 파일은 `OutputTruncator`로 받아 쓴다.

/** blob 원문 상한(L1.tools.spec §4.8 4번). 넘으면 앞뒤 25 MiB만 저장한다 */
const BLOB_ORIGINAL_MAX_BYTES: number = 50 * 1024 * 1024;
const BLOB_HALF_BYTES = 25 * 1024 * 1024;

export interface BoundDeps {
  readonly truncator: OutputTruncator;
  readonly store: Pick<StoreService, "putBlob">;
}

export interface BoundOutput {
  readonly bounded: BoundedResult;
  /** 모델에 보낼 details(절단 정보를 더했다) */
  readonly details: JsonValue | null;
  /** blob 저장이 실패했으면 그 종류 */
  readonly blobError: BlobError["kind"] | null;
}

const TEXT_SEPARATOR = "\n";

/** 상한을 넘는 원문은 앞뒤만 남긴다. 가운데에 생략 표시를 둔다 */
function limitOriginal(bytes: Uint8Array): Uint8Array {
  if (bytes.length <= BLOB_ORIGINAL_MAX_BYTES) return bytes;
  const omitted = bytes.length - 2 * BLOB_HALF_BYTES;
  const marker = utf8Bytes(`\n[xeon:omitted ${omitted} bytes]\n`);
  const joined = new Uint8Array(2 * BLOB_HALF_BYTES + marker.length);
  joined.set(bytes.subarray(0, BLOB_HALF_BYTES), 0);
  joined.set(marker, BLOB_HALF_BYTES);
  joined.set(bytes.subarray(bytes.length - BLOB_HALF_BYTES), BLOB_HALF_BYTES + marker.length);
  return joined;
}

function withTruncation(details: JsonValue | null, truncation: JsonObject): JsonValue | null {
  if (details === null) return { truncation };
  if (isJsonObject(details)) return { ...details, truncation };
  return { value: details, truncation };
}

function detailsOf(result: RawToolResult): JsonValue | null {
  const raw: unknown = result.details;
  // details는 JSON이어야 한다(ToolResultMessage.details). JSON이 아니면 버린다
  return isJsonValue(raw) ? raw : null;
}

/** "self" 도구가 details.blobRef로 넘긴 blob 참조 */
export function selfBlobRef(result: RawToolResult): BlobRef | null {
  const details: unknown = result.details;
  if (!isJsonObject(details)) return null;
  const parsed = parse(BlobRefSchema, details["blobRef"]);
  return parsed.ok ? parsed.value : null;
}

/**
 * 결과 경계화. 텍스트 파트를 "\n"으로 이어 한도 안이면 그대로 둔다. 한도를 넘으면 원문 전체를 blob에 넣고
 * 미리보기(truncateHead)와 안내 문장을 모델용 내용으로 쓴다. 이미지 파트는 자르지 않는다.
 */
export function boundResult(
  deps: BoundDeps,
  result: RawToolResult,
  limits: Required<OutputLimits>,
): BoundOutput {
  const details = detailsOf(result);
  const texts = result.content.filter((part): part is TextContent => part.type === "text");
  const others = result.content.filter((part): part is ImageContent => part.type !== "text");
  const unbounded: BoundOutput = {
    bounded: {
      content: result.content,
      blobRef: null,
      truncated: false,
      totalLines: 0,
      totalBytes: 0,
    },
    details,
    blobError: null,
  };
  if (texts.length === 0) return unbounded;

  const full = texts.map((part) => part.text).join(TEXT_SEPARATOR);
  const cut = deps.truncator.truncateHead(full, limits);
  if (!cut.truncated) {
    return {
      ...unbounded,
      bounded: {
        ...unbounded.bounded,
        totalLines: cut.totalLines,
        totalBytes: cut.totalBytes,
      },
    };
  }

  const stored = deps.store.putBlob(limitOriginal(utf8Bytes(full)), "text/plain; charset=utf-8");
  const blobRef = stored.ok ? stored.value : null;
  const blobError = stored.ok ? null : stored.error.kind;
  const sizes = `${cut.outputLines} of ${cut.totalLines} lines (${deps.truncator.formatSize(cut.outputBytes)} of ${deps.truncator.formatSize(cut.totalBytes)})`;
  const notice =
    blobRef === null
      ? `[xeon:output_truncated] Showing the first ${sizes}. The full output was not stored.`
      : `[xeon:output_truncated] Showing the first ${sizes}. The full output is stored as blob sha256:${blobRef.sha256}.`;
  const truncation: JsonObject = {
    totalLines: cut.totalLines,
    totalBytes: cut.totalBytes,
    outputLines: cut.outputLines,
    outputBytes: cut.outputBytes,
    truncatedBy: cut.truncatedBy,
    ...(blobError === null ? {} : { blobError }),
  };
  return {
    bounded: {
      content: [{ type: "text", text: cut.content }, { type: "text", text: notice }, ...others],
      blobRef,
      truncated: true,
      totalLines: cut.totalLines,
      totalBytes: cut.totalBytes,
    },
    details: withTruncation(details, truncation),
    blobError,
  };
}
