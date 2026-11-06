import type { BlobError } from "@fresnel/contracts/records";
import { BLOB_PLACEHOLDER_PREFIX } from "@fresnel/contracts/records";
import type { Message } from "@fresnel/contracts/conversation";
import type { Logger, Result } from "@fresnel/contracts";

// L2.dialog.spec §4.5: 이미지 입력 파트의 `data`는 `blob:sha256:<hex>` 자리표시로 기록된다(64 KiB 미만이면 records가 분리하지 않아
// `detached`에도 없다). 모델에 보내기 직전에 자리표시를 실제 base64로 푼다. 기록은 바꾸지 않는다.
// 풀 수 없는 blob(지워짐, 깨짐)은 요청에서만 자리 문장으로 바꿔, 나쁜 이미지 하나가 대화를 막지 않게 한다.

export const UNREADABLE_IMAGE_TEXT = "[이미지를 읽지 못함]";

export type BlobByHashReader = (sha256: string) => Result<Uint8Array, BlobError>;

const SHA256_HEX = /^[0-9a-f]{64}$/;

type Block = { readonly type: string };
type TextBlock = { readonly type: "text"; readonly text: string };

function placeholderHash(data: string): string | undefined {
  if (!data.startsWith(BLOB_PLACEHOLDER_PREFIX)) return undefined;
  const hash = data.slice(BLOB_PLACEHOLDER_PREFIX.length);
  return SHA256_HEX.test(hash) ? hash : undefined;
}

function resolveBlocks<T extends Block>(
  blocks: readonly T[],
  read: BlobByHashReader,
  logger: Logger | undefined,
): (T | TextBlock)[] {
  return blocks.map((block): T | TextBlock => {
    if (block.type !== "image" || !("data" in block) || typeof block.data !== "string") {
      return block;
    }
    if (!block.data.startsWith(BLOB_PLACEHOLDER_PREFIX)) return block;
    const hash = placeholderHash(block.data);
    const bytes = hash === undefined ? undefined : read(hash);
    if (hash === undefined || bytes === undefined || !bytes.ok) {
      logger?.warn("context.image_blob_unreadable", {
        placeholder: block.data.slice(0, 80),
        reason: bytes !== undefined && !bytes.ok ? bytes.error.kind : "bad_placeholder",
      });
      return { type: "text", text: UNREADABLE_IMAGE_TEXT };
    }
    return { ...block, data: Buffer.from(bytes.value).toString("base64") };
  });
}

/** 모델에 보낼 메시지의 이미지 자리표시를 base64로 푼다. 새 메시지를 돌려주고 입력은 바꾸지 않는다 */
export function resolveImageBlobs(
  read: BlobByHashReader,
  messages: readonly Message[],
  logger?: Logger,
): Message[] {
  return messages.map((message): Message => {
    if (message.role === "user" && typeof message.content !== "string") {
      return { ...message, content: resolveBlocks(message.content, read, logger) };
    }
    if (message.role === "toolResult") {
      return { ...message, content: resolveBlocks(message.content, read, logger) };
    }
    return message;
  });
}
