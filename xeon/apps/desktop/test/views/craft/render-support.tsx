// 크래프트 그리기 시험의 공용 도구.

/**
 * 정적 마크업에서 정보 아이콘이 aria-describedby로 가리키는 글. 설명은 화면에는 숨고(sr-only) 글로는 늘 있다.
 * 가리키는 글이 없으면 null
 */
export function describedTextOf(html: string): string | null {
  const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  if (id === undefined) return null;
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) return null;
  return />([^<]*)</.exec(html.slice(at))?.[1] ?? null;
}
