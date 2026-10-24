import { createHash } from "node:crypto";
import { err, ok } from "@xeon/contracts";
import type { BlobError, BlobRef, StoreService } from "@xeon/contracts/records";

// blob 쓰기·읽기 대역(L1.tools.plan §2 testing/fakeStore). 해시는 실제 sha256이다.

export interface FakeStore extends Pick<StoreService, "putBlob" | "readBlob"> {
  /** 저장된 blob 수 */
  size(): number;
  /** putBlob가 이 오류로 실패하게 한다. undefined면 정상 */
  failPut(error: BlobError | undefined): void;
  has(sha256: string): boolean;
}

export function fakeStore(): FakeStore {
  const blobs = new Map<string, Uint8Array>();
  let failing: BlobError | undefined;
  return {
    size: () => blobs.size,
    failPut: (error) => {
      failing = error;
    },
    has: (sha256) => blobs.has(sha256),
    putBlob(bytes, mediaType) {
      if (failing !== undefined) return err(failing);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      blobs.set(sha256, bytes);
      const ref: BlobRef = { type: "blob", sha256, size: bytes.length, mediaType };
      return ok(ref);
    },
    readBlob(ref) {
      const bytes = blobs.get(ref.sha256);
      return bytes === undefined ? err({ kind: "blob_missing", sha256: ref.sha256 }) : ok(bytes);
    },
  };
}
