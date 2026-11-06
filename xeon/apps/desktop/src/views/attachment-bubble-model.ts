import type { ImageContent, TextContent } from "@fresnel/contracts/conversation";

// 보낸 메시지 말풍선의 첨부 표시(W2). 입력 파트는 호스트가 `<attachment name="…">본문</attachment>` 글과 이미지 파트로 푼다.
// 말풍선은 그 태그와 본문을 그대로 보이지 않고 글과 첨부(파일 칩, 이미지 썸네일)로 가른다.

export type BubbleAttachment =
  | { readonly kind: "file"; readonly name: string; readonly detail: string | null }
  /** `src`는 바로 그릴 수 있는 data URL. 호스트 blob 자리표시자만 있으면 null이라 칩으로 보인다 */
  | { readonly kind: "image"; readonly name: string; readonly src: string | null };

export type BubbleContent = {
  readonly text: string;
  readonly attachments: readonly BubbleAttachment[];
};

const BLOB_PREFIX = "blob:";
const ATTACHMENT_TAG = /<attachment\b([^>]*?)(?:\/>|>([\s\S]*?)<\/attachment>)/g;

function attributeOf(attributes: string, key: string): string | null {
  const found = new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(attributes);
  if (found === null) return null;
  const value = found[1];
  return value === undefined ? null : value.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? path;
}

function fileOf(attributes: string): BubbleAttachment {
  const name = attributeOf(attributes, "name");
  const path = attributeOf(attributes, "path");
  const url = attributeOf(attributes, "url");
  return {
    kind: "file",
    name: name ?? (path !== null ? lastSegment(path) : (url ?? "")),
    detail: path ?? url,
  };
}

/** 글 하나에서 첨부 태그를 떼어 낸다. 남은 글은 앞뒤 빈 줄을 줄인다 */
function splitTags(text: string): { readonly rest: string; readonly files: BubbleAttachment[] } {
  const files: BubbleAttachment[] = [];
  const rest = text.replace(ATTACHMENT_TAG, (_whole, attributes: string) => {
    files.push(fileOf(attributes));
    return "";
  });
  return { rest: rest.trim(), files };
}

function srcOf(data: string, mimeType: string): string | null {
  if (data === "" || data.startsWith(BLOB_PREFIX)) return null;
  return `data:${mimeType};base64,${data}`;
}

/** 사용자 메시지 내용을 말풍선 글과 첨부로 가른다. 이미지 파트 바로 뒤의 짧은 글 한 줄은 그 이미지의 이름이다 */
export function bubbleOf(content: string | readonly (TextContent | ImageContent)[]): BubbleContent {
  if (typeof content === "string") {
    const { rest, files } = splitTags(content);
    return { text: rest, attachments: files };
  }
  const texts: string[] = [];
  const attachments: BubbleAttachment[] = [];
  let pendingImage: number | null = null;
  for (const block of content) {
    if (block.type === "image") {
      attachments.push({ kind: "image", name: "", src: srcOf(block.data, block.mimeType) });
      pendingImage = attachments.length - 1;
      continue;
    }
    const index = pendingImage;
    pendingImage = null;
    const image = index === null ? undefined : attachments[index];
    if (image !== undefined && image.kind === "image" && !block.text.includes("\n")) {
      attachments[index ?? 0] = { ...image, name: block.text.trim() };
      continue;
    }
    const { rest, files } = splitTags(block.text);
    attachments.push(...files);
    if (rest !== "") texts.push(rest);
  }
  return { text: texts.join("\n"), attachments };
}
