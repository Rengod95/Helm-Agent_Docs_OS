// 앱 문서와 로그인 화면의 Content-Security-Policy(spec §8.7). 순수 함수다.
// `host`는 게이트웨이가 Host 검사를 통과시킨 요청 `Host` 값이다(허용 목록 밖의 값은 여기까지 오지 않는다).
// 인라인 스크립트는 없다. shim은 `/shell/shim.js` 파일이므로 `script-src 'self'`만으로 충족된다.

export interface CspOptions {
  /** HTTPS 리스너면 `wss`, 루프백 HTTP면 `ws` */
  readonly tls: boolean;
  /** 요청 `Host` 헤더 값(포트 포함) */
  readonly host: string;
}

function connectSource(options: CspOptions): string {
  return `${options.tls ? "wss" : "ws"}://${options.host}`;
}

/** 앱 문서(`/`, `/index.html`)의 CSP. `frame-src 'self'`는 플러그인 프레임(W7)을 위해 둔다 */
export function appCsp(options: CspOptions): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${connectSource(options)}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** 로그인 화면의 CSP. 앱 문서와 같되 프레임을 쓰지 않는다 */
export function loginCsp(options: CspOptions): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${connectSource(options)}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
