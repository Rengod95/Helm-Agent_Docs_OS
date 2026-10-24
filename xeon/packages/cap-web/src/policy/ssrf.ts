import { assertNever, attempt, err, ok, type Result } from "@xeon/contracts";
import { classifyAddress, parseIpv4, parseIpv6, type AddressClass } from "./address.ts";

// L2.web.spec §4.6. 연결 전 URL 검사(§4.6.1)와 해석된 주소 판정(§4.6.3)을 순수 함수로 둔다.
// 연결 시점의 재검증은 HttpTransport 구현이 맡는다(guarded-fetch 연결, 아래 판정과 같은 범위 표).

type UrlDenialReason =
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "host_name_blocked"
  | "metadata_name"
  | "address_blocked"
  | "metadata_address"
  | "private_network_disabled";

export type UrlRejection =
  /** `new URL()`이 읽지 못함. 입력 오류다 */
  | { readonly kind: "invalid_url"; readonly cause: unknown }
  | { readonly kind: "denied"; readonly reason: UrlDenialReason; readonly host: string };

export interface CheckedUrl {
  readonly url: URL;
  /** 소문자, punycode, 대괄호와 끝 점 제거 */
  readonly host: string;
  /** IP 리터럴이면 그 주소, 이름이면 undefined */
  readonly literal: string | undefined;
  readonly port: string;
}

const METADATA_NAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
]);

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

function isIpLiteral(host: string): boolean {
  return parseIpv4(host) !== undefined || parseIpv6(host) !== undefined;
}

/** 호스트 이름 거부 목록(§4.6.1 4번). 걸리면 사유를, 아니면 undefined */
function blockedHostName(host: string): "host_name_blocked" | "metadata_name" | undefined {
  if (isIpLiteral(host)) return undefined;
  if (METADATA_NAMES.has(host)) return "metadata_name";
  if (host === "localhost" || host.endsWith(".localhost")) return "host_name_blocked";
  if (!host.includes(".")) return "host_name_blocked";
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return "host_name_blocked";
  }
  return undefined;
}

export interface UrlCheckOptions {
  /**
   * provider endpoint 예외(§4.6.5). 이름 거부 목록 가운데 메타데이터 이름만 계속 거부한다.
   * 콘텐츠 URL에는 쓰지 않는다
   */
  readonly localEndpoint?: boolean;
}

/** 연결 전 URL 검사. 스킴, 사용자 정보, 호스트 이름, IP 리터럴을 본다 */
export function checkUrlSyntax(
  raw: string,
  options: UrlCheckOptions = {},
): Result<CheckedUrl, UrlRejection> {
  const parsed = attempt(() => new URL(raw));
  if (!parsed.ok) return err({ kind: "invalid_url", cause: parsed.error.cause });
  const url = parsed.value;
  const host = stripBrackets(url.hostname.toLowerCase()).replace(/\.$/, "");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err({ kind: "denied", reason: "scheme_not_allowed", host });
  }
  if (url.username !== "" || url.password !== "") {
    return err({ kind: "denied", reason: "credentials_in_url", host });
  }
  const blocked = blockedHostName(host);
  if (blocked === "metadata_name") return err({ kind: "denied", reason: blocked, host });
  if (blocked !== undefined && options.localEndpoint !== true) {
    return err({ kind: "denied", reason: blocked, host });
  }
  const literal = isIpLiteral(host) ? host : undefined;
  if (literal !== undefined) {
    const verdict = addressVerdict(literal, {
      allowPrivateNetwork: false,
      localEndpoint: options.localEndpoint === true,
    });
    // 사설망 허용 여부는 해석 단계에서 판정한다. 여기서는 어떤 설정으로도 열리지 않는 주소만 막는다
    if (!verdict.ok && verdict.reason !== "private_network_disabled") {
      return err({ kind: "denied", reason: verdict.reason, host });
    }
  }
  return ok({ url, host, literal, port: url.port });
}

export interface AddressPolicy {
  /** `l2.web.policy.allowPrivateNetwork` */
  readonly allowPrivateNetwork: boolean;
  /** SearXNG 같은 사용자 설정 endpoint 예외(§4.6.5). 메타데이터만 계속 거부한다 */
  readonly localEndpoint: boolean;
}

export type AddressVerdict =
  | { readonly ok: true; readonly class: AddressClass }
  | {
      readonly ok: false;
      readonly reason: Extract<
        UrlDenialReason,
        "address_blocked" | "metadata_address" | "private_network_disabled"
      >;
    };

/** 주소 하나의 판정(§4.6.3 표). IP가 아닌 문자열은 거부한다 */
export function addressVerdict(address: string, policy: AddressPolicy): AddressVerdict {
  const cls = classifyAddress(address);
  if (cls === undefined) return { ok: false, reason: "address_blocked" };
  if (cls === "metadata") return { ok: false, reason: "metadata_address" };
  if (policy.localEndpoint) {
    if (cls === "public" || cls === "private" || cls === "loopback")
      return { ok: true, class: cls };
    return { ok: false, reason: "address_blocked" };
  }
  switch (cls) {
    case "public":
      return { ok: true, class: cls };
    case "private":
      return policy.allowPrivateNetwork
        ? { ok: true, class: cls }
        : { ok: false, reason: "private_network_disabled" };
    case "loopback":
    case "link_local":
    case "reserved":
      return { ok: false, reason: "address_blocked" };
    default:
      return assertNever(cls, "AddressClass");
  }
}

export type ResolvedVerdict =
  | { readonly ok: true; readonly mode: "public" | "direct" }
  | {
      readonly ok: false;
      readonly reason: Extract<
        UrlDenialReason,
        "address_blocked" | "metadata_address" | "private_network_disabled"
      >;
      readonly address: string;
    };

/**
 * 해석된 주소 전부를 판정한다(하나라도 거부면 거부). 모두 공개 주소면 연결 시점 재검증이 있는 `public` 전송을,
 * 사설망 허용이나 endpoint 예외로 열린 주소가 있으면 `direct` 전송을 쓴다.
 */
export function resolvedVerdict(
  addresses: readonly string[],
  policy: AddressPolicy,
): ResolvedVerdict {
  if (addresses.length === 0) return { ok: false, reason: "address_blocked", address: "" };
  let mode: "public" | "direct" = "public";
  for (const address of addresses) {
    const verdict = addressVerdict(address, policy);
    if (!verdict.ok) return { ok: false, reason: verdict.reason, address };
    if (verdict.class !== "public") mode = "direct";
  }
  return { ok: true, mode };
}
