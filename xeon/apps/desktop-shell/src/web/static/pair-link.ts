// 연결 링크(L4.remote.spec §8.3 [결정: 2026-11-11 사용자]). 주소와 페어링 코드가 함께 든 URL이다: `https://<호스트>/login#code=ABCDE12345`.
// 코드는 쿼리가 아니라 **조각(#)**에 싣는다. 조각은 서버로 보내지 않고 `Referer`에도 실리지 않는다. 그래도 주소창과 브라우저 기록에는 남으므로
// 로그인 화면은 코드를 읽자마자 `history.replaceState`로 조각을 지운다. 코드는 한 번 쓰면 무효이고 5분 뒤 만료되며 틀리면 5회에 잠긴다.
// 이 파일은 로그인 스크립트 묶음에도, 서비스 쪽 링크 만들기에도 쓰인다(브라우저 전역을 쓰지 않는다).

const CODE_PARAM = "code";
/** 정규형 코드는 10자다. 공백·하이픈을 허용해 넉넉히 받는다(서버가 정규화한다) */
const MAX_CODE_LENGTH = 64;

/** `#code=...` 조각에서 코드를 읽는다. 없거나 모양이 틀리면 null이다 */
export function pairingCodeFromHash(hash: string): string | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(text);
  const code = params.get(CODE_PARAM);
  if (code === null) return null;
  const trimmed = code.trim();
  if (trimmed === "" || trimmed.length > MAX_CODE_LENGTH) return null;
  return trimmed;
}

/** 베이스 주소(`https://my-mac.tail1234.ts.net:8443`)와 코드로 연결 링크를 만든다. 베이스가 URL이 아니면 null이다 */
export function pairLinkOf(base: string, code: string): string | null {
  if (!URL.canParse(base)) return null;
  const url = new URL("/login", base);
  url.hash = new URLSearchParams([[CODE_PARAM, code]]).toString();
  return url.toString();
}
