// 연결 링크(L4.remote.spec §8.8 1 [결정: 2026-11-11 사용자]). 주소와 페어링 코드가 함께 든 URL이다: `https://<호스트>/login#code=ABCDE12345`.
// `apps/desktop-shell/src/web/static/pair-link.ts`의 `pairLinkOf`와 같은 값을 낸다. 앱끼리는 서로 import하지 않으므로 같은 한 줄 로직을 여기 둔다.
// 코드는 쿼리가 아니라 **조각(#)**에 싣는다. 조각은 서버로 가지 않는다.

const CODE_PARAM = "code";

/** 베이스 주소(`https://my-mac.tail1234.ts.net:8443`)와 코드로 연결 링크를 만든다. 베이스가 URL이 아니면 null이다 */
export function pairLinkOf(base: string, code: string): string | null {
  if (!URL.canParse(base)) return null;
  const url = new URL("/login", base);
  url.hash = new URLSearchParams([[CODE_PARAM, code]]).toString();
  return url.toString();
}
