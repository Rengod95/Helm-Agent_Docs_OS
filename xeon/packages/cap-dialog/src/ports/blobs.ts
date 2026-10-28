import type { Result } from "@xeon/contracts";
import type { BlobError, BlobRef } from "@xeon/contracts/records";

/**
 * 첨부 바이트를 내용 주소(sha256)로 저장하는 포트. 실제 구현은 `xeon.store`(`StoreService.putBlob`)다.
 * 같은 내용은 한 번만 저장된다(L2.dialog.spec §4.5).
 */
export interface BlobSink {
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
}
