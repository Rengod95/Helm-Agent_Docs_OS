// 보낸 이미지의 말풍선 썸네일(DP-142). 기록된 이미지 파트는 호스트 blob 자리표시(`blob:sha256:<hex>`)라 바이트가 없고,
// 와이어에는 blob을 읽는 메서드가 없다. 그래서 이 창에서 올린 이미지는 올릴 때의 data URL을 자리표시 키로 기억해 둔다.
// 다시 연 대화나 다른 창에서 올린 이미지는 기억에 없어 이름 칩으로 보인다. 앱 CSP는 `img-src 'self' data: blob:`이다.

/** 기억하는 이미지 수. 오래된 것부터 버린다 */
const THUMB_CAP = 48;

const thumbs = new Map<string, string>();

/** 자리표시 → data URL을 기억한다. 같은 키는 맨 뒤(가장 새 것)로 옮긴다 */
function rememberImageThumb(placeholder: string, dataUrl: string): void {
  thumbs.delete(placeholder);
  thumbs.set(placeholder, dataUrl);
  while (thumbs.size > THUMB_CAP) {
    const oldest = thumbs.keys().next();
    if (oldest.done === true) break;
    thumbs.delete(oldest.value);
  }
}

/** 자리표시의 data URL. 기억에 없으면 null */
export function imageThumbOf(placeholder: string): string | null {
  return thumbs.get(placeholder) ?? null;
}

/**
 * `attachments.add`가 돌려준 파트에서 이미지 자리표시를 찾아 올린 data 소스와 잇는다. 이미지 데이터 소스가 아니면 아무것도 하지 않는다
 */
export function rememberUploadedImage(
  source: { readonly kind: string; readonly data?: string; readonly mime?: string },
  parts: readonly { readonly type: string; readonly data?: string }[],
): void {
  if (source.kind !== "data" || source.data === undefined || source.mime === undefined) return;
  if (!source.mime.startsWith("image/")) return;
  for (const part of parts) {
    if (part.type === "image" && part.data !== undefined && part.data.startsWith("blob:")) {
      rememberImageThumb(part.data, `data:${source.mime};base64,${source.data}`);
    }
  }
}
