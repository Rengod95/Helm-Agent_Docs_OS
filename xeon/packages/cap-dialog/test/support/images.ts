import { err, ok } from "@xeon/contracts";
import { CapabilityError, type WorkspaceImage } from "@xeon/contracts/capabilities";
import type { BlobError, BlobRef } from "@xeon/contracts/records";
import type { BlobSink } from "../../src/ports/blobs.ts";
import type { ImagesPort } from "../../src/ports/images.ts";

// 첨부 시험용 바이트열, blob 저장소, workspace.images 대역.

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export function pngBytes(width = 4, height = 3, size = 64): Uint8Array {
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32(width),
    ...u32(height),
  ];
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export interface MemoryBlobs extends BlobSink {
  readonly stored: Map<string, Uint8Array>;
  puts: number;
  fail: BlobError | undefined;
}

export function memoryBlobs(): MemoryBlobs {
  const blobs: MemoryBlobs = {
    stored: new Map(),
    puts: 0,
    fail: undefined,
    putBlob: (bytes, mediaType) => {
      blobs.puts += 1;
      if (blobs.fail !== undefined) return err(blobs.fail);
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(bytes);
      const sha256 = hasher.digest("hex");
      blobs.stored.set(sha256, bytes);
      const ref: BlobRef = { type: "blob", sha256, size: bytes.length, mediaType };
      return ok(ref);
    },
  };
  return blobs;
}

export interface FakeImages extends ImagesPort {
  readonly calls: Parameters<ImagesPort["register"]>[0][];
  /** 있으면 다음 register가 이 코드의 CapabilityError로 거부한다 */
  failWith: { code: string; detail?: Record<string, number> } | undefined;
  /** 결과에 싣는 픽셀 크기 */
  size: { width: number; height: number } | undefined;
  /** 참이면 리사이즈한 것으로 알린다 */
  resized: boolean;
}

/** `workspace.images.register`의 최소형을 흉내 낸다: 받은 바이트를 그대로 blob으로 등록한다 */
export function fakeImages(blobs: BlobSink): FakeImages {
  const images: FakeImages = {
    calls: [],
    failWith: undefined,
    size: { width: 4, height: 3 },
    resized: false,
    register: (input) => {
      images.calls.push(input);
      if (images.failWith !== undefined) {
        const { code, detail } = images.failWith;
        images.failWith = undefined;
        return Promise.reject(
          new CapabilityError({
            capability: "workspace.images",
            method: "register",
            code,
            message: `images: ${code}`,
            retryable: false,
            ...(detail === undefined ? {} : { detail }),
          }),
        );
      }
      const stored = blobs.putBlob(
        new Uint8Array(Buffer.from(input.data, "base64")),
        input.mimeType,
      );
      if (!stored.ok) return Promise.reject(new Error("store failed"));
      const image: WorkspaceImage = {
        blob: stored.value,
        mimeType: input.mimeType,
        ...(images.size === undefined ? {} : { size: images.size }),
        ...(images.resized && images.size !== undefined
          ? { resized: { from: { width: 8, height: 6 }, to: images.size } }
          : {}),
      };
      return Promise.resolve(image);
    },
  };
  return images;
}
