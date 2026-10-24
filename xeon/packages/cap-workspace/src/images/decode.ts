import { WorkspaceFailure } from "../errors.ts";

const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/** 표준 base64를 바이트로 바꾼다. 알파벳, 패딩, 길이 배수(4)를 어기면 `image_decode_failed`다 */
export function decodeBase64(data: string): Uint8Array {
  if (data.length % 4 !== 0 || !BASE64_BODY.test(data)) {
    throw new WorkspaceFailure("image_decode_failed", "The image data is not valid base64.");
  }
  return new Uint8Array(Buffer.from(data, "base64"));
}
