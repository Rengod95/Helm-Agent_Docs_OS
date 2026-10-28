import type { BlobError, BlobRef } from "@xeon/contracts/records";
import type { Result } from "@xeon/contracts";

/**
 * 이미지 바이트를 내용 주소(sha256)로 저장하는 포트. 실제 구현은 `xeon.store`(`StoreService.putBlob`)이고,
 * 이 패키지는 그 부분만 쓴다(L2.workspace.spec §4.6 blob 연결). 같은 내용은 한 번만 저장된다.
 */
export interface BlobSink {
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
}
