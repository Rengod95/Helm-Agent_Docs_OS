// Origin·Host 검사(spec §8.5). 순수 함수다. 헤더 값만 받고 요청 객체를 모른다.
// - Host: 허용 목록 밖이면 421(DNS rebinding 방어). 루프백 리스너는 `localhost`, `127.0.0.1`, `[::1]`만 받는다.
// - Origin: 상태를 바꾸는 요청(`POST /pair`, WebSocket 업그레이드)에서 이 게이트웨이의 출처와 같아야 한다. 없으면 거절한다(주소창 GET만 예외).
import { err, ok, type Result } from "@fresnel/contracts";
import { normalizeHost } from "../tls/self-signed.ts";

const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

export type HostError = { readonly kind: "host_not_allowed"; readonly status: 421 };
export type OriginError =
  | { readonly kind: "origin_missing"; readonly status: 403 }
  | { readonly kind: "origin_mismatch"; readonly status: 403 };

export interface HostPart {
  readonly hostname: string;
  readonly port: string | null;
}

/** `Host` 헤더(`name`, `name:port`, `[v6]`, `[v6]:port`)를 나눈다. 모양이 틀리면 `null` */
export function splitHost(header: string): HostPart | null {
  if (header === "" || /[\s/@\\?#]/u.test(header)) return null;
  const match = /^(\[[0-9a-fA-F:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/u.exec(header);
  if (match === null) return null;
  const [, rawName = "", port] = match;
  const hostname = normalizeHost(rawName);
  return hostname === "" ? null : { hostname, port: port ?? null };
}

export interface HostCheck {
  /** `Host` 헤더 값 */
  readonly host: string | null;
  /** 리스너가 루프백 HTTP인가 */
  readonly loopback: boolean;
  /** 외부 리스너가 허용하는 호스트 이름(`l4.remote.web.hosts`와 `listenTls`의 호스트) */
  readonly allowedHosts: readonly string[];
  /** 리스너의 포트. 주면 `Host`에 포트가 있을 때 같아야 한다 */
  readonly port?: number;
}

/** `Host`가 허용 목록에 있나. 아니면 421 */
export function checkHost(check: HostCheck): Result<HostPart, HostError> {
  const denied = err({ kind: "host_not_allowed", status: 421 } satisfies HostError);
  if (check.host === null) return denied;
  const part = splitHost(check.host);
  if (part === null) return denied;
  if (check.port !== undefined && part.port !== null && part.port !== String(check.port))
    return denied;
  const allowed = check.loopback
    ? LOOPBACK_HOSTS
    : check.allowedHosts.map((host) => normalizeHost(host));
  return allowed.includes(part.hostname) ? ok(part) : denied;
}

export interface OriginCheck {
  /** `Origin` 헤더 값 */
  readonly origin: string | null;
  /** 이미 `checkHost`를 통과한 `Host` 헤더 값 */
  readonly host: string;
  /** 리스너의 스킴: HTTPS면 `https`, 루프백 HTTP면 `http` */
  readonly scheme: "https" | "http";
  /** 상태를 바꾸는 요청인가(`POST`, WebSocket 업그레이드). 아니면 `Origin`이 없어도 된다 */
  readonly stateChanging: boolean;
}

/** `Origin`이 이 게이트웨이의 출처(스킴, 호스트, 포트)와 같은가 */
export function checkOrigin(check: OriginCheck): Result<null, OriginError> {
  if (check.origin === null) {
    return check.stateChanging ? err({ kind: "origin_missing", status: 403 }) : ok(null);
  }
  const mismatch = err({ kind: "origin_mismatch", status: 403 } satisfies OriginError);
  const own = splitHost(check.host);
  const match = /^(https?):\/\/([^/?#\s@\\]+)$/u.exec(check.origin);
  if (own === null || match === null) return mismatch;
  const [, scheme = "", authority = ""] = match;
  const theirs = splitHost(authority);
  if (theirs === null || scheme !== check.scheme) return mismatch;
  const defaultPort = scheme === "https" ? "443" : "80";
  const samePort = (theirs.port ?? defaultPort) === (own.port ?? defaultPort);
  return theirs.hostname === own.hostname && samePort ? ok(null) : mismatch;
}
