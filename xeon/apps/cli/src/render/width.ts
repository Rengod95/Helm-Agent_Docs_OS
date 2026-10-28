import { eastAsianWidth } from "get-east-asian-width";

// L4.cli.plan C8 스파이크 결과: 최소 renderer가 터미널 칸 수로 줄을 자른다. 문자 수(UTF-16 길이)로 자르면 한글·한자(2칸)가
// 터미널 폭을 넘어 줄이 접히고, 진행 줄 한 줄 덮어쓰기가 윗줄 잔상을 남긴다.
// 폭 규칙: 자소 클러스터(Intl.Segmenter) 단위로 센다. 이모지 표현과 국기는 2칸, 제어 문자는 0칸, 나머지는 첫 코드 포인트의
// East Asian Width(모호 폭 문자는 좁게)를 쓴다. 한글 자모 조합(NFD)은 한 클러스터이고 첫 자모가 2칸이라 음절 하나가 2칸이다.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WIDE_PRESENTATION = /\p{Emoji_Presentation}|\p{Regional_Indicator}|️/u;
const CONTROL = /^\p{Cc}/u;

function clusterWidth(cluster: string): number {
  if (CONTROL.test(cluster)) return 0;
  if (WIDE_PRESENTATION.test(cluster)) return 2;
  const first = cluster.codePointAt(0);
  return first === undefined ? 0 : eastAsianWidth(first, { ambiguousAsWide: false });
}

/** 터미널에서 차지하는 칸 수 */
export function displayWidth(text: string): number {
  let total = 0;
  for (const { segment } of segmenter.segment(text)) total += clusterWidth(segment);
  return total;
}

/**
 * 폭이 `maxWidth` 칸 이하가 되게 뒤를 자르고 `ellipsis`를 붙인다. 넘지 않으면 그대로 돌려준다.
 * 2칸 문자를 반으로 나누지 않으므로, 결과가 `maxWidth`보다 한 칸 짧을 수 있다
 */
export function truncateToWidth(text: string, maxWidth: number, ellipsis = "…"): string {
  if (displayWidth(text) <= maxWidth) return text;
  const room = maxWidth - displayWidth(ellipsis);
  if (room <= 0) return ellipsis;
  let used = 0;
  let kept = "";
  for (const { segment } of segmenter.segment(text)) {
    const next = used + clusterWidth(segment);
    if (next > room) break;
    used = next;
    kept += segment;
  }
  return `${kept}${ellipsis}`;
}
