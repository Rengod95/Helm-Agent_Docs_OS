import { assertNever } from "@fresnel/contracts";
import { parseServiceEndpoint, type EndpointParseError } from "../endpoint.ts";

// 대상 주소의 해석(P-08). 문법은 `endpoint.ts`를 그대로 쓰고, 화면이 받을 사유와 루프백 검사만 더한다.
// `index.ts`(대상 목록)와 `preflight.ts`(점검 주소)가 함께 쓰므로 따로 둔다. `preflight.ts`가 `index.ts`를 가져오면 순환이 생긴다.

/** 대상 주소의 해석 결과. 화면이 연결 방식을 고르는 데 쓴다 */
export type TargetAddress =
  | { readonly kind: "unix"; readonly path: string }
  | {
      readonly kind: "ssh";
      readonly user: string | null;
      readonly host: string;
      readonly port: number | null;
      readonly socket: string;
    }
  | { readonly kind: "tcp"; readonly host: string; readonly port: number }
  /** 게이트웨이 `/wire`. pin은 고정한 서버 지문(소문자 64자리 16진수)이고, 없으면 처음 접속 때 확인해 고정한다 */
  | {
      readonly kind: "wss";
      readonly host: string;
      readonly port: number;
      readonly pin: string | null;
    };

export type TargetAddressReason = "empty" | "bad_format" | "relative_path" | "non_loopback";

export type ParseTargetResult =
  | { readonly ok: true; readonly target: TargetAddress }
  | { readonly ok: false; readonly reason: TargetAddressReason };

/** 받는 형식의 머리. 절대 경로만 쓴 주소(`/abs`)는 여기에 없다 */
const SCHEMES: readonly string[] = ["unix:", "ssh://", "tcp://", "wss://"];
/** 루프백으로 보는 TCP 호스트. IPv6는 괄호를 뗀 `::1`이다 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

/** `unix:` 뒤에 내용이 있는데 절대 경로가 아닌 경우 */
function isRelativeUnixPath(trimmed: string): boolean {
  if (!trimmed.startsWith("unix:")) return false;
  const rest = trimmed.slice("unix:".length);
  return rest !== "" && !rest.startsWith("/");
}

/** 엔진 쪽 해석 오류를 화면의 사유로 바꾼다 */
function reasonOf(error: EndpointParseError, trimmed: string): TargetAddressReason {
  switch (error.kind) {
    case "empty":
      return "empty";
    case "unknown_scheme":
      return "bad_format";
    case "invalid":
      return error.part === "path" && isRelativeUnixPath(trimmed) ? "relative_path" : "bad_format";
    default:
      return assertNever(error, "EndpointParseError");
  }
}

/** 대상 주소를 해석한다. 문법은 `parseServiceEndpoint`를 쓰고 루프백 검사만 더한다 */
export function parseTargetAddress(text: string): ParseTargetResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (!SCHEMES.some((scheme) => trimmed.startsWith(scheme))) {
    return { ok: false, reason: "bad_format" };
  }
  const parsed = parseServiceEndpoint(trimmed);
  if (!parsed.ok) return { ok: false, reason: reasonOf(parsed.error, trimmed) };
  const endpoint = parsed.value;
  switch (endpoint.kind) {
    case "unix":
      return { ok: true, target: { kind: "unix", path: endpoint.path } };
    case "ssh": {
      // `[user@]host`에서 나눈다. 사용자와 호스트에는 `@`가 들어가지 않는다(endpoint.ts의 문자 규칙)
      const at = endpoint.target.indexOf("@");
      return {
        ok: true,
        target: {
          kind: "ssh",
          user: at < 0 ? null : endpoint.target.slice(0, at),
          host: at < 0 ? endpoint.target : endpoint.target.slice(at + 1),
          port: endpoint.port ?? null,
          socket: endpoint.remoteSocket,
        },
      };
    }
    case "tcp":
      if (!LOOPBACK_HOSTS.has(endpoint.host.toLowerCase())) {
        return { ok: false, reason: "non_loopback" };
      }
      return { ok: true, target: { kind: "tcp", host: endpoint.host, port: endpoint.port } };
    case "wss":
      return {
        ok: true,
        target: {
          kind: "wss",
          host: endpoint.host,
          port: endpoint.port,
          pin: endpoint.pin ?? null,
        },
      };
    default:
      return assertNever(endpoint, "ServiceEndpoint");
  }
}
