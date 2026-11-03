// Plugin App 전용 URI 스킴과 응답 헤더(ADR-0021 §3.6.2, §3.6.3, §3.6.8). 주소 만들기와 풀기, 프레임 문서 CSP 문자열이 한 곳에 있다.
// Rust 셸(`apps/desktop/src-tauri/src/view_scheme.rs`)이 같은 CSP 글자와 같은 경로 규칙을 쓴다. 시험이 두 파일의 글자를 맞춰 본다.

/** 확장 이름과 버전 마디. 주소를 조립할 때 경로 마디가 되므로 문자 집합을 좁힌다 */
const NAME_SEGMENT = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_SEGMENT = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]{1,32})?$/;

/** 넘겨받기 nonce의 모양. 주소 조각에 그대로 들어가므로 URL 안전 글자만 받는다 */
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const APP_SCHEME = "fresnel-view" as const;

/**
 * 프레임 문서에 붙이는 CSP(§3.6.3). 네트워크, 다른 프레임, eval, 폼 전송, base 바꾸기를 막는다.
 * self 소스 대신 이 확장 버전의 주소 접두(`base`, 예 `fresnel-view://helm/1.0.0/`)를 쓴다. sandbox 프레임은 origin이 불투명하고,
 * WebKit은 그 문서에서 self 소스를 같은 출처로 풀지 않아 프레임 자기 스크립트가 막힌다(시험 frame-isolation.e2e로 확인).
 * 접두 소스는 두 엔진에서 모두 되고 다른 확장의 파일까지 열지 않는다.
 */
export function appFrameCsp(base: string): string | undefined {
  // 접두는 CSP 목록 문법을 깨는 글자(공백, `;`, `,`) 없이 `/`로 끝나는 주소여야 한다
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^\s;,\x27]+\/$/.test(base)) return undefined;
  return [
    "default-src 'none'",
    `script-src ${base}`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base}`,
    `media-src ${base} blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    `worker-src ${base} blob:`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/** 한 확장 버전의 주소 접두. 끝에 `/`가 있다. 마디가 규칙에 맞지 않으면 undefined다 */
export function appBase(extension: string, version: string): string | undefined {
  if (!NAME_SEGMENT.test(extension) || !VERSION_SEGMENT.test(version)) return undefined;
  return `${APP_SCHEME}://${extension}/${version}/`;
}

/** 앱 문서 CSP(§3.6.3). 기존 default-src self와 connect-src ipc 두 줄에 frame-src만 더한다 */
export const HOST_DOCUMENT_CSP: string =
  "default-src 'self'; connect-src ipc: http://ipc.localhost; frame-src fresnel-view:";

export type AppUrlParts = {
  readonly extension: string;
  readonly version: string;
  readonly path: string;
};

/** 프레임 주소 `fresnel-view://<확장이름>/<버전>/<경로>[#n=<nonce>]`. 마디가 규칙에 맞지 않으면 undefined다 */
export function buildAppUrl(
  extension: string,
  version: string,
  path: string,
  nonce?: string,
): string | undefined {
  if (!NAME_SEGMENT.test(extension) || !VERSION_SEGMENT.test(version)) return undefined;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return undefined;
  if (path.includes("\\") || path.includes("\0")) return undefined;
  // nonce는 조각이라 요청에 실리지 않는다(스킴 처리기는 보지 못한다). 프레임 스크립트만 `location.hash`로 읽는다
  if (nonce !== undefined && !NONCE_PATTERN.test(nonce)) return undefined;
  const fragment = nonce === undefined ? "" : `#n=${nonce}`;
  return `${APP_SCHEME}://${extension}/${version}/${segments.map(encodeURIComponent).join("/")}${fragment}`;
}

/** 요청 주소를 푼다. 스킴, 호스트(확장 이름), 버전, 나머지 경로(퍼센트 인코딩 그대로)로 나눈다. 모양이 틀리면 undefined다 */
export function parseAppUrl(text: string): AppUrlParts | undefined {
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  if (url.protocol !== `${APP_SCHEME}:`) return undefined;
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "")
    return undefined;
  const extension = url.hostname;
  if (!NAME_SEGMENT.test(extension)) return undefined;
  const parts = url.pathname.split("/");
  // 맨 앞은 빈 칸이다("/1.0.0/index.html")
  const version = parts[1];
  if (version === undefined || !VERSION_SEGMENT.test(version)) return undefined;
  const rest = parts.slice(2).join("/");
  return { extension, version, path: rest };
}

/** 프레임 파일 응답 헤더. `contentType`은 resolveAppFile이 고른 값, `base`는 `appBase`가 만든 접두다 */
export function appResponseHeaders(
  contentType: string,
  base: string,
): Readonly<Record<string, string>> | undefined {
  const csp = appFrameCsp(base);
  if (csp === undefined) return undefined;
  return {
    "Content-Type": contentType,
    // 불투명 origin(`null`)의 프레임이 모듈 스크립트(CORS 모드로 가져온다)를 불러올 수 있게 한다. 확장 자기 파일은 비밀이 아니고, 어떤 문서도 프레임 CSP 밖에서는 이 주소를 가져오지 못한다
    "Access-Control-Allow-Origin": "*",
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()",
  };
}
