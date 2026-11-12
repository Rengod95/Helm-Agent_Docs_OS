// 목록의 첫 입력 미리보기(L1.persistence.spec §4.10.7). 순수 함수다: 입력 글을 읽어 표시용 한 줄을 만든다.
// 저장 행을 바꾸지 않고 `threads.list` 읽기에서만 붙인다. 읽는 곳은 `readFirstUserPreview`(views.ts)다.

/** 미리보기의 상한(코드 포인트). "…"을 포함한다 */
export const PREVIEW_LIMIT = 80;

/** 사용자 입력의 본문. 글이거나 블록 목록이다. 이미지 블록은 텍스트가 없어 건너뛴다 */
export type PreviewContent = string | readonly { readonly type: string; readonly text?: unknown }[];

/**
 * 입력의 글로 미리보기를 만든다. 텍스트 블록만 순서대로 잇고(이미지와 그 밖의 블록은 뺀다), 공백(줄바꿈 포함)을 한 칸으로 줄인 뒤
 * 앞뒤를 다듬는다. 80 코드 포인트 이하면 그대로, 넘으면 앞 79 코드 포인트를 두고 "…"를 붙인다(결과도 80 코드 포인트 이하).
 * 코드 포인트 단위로 자르므로 이모지의 두 코드 유닛을 가르지 않는다. 글이 없으면 undefined다
 */
export function previewOfContent(content: PreviewContent): string | undefined {
  const raw =
    typeof content === "string"
      ? content
      : content
          .flatMap((block) =>
            block.type === "text" && typeof block.text === "string" ? [block.text] : [],
          )
          .join(" ");
  const collapsed = raw.replaceAll(/\s+/gu, " ").trim();
  if (collapsed === "") return undefined;
  const points = Array.from(collapsed);
  if (points.length <= PREVIEW_LIMIT) return collapsed;
  const head = points
    .slice(0, PREVIEW_LIMIT - 1)
    .join("")
    .trimEnd();
  return `${head}…`;
}
