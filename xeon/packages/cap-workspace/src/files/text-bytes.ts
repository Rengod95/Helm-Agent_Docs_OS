// L2.workspace.spec §4.4 E18: 편집은 원시 바이트가 NUL 없는 유효한 UTF-8일 때만 한다.
// `readTextFile`은 잘못된 바이트를 U+FFFD로 바꾸므로 그 결과로 다시 쓰면 원본 바이트가 사라진다.

import { isUtf8 } from "node:buffer";

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/** 바이트를 UTF-8 텍스트로 풀어 돌려준다. NUL이 있거나 UTF-8이 아니면 null (BOM은 그대로 남긴다) */
export function decodeStrictText(bytes: Uint8Array): string | null {
  if (bytes.includes(0) || !isUtf8(bytes)) return null;
  return decoder.decode(bytes);
}
