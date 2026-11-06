import type { AssistantMessage } from "@fresnel/contracts/conversation";

/** 글·생각 블록만 남긴다. 끝나지 않은 도구 호출은 인자가 잘려 있어 기록하지 않는다 */
function readableBlocks(content: AssistantMessage["content"]): AssistantMessage["content"] {
  return content.filter((block) => block.type === "text" || block.type === "thinking");
}

function charsOf(blocks: AssistantMessage["content"]): number {
  return blocks.reduce(
    (sum, block) =>
      sum +
      (block.type === "text"
        ? block.text.length
        : block.type === "thinking"
          ? block.thinking.length
          : 0),
    0,
  );
}

/**
 * 중단으로 끝난 응답이 스트리밍 중 받은 글보다 적게 돌려주면 받은 글을 남긴다(L1.loop.spec 스트리밍 중 사용자 중단).
 * 중단이 아닌 응답과 이미 충분한 응답은 그대로 둔다
 */
export function keepReceivedText(
  final: AssistantMessage,
  partial: AssistantMessage | null,
): AssistantMessage {
  if (final.stopReason !== "aborted" || partial === null) return final;
  const received = readableBlocks(partial.content);
  const kept = readableBlocks(final.content);
  return charsOf(received) > charsOf(kept) ? { ...final, content: received } : final;
}
