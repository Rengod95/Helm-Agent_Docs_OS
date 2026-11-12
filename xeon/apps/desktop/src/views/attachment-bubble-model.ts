import {
  takeImageNameLines,
  type ImageContent,
  type TextContent,
} from "@fresnel/contracts/conversation";
import { imageThumbOf } from "./image-thumbs.ts";

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

function srcOf(
  data: string,
  mimeType: string,
  thumbOf: (placeholder: string) => string | null,
): string | null {
  if (data === "") return null;
  if (data.startsWith(BLOB_PREFIX)) return thumbOf(data);
  return `data:${mimeType};base64,${data}`;
}

/**
 * 사용자 메시지 내용을 말풍선 글과 첨부로 가른다(DP-142). 두 모양을 받는다.
 * - 턴 입력 모양: 이미지 파트 바로 뒤의 한 줄 글이 그 이미지의 이름이다.
 * - 기록된 모양: 루프가 글 파트를 줄바꿈으로 잇고 이미지를 뒤로 모은다. 글 끝쪽의 이미지 이름 줄을 이미지 수만큼 떼어 차례대로 이름으로 준다.
 * 이미지 바이트가 호스트 자리표시뿐이면 `thumbOf`(이 창에서 올린 이미지의 기억)로 썸네일을 찾고, 없으면 `src`가 null이라 이름 칩이다
 */
export function bubbleOf(
  content: string | readonly (TextContent | ImageContent)[],
  thumbOf: (placeholder: string) => string | null = imageThumbOf,
): BubbleContent {
  if (typeof content === "string") {
    const { rest, files } = splitTags(content);
    return { text: rest, attachments: files };
  }
  const texts: string[] = [];
  const images: { name: string; src: string | null }[] = [];
  let previousImage: { name: string; src: string | null } | null = null;
  for (const block of content) {
    if (block.type === "image") {
      previousImage = { name: "", src: srcOf(block.data, block.mimeType, thumbOf) };
      images.push(previousImage);
      continue;
    }
    if (
      previousImage !== null &&
      !block.text.includes("\n") &&
      !block.text.includes("<attachment")
    ) {
      previousImage.name = block.text.trim();
      previousImage = null;
      continue;
    }
    previousImage = null;
    texts.push(block.text);
  }
  const { rest, files } = splitTags(texts.join("\n"));
  const unnamed = images.filter((image) => image.name === "");
  const taken = takeImageNameLines(rest, unnamed.length);
  taken.names.forEach((name, index) => {
    const image = unnamed[index];
    if (image !== undefined) image.name = name;
  });
  return {
    text: taken.text.trim(),
    attachments: [
      ...images.map((image): BubbleAttachment => ({
        kind: "image",
        name: image.name,
        src: image.src,
      })),
      ...files,
    ],
  };
}
