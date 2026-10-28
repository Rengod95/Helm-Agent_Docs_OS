import { err, ok } from "@xeon/contracts";
import type { BlobError, BlobRef } from "@xeon/contracts/records";
import type { BlobSink } from "../../src/ports/blobs.ts";

// 이미지 시험용 최소 바이트열과 blob 저장소 대역. 형식 판별은 헤더만 보므로 디코드 가능한 이미지일 필요는 없다.

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

function padded(head: readonly number[], size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return bytes;
}

/** IHDR 다음에 IDAT가 오는 (애니메이션 아닌) PNG 머리. size가 머리보다 크면 0으로 채운다 */
export function pngBytes(width = 4, height = 3, size = 0): Uint8Array {
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(width),
    ...u32be(height),
    8,
    6,
    0,
    0,
    0,
    ...u32be(0),
    ...u32be(0),
    ...ascii("IDAT"),
    ...u32be(0),
  ];
  return padded(head, size);
}

/** acTL 조각이 있는 애니메이션 PNG */
export function animatedPngBytes(): Uint8Array {
  const head = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(4),
    ...u32be(3),
    8,
    6,
    0,
    0,
    0,
    ...u32be(0),
    ...u32be(8),
    ...ascii("acTL"),
    ...u32be(1),
    ...u32be(0),
    ...u32be(0),
  ];
  return padded(head, 64);
}

export function gifBytes(width = 5, height = 6): Uint8Array {
  return padded([...ascii("GIF89a"), ...u16le(width), ...u16le(height)], 16);
}

/** SOF0 조각까지만 있는 JPEG 머리 */
export function jpegBytes(width = 8, height = 7, size = 0): Uint8Array {
  const head = [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
  ];
  return padded(head, size);
}

/** VP8X 확장 머리의 너비·높이는 24비트 "값 - 1"이다 */
function dimension(value: number): number[] {
  return [(value - 1) & 0xff, ((value - 1) >>> 8) & 0xff, ((value - 1) >>> 16) & 0xff];
}

export function webpBytes(width = 10, height = 12): Uint8Array {
  return padded(
    [
      ...ascii("RIFF"),
      ...u32be(0),
      ...ascii("WEBP"),
      ...ascii("VP8X"),
      10,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...dimension(width),
      ...dimension(height),
    ],
    32,
  );
}

/** BMP 머리. 처리기가 없으면 변환할 수 없는 형식이다 */
export function bmpBytes(): Uint8Array {
  const head = [
    ...ascii("BM"),
    ...u32le(256),
    ...u32le(0),
    ...u32le(54),
    ...u32le(40),
    ...u32le(2),
    ...u32le(2),
    ...u16le(1),
    ...u16le(24),
  ];
  return padded(head, 64);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export interface MemoryBlobs extends BlobSink {
  readonly stored: Map<string, Uint8Array>;
  /** putBlob 호출 횟수 */
  puts: number;
  /** 있으면 putBlob이 이 오류로 실패한다 */
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
