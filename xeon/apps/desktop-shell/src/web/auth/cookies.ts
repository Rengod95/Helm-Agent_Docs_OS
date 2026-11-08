// 로그인 쿠키와 `Authorization` 토큰(spec §8.3 4, 6). 쿠키 값은 기기 토큰이다.
// HTTPS 리스너: `__Host-fresnel-device`(HttpOnly, Secure, SameSite=Strict, Path=/). 루프백 HTTP는 Secure를 못 쓰므로 `fresnel-device`로 낮춘다.
// 안전한 리스너는 `__Host-` 이름만 받는다: 쿠키는 포트와 스킴을 가리지 않아, 다른 HTTP 출처가 같은 이름을 심을 수 있기 때문이다.
import { TOKEN_LENGTH } from "./devices.ts";

export const SECURE_COOKIE_NAME = "__Host-fresnel-device";
export const PLAIN_COOKIE_NAME = "fresnel-device";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;

function cookieName(secure: boolean): string {
  return secure ? SECURE_COOKIE_NAME : PLAIN_COOKIE_NAME;
}

/** 토큰 글자 모양(43자 base64url). 해시하기 전에 거르는 데 쓴다 */
export function isTokenShape(value: string): boolean {
  return value.length === TOKEN_LENGTH && TOKEN_PATTERN.test(value);
}

/**
 * `Set-Cookie` 값. `maxAgeSeconds`는 로그인이 끝날 때까지 남은 시간이다(`DeviceInfo.sessionExpiresAt`에서 계산).
 * 데스크톱 기기는 쿠키를 쓰지 않는다.
 */
export function serializeDeviceCookie(
  token: string,
  options: { readonly secure: boolean; readonly maxAgeSeconds: number },
): string {
  const parts = [
    `${cookieName(options.secure)}=${token}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** 쿠키를 지우는 `Set-Cookie` 값(로그아웃, 폐기, 만료) */
export function clearDeviceCookie(secure: boolean): string {
  const parts = [`${cookieName(secure)}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** `Cookie` 헤더를 이름 → 값 목록으로. 같은 이름이 둘이면 둘 다 돌려준다(어느 쪽이 맞는지 서버가 가릴 수 없으므로 호출자가 거절한다) */
export function parseCookies(header: string | null): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  if (header === null) return out;
  for (const piece of header.split(";")) {
    const index = piece.indexOf("=");
    if (index < 0) continue;
    const name = piece.slice(0, index).trim();
    if (name === "") continue;
    const value = piece.slice(index + 1).trim();
    out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

/**
 * 요청에서 기기 토큰을 꺼낸다. `Authorization: Bearer <토큰>`이 먼저고(데스크톱 클라이언트), 없으면 쿠키다.
 * 모양이 틀리거나 같은 쿠키가 둘 이상이면 `null`이다.
 */
export function deviceTokenOf(
  headers: { readonly cookie: string | null; readonly authorization: string | null },
  secure: boolean,
): string | null {
  const auth = headers.authorization;
  if (auth !== null) {
    const match = /^Bearer ([^\s]+)$/u.exec(auth);
    const bearer = match?.[1];
    return bearer !== undefined && isTokenShape(bearer) ? bearer : null;
  }
  const values = parseCookies(headers.cookie).get(cookieName(secure));
  if (values === undefined || values.length !== 1) return null;
  const [value = ""] = values;
  return isTokenShape(value) ? value : null;
}
