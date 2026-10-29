import type { ImageLimits, WorkspaceImage } from "@xeon/contracts/capabilities";
import { WorkspaceFailure } from "../errors.ts";
import type { BlobSink } from "../ports/blobs.ts";
import { detectSupportedImageMimeType, imageDimensions } from "./upstream/image.ts";
import { base64Length, INLINE_IMAGE_TYPES } from "./upstream/image-processor.ts";

// L2.workspace.spec §4.6 처리기 없는 최소형(plan W7). 형식 판별, base64 길이 한도 검사, blob 등록만 한다.
// 디코드·방향 보정·리사이즈·재인코딩은 처리기가 들어오는 2차(photon)에서 이 함수 앞에 끼운다.

/**
 * 바이트를 모델이 받을 수 있는 이미지로 준비하고 등록한다. 처리기가 없으므로 `INLINE_IMAGE_TYPES`이고
 * base64 길이가 `limits.maxBytes` 이하일 때만 그대로 등록한다. 픽셀 한도는 처리기 없이는 맞출 수 없어 검사하지 않는다
 * (durable `read`가 처리기 없이 동작하는 방식과 같다). 선언한 크기는 헤더에서 읽을 수 있을 때만 결과에 싣는다.
 */
export function prepareImage(
  bytes: Uint8Array,
  limits: ImageLimits,
  blobs: BlobSink,
  name: string | undefined,
): WorkspaceImage {
  const mimeType = detectSupportedImageMimeType(bytes);
  if (mimeType === undefined) {
    throw new WorkspaceFailure(
      "image_decode_failed",
      `${label(name)} is not a supported image (png, jpeg, gif, webp, bmp).`,
    );
  }
  if (!INLINE_IMAGE_TYPES.has(mimeType)) {
    throw new WorkspaceFailure(
      "image_unsupported",
      `${label(name)} is ${mimeType}, which needs conversion and no image processor is available.`,
      { detail: { mimeType } },
    );
  }
  const encodedBytes = base64Length(bytes.length);
  if (encodedBytes > limits.maxBytes) {
    throw new WorkspaceFailure(
      "image_too_large",
      `${label(name)} is ${encodedBytes} bytes as base64, over the ${limits.maxBytes} byte limit, and no image processor is available to shrink it.`,
      { detail: { encodedBytes, maxBytes: limits.maxBytes } },
    );
  }
  // 블롭은 고정하지 않는다(L0.store §10 미결 S-15). 이 패키지는 참조를 자기 표나 상태에 적지 않고, 고정을 풀 시점(이미지 폐기, 턴 소비)도 알 수 없다.
  // 참조는 호출자에게만 가고, 커밋되는 도구 결과와 첨부 파트에는 blob:sha256:<hex> 자리표시로만 남는다(L2.workspace §4.6). 자리표시는 p_blob_refs가 보지 않는다.
  const stored = blobs.putBlob(bytes, mimeType);
  if (!stored.ok) {
    throw new WorkspaceFailure(
      "unavailable",
      `The image could not be stored: ${stored.error.kind}.`,
      {
        retryable: stored.error.kind === "io" || stored.error.kind === "disk_full",
        detail: { by: "store", reason: stored.error.kind },
      },
    );
  }
  const size = imageDimensions(bytes, mimeType);
  return {
    blob: stored.value,
    mimeType,
    ...(size === undefined ? {} : { size }),
  };
}

function label(name: string | undefined): string {
  return name === undefined || name === "" ? "The image" : name;
}
