// 사용자 메시지에서 사람이 쓴 글만 뽑는다(L2.dialog §4.5, L4.desktop-ux DP-142). 순수 함수다.
// 첨부는 입력 파트로 들어간다: 텍스트 파일은 `<attachment name="…" path="…">본문</attachment>`, 큰 파일·URL은 `<attachment … />`,
// 이미지는 이미지 파트 + 이름 글 파트다. 루프가 글 파트를 줄바꿈으로 잇고 이미지를 뒤로 모아 기록하므로(L1.loop `textAndImages`)
// 기록된 글에는 이미지 이름이 한 줄로 섞인다. 제목, 목록 미리보기, 자동 제목 입력은 이 함수로 그 표식을 뺀다. 모델 문맥은 바꾸지 않는다.

/** 사용자 메시지 본문. 글이거나 블록 목록이다 */
export type UserTextContent =
  | string
  | readonly { readonly type: string; readonly text?: unknown }[];

const ATTACHMENT_TAG = /<attachment\b[^>]*?(?:\/>|>[\s\S]*?<\/attachment>)/gu;
/** 이미지 이름으로 보는 한 줄: 경로 구분자가 없고 이미지 확장자로 끝난다 */
const IMAGE_NAME_LINE =
  /^[^\\/\n]{1,200}\.(?:png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|svg|ico)$/iu;

/** 글에서 첨부 태그를 지운다 */
export function withoutAttachmentTags(text: string): string {
  return text.replace(ATTACHMENT_TAG, "");
}

/**
 * 글 끝쪽에서 이미지 이름 줄을 `count`개까지 뗀다. 빈 줄은 건너뛰고, 이름으로 보이지 않는 줄을 만나면 멈춘다.
 * `names`는 글에 나온 차례다(첫 이미지의 이름이 앞). 이름 줄은 사용자 글 뒤에 온다(입력창이 글을 먼저 두고 첨부 파트를 잇는다)
 */
export function takeImageNameLines(
  text: string,
  count: number,
): { readonly text: string; readonly names: readonly string[] } {
  const lines = text.split("\n");
  const names: string[] = [];
  let end = lines.length;
  while (end > 0 && names.length < count) {
    const line = (lines[end - 1] ?? "").trim();
    if (line !== "" && !IMAGE_NAME_LINE.test(line)) break;
    if (line !== "") names.unshift(line);
    end -= 1;
  }
  return { text: lines.slice(0, end).join("\n"), names };
}

/**
 * 사람이 쓴 글. 글 블록을 줄바꿈으로 잇고, 첨부 태그를 지우고, 이미지 블록 수만큼 끝쪽의 이미지 이름 줄을 뗀다.
 * 앞뒤 공백은 다듬는다. 글이 없으면 빈 문자열이다
 */
export function userWrittenText(content: UserTextContent): string {
  if (typeof content === "string") return withoutAttachmentTags(content).trim();
  const texts: string[] = [];
  let images = 0;
  for (const block of content) {
    if (block.type === "image") images += 1;
    else if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
  }
  return takeImageNameLines(withoutAttachmentTags(texts.join("\n")), images).text.trim();
}

/** 글자·숫자·그림 문자(이모지)가 하나라도 있는가. 문장부호·기호만 있는 글(`,`)은 제목·미리보기로 쓰지 않는다 */
export function hasWordCharacter(text: string): boolean {
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(text);
}
