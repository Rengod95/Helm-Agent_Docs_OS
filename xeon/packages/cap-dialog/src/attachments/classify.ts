// L2.dialog.spec §4.5 원천별 처리 표의 판정. 순수 함수다.

/** 텍스트 파일을 본문째 입력에 넣는 상한(256 KiB) */
export const TEXT_INLINE_MAX_BYTES: number = 256 * 1024;

const IMAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

/** 파일 이름 끝 부분 */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/** 확장자로 이미지 형식을 추정한다. 이미지 확장자가 아니면 null */
export function imageMimeFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return IMAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** 머리 바이트로 이미지 형식을 판별한다. png, jpeg, gif, webp만 알아본다 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

const utf8Decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const utf8Encoder = new TextEncoder();

/**
 * UTF-8로 온전히 읽히고 NUL 바이트가 없으면 텍스트다. 읽은 본문을 돌려주고 아니면 null이다.
 * 잘못된 바이트는 디코더가 U+FFFD로 바꾸므로, 다시 인코딩한 바이트가 원본과 같은지로 온전함을 가린다.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const text = utf8Decoder.decode(bytes);
  const again = utf8Encoder.encode(text);
  if (again.length !== bytes.length) return null;
  return again.every((byte, index) => byte === bytes[index]) ? text : null;
}

/** 입력 파트에 넣는 속성 값에서 따옴표와 줄바꿈을 걷는다 */
export function attributeValue(value: string): string {
  return value.replace(/["\r\n]+/g, " ").trim();
}
