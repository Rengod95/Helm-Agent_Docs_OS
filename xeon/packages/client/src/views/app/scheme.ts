// Plugin App 전용 URI 스킴과 응답 헤더(ADR-0021 §3.6.2, §3.6.3, §3.6.8). 주소 만들기와 풀기, 프레임 문서 CSP 문자열이 한 곳에 있다.
// Rust 셸(`apps/desktop/src-tauri/src/view_scheme.rs`)이 같은 CSP 글자와 같은 경로 규칙을 쓴다. 시험이 두 파일의 글자를 맞춰 본다.

export const APP_SCHEME = "fresnel-view" as const;
/** 앱에 든 caustic 토큰 사본이 나오는 가짜 확장 이름(§3.6.8). 확장 이름 규칙에 걸리지 않는 `_` 접두다 */
export const TOKENS_HOST = "_caustic" as const;
export const TOKENS_PATH = "tokens.css" as const;

/** 프레임 문서에 붙이는 CSP(§3.6.3). 네트워크, 다른 프레임, eval, 폼 전송, base 바꾸기를 막는다 */
export const APP_FRAME_CSP: string = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** 앱 문서 CSP(§3.6.3). 기존 `default-src 'self'; connect-src ipc: http://ipc.localhost`에 `frame-src`만 더한다 */
export const HOST_DOCUMENT_CSP: string =
  "default-src 'self'; connect-src ipc: http://ipc.localhost; frame-src fresnel-view:";

/** 확장 이름과 버전 마디. 주소를 조립할 때 경로 마디가 되므로 문자 집합을 좁힌다 */
const NAME_SEGMENT = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION_SEGMENT = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]{1,32})?$/;

export type AppUrlParts = {
  readonly extension: string;
  readonly version: string;
  readonly path: string;
};

/** 프레임 주소 `fresnel-view://<확장이름>/<버전>/<경로>`. 마디가 규칙에 맞지 않으면 undefined다 */
export function buildAppUrl(extension: string, version: string, path: string): string | undefined {
  if (!NAME_SEGMENT.test(extension) || !VERSION_SEGMENT.test(version)) return undefined;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return undefined;
  if (path.includes("\\") || path.includes("\0")) return undefined;
  return `${APP_SCHEME}://${extension}/${version}/${segments.map(encodeURIComponent).join("/")}`;
}

/** 요청 주소를 푼다. 스킴, 호스트(확장 이름), 버전, 나머지 경로(퍼센트 인코딩 그대로)로 나눈다. 모양이 틀리면 undefined다 */
export function parseAppUrl(text: string): AppUrlParts | undefined {
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  if (url.protocol !== `${APP_SCHEME}:`) return undefined;
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "")
    return undefined;
  const extension = url.hostname;
  if (extension !== TOKENS_HOST && !NAME_SEGMENT.test(extension)) return undefined;
  const parts = url.pathname.split("/");
  // 맨 앞은 빈 칸이다("/1.0.0/index.html")
  const version = parts[1];
  if (version === undefined || (extension !== TOKENS_HOST && !VERSION_SEGMENT.test(version)))
    return undefined;
  const rest = parts.slice(2).join("/");
  return { extension, version, path: rest };
}

/** 프레임 파일 응답 헤더. `contentType`은 resolveAppFile이 고른 값이다 */
export function appResponseHeaders(contentType: string): Readonly<Record<string, string>> {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": APP_FRAME_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()",
  };
}
