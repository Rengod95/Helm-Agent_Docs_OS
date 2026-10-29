import { assertNever } from "@xeon/contracts";
import {
  ArtifactsRegistry,
  type ArtifactMeta,
  type CapabilityApi,
} from "@xeon/contracts/capabilities";
import { toJsonValue, type JsonValue } from "@xeon/contracts/conversation";
import type { BlobError, BlobRef, StoreService } from "@xeon/contracts/records";
import { reject } from "../errors.ts";

// L2.artifacts.spec §4.1.1, §4.1.2, §4.1.4. 본문을 blob으로 만들고, 미리보기 메타를 채우고, 메타 크기를 검사한다.

/** 메타 JSON의 상한(§4.1.4) */
const META_MAX_BYTES = 16 * 1024;

type RegisterInput = Parameters<CapabilityApi<typeof ArtifactsRegistry>["register"]>[0];
export type ContentInput = RegisterInput["content"];
type Preview = NonNullable<ArtifactMeta["preview"]>;

/** 저장할 본문. `text`는 텍스트 mediaType일 때만 있다(미리보기와 `get`의 본문 계산에 쓴다) */
export interface Stored {
  readonly content: BlobRef;
  readonly text: string | undefined;
}

/** 본문 mediaType이 텍스트인지. `text/*`와 `application/json`을 텍스트로 본다 */
export function isTextual(mediaType: string | null): boolean {
  return mediaType !== null && (mediaType.startsWith("text/") || mediaType === "application/json");
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** blob 저장소 실패. 데이터가 깨진 경우는 내부 오류, 디스크 가득은 다시 시도할 수 있다 */
export function blobFailure(method: string, error: BlobError): Error {
  if (error.kind === "blob_missing" || error.kind === "blob_corrupt") {
    return reject(
      ArtifactsRegistry.id,
      method,
      "internal",
      `The stored blob is damaged: ${error.kind}.`,
    );
  }
  return reject(
    ArtifactsRegistry.id,
    method,
    "unavailable",
    `The blob store failed: ${error.kind}.`,
    {
      retryable: error.kind === "disk_full",
    },
  );
}

/**
 * 입력 본문을 blob으로 만든다. `inline`은 UTF-8로 써서 새 ref를, `blob`은 있는지와 크기를 확인해 그 ref를 쓴다.
 * `file`은 아직 받지 않는다(spec §10 미결).
 */
export function materialize(
  method: string,
  blobs: Pick<StoreService, "putBlob" | "readBlob">,
  content: ContentInput,
  maxBytes: number,
): Stored {
  switch (content.type) {
    case "inline": {
      const bytes = new TextEncoder().encode(content.text);
      if (bytes.byteLength > maxBytes) throw tooLarge(method, maxBytes);
      const put = blobs.putBlob(bytes, content.mediaType);
      if (!put.ok) throw blobFailure(method, put.error);
      return {
        content: put.value,
        text: isTextual(put.value.mediaType) ? content.text : undefined,
      };
    }
    case "blob": {
      const read = blobs.readBlob(content.ref);
      if (!read.ok)
        throw reject(ArtifactsRegistry.id, method, "file_unreadable", "The blob cannot be read.");
      if (read.value.byteLength > maxBytes) throw tooLarge(method, maxBytes);
      return {
        content: content.ref,
        text: isTextual(content.ref.mediaType) ? decodeText(read.value) : undefined,
      };
    }
    case "file":
      throw reject(
        ArtifactsRegistry.id,
        method,
        "file_unreadable",
        "file content is not supported yet",
      );
    default:
      return assertNever(content, "ArtifactContent");
  }
}

function tooLarge(method: string, maxBytes: number): Error {
  return reject(
    ArtifactsRegistry.id,
    method,
    "content_too_large",
    `The content is larger than ${String(maxBytes)} bytes.`,
  );
}

/** 줄 수. 끝의 줄바꿈은 줄을 더하지 않는다. 빈 본문은 0줄이다 */
function lineCount(text: string): number {
  if (text === "") return 0;
  const parts = text.split("\n").length;
  return text.endsWith("\n") ? parts - 1 : parts;
}

/** 첫 줄의 쉼표 칸 수. 따옴표 안의 쉼표는 세지 않는다(미리보기용 근사) */
function columnCount(text: string): number {
  const first = text.split("\n", 1)[0] ?? "";
  return first === "" ? 0 : first.split(",").length;
}

/** 텍스트 본문이 있으면 줄 수(CSV는 행과 열도)를 계산한다. 본문이 텍스트가 아니면 없다 */
function previewOf(stored: Stored): Preview | undefined {
  if (stored.text === undefined) return undefined;
  const lines = lineCount(stored.text);
  if (stored.content.mediaType !== "text/csv") return { lines };
  return { lines, rows: lines, columns: columnCount(stored.text) };
}

/** 본문 줄과 관련된 미리보기 값을 뺀 사본. 본문이 바뀌면 새로 계산한다 */
function withoutLinePreview(preview: Preview | undefined): Preview {
  const kept: Preview = { ...preview };
  delete kept.lines;
  delete kept.rows;
  delete kept.columns;
  return kept;
}

/** 등록의 메타. 생산자가 준 미리보기가 계산값보다 앞선다 */
export function metaForRegister(
  input: { readonly meta?: ArtifactMeta },
  stored: Stored,
): ArtifactMeta {
  const base: ArtifactMeta = input.meta ?? {};
  const computed = previewOf(stored);
  if (computed === undefined) return base;
  return { ...base, preview: { ...computed, ...base.preview } };
}

/**
 * 갱신의 메타. 둘 다 없으면 undefined(메타는 바뀌지 않는다).
 * 도구 경로는 기존 메타에 `summary`만 더한다(spec §3.2). 서비스 경로의 `meta`는 전체 교체다.
 * 본문이 바뀌면 줄 수 미리보기는 새 본문으로 다시 계산하되, 서비스 경로가 준 미리보기 값은 그대로 둔다.
 */
export function metaForUpdate(
  current: ArtifactMeta,
  explicit: ArtifactMeta | undefined,
  toolPath: boolean,
  stored: Stored | undefined,
): ArtifactMeta | undefined {
  if (explicit === undefined && stored === undefined) return undefined;
  const source = sourceMeta(current, explicit, toolPath);
  if (stored === undefined) return source;
  const servicePreview = explicit !== undefined && !toolPath ? explicit.preview : undefined;
  return {
    ...source,
    preview: { ...previewOf(stored), ...withoutLinePreview(source.preview), ...servicePreview },
  };
}

/** 갱신 뒤의 메타 본문. 도구 경로는 요약만 바꾸고, 서비스 경로는 준 메타로 바꾼다 */
function sourceMeta(
  current: ArtifactMeta,
  explicit: ArtifactMeta | undefined,
  toolPath: boolean,
): ArtifactMeta {
  if (explicit === undefined) return current;
  if (!toolPath) return explicit;
  return explicit.summary === undefined ? current : { ...current, summary: explicit.summary };
}

/** 메타를 JSON 값으로 바꾼다. JSON이 아니거나 16 KiB를 넘으면 `invalid_input`이다 */
export function metaJsonOf(method: string, meta: ArtifactMeta): JsonValue {
  const json = toJsonValue(meta);
  if (json === undefined)
    throw reject(ArtifactsRegistry.id, method, "invalid_input", "The meta is not JSON.");
  if (new TextEncoder().encode(JSON.stringify(json)).byteLength > META_MAX_BYTES) {
    throw reject(ArtifactsRegistry.id, method, "invalid_input", "The meta is larger than 16 KiB.");
  }
  return json;
}
