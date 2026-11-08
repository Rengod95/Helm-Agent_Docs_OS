// 자체 서명 인증서 생성(spec §8.2): ECDSA P-256, 유효 2년, SAN에 설정한 호스트 이름과 주소.
// 갱신은 같은 키로 새 인증서를 만든다(`keyPem`을 주면 그 키를 쓴다). 새 의존 없이 `node:crypto`와 `der.ts`만 쓴다.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes as nodeRandomBytes,
  sign,
  type KeyObject,
  X509Certificate,
} from "node:crypto";
import { isIP } from "node:net";
import { attempt, err, ok, type Clock, type Result } from "@fresnel/contracts";
import {
  derBitString,
  derBoolean,
  derOctetString,
  derOid,
  derPositiveInteger,
  derSequence,
  derSet,
  derSmallInteger,
  derTime,
  derUtf8String,
  tlv,
} from "./der.ts";
import { fingerprintOfDer } from "./fingerprint.ts";

/** 유효 기간(일). spec §8.2 "유효 기간 2년" */
export const SELF_SIGNED_VALID_DAYS = 730;
/** 시계 어긋남을 견디도록 시작 시각을 앞당기는 만큼(ms) */
const NOT_BEFORE_SKEW_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

const ALWAYS_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1"];

const DNS_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u;

export type SelfSignedError =
  | { readonly kind: "invalid_host"; readonly host: string }
  | { readonly kind: "invalid_key"; readonly cause: unknown }
  | { readonly kind: "no_hosts" }
  | { readonly kind: "sign_failed"; readonly cause: unknown };

export interface SelfSignedOptions {
  /** 설정한 호스트 이름과 IP. 루프백 이름(`localhost`, `127.0.0.1`, `::1`)은 자동으로 더해진다 */
  readonly hosts: readonly string[];
  readonly clock: Clock;
  /** 있으면 이 개인 키(PKCS#8 PEM)를 그대로 쓴다(갱신) */
  readonly keyPem?: string;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export interface SelfSignedCertificate {
  readonly certPem: string;
  readonly keyPem: string;
  /** 소문자 16진 SHA-256 */
  readonly fingerprint: string;
  readonly notBefore: number;
  readonly notAfter: number;
  /** SAN에 들어간 이름과 주소(소문자, 중복 없음) */
  readonly hosts: readonly string[];
}

type SanEntry =
  | { readonly kind: "dns"; readonly name: string }
  | { readonly kind: "ip"; readonly bytes: Uint8Array };

/** 대괄호를 벗기고 소문자로 만든 호스트. `[::1]` → `::1` */
export function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

function ipv4Bytes(text: string): Uint8Array {
  return Uint8Array.from(text.split(".").map((part) => Number.parseInt(part, 10)));
}

function hexGroups(part: string): number[] {
  return part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16));
}

/** IPv6 텍스트를 16바이트로. `isIP`가 6을 돌려준 값만 받는다(`::` 줄임과 끝의 IPv4 형식 포함) */
function ipv6Bytes(text: string): Uint8Array {
  const zoneless = text.split("%")[0] ?? text;
  let head = zoneless;
  let tailIpv4: number[] = [];
  const lastColon = zoneless.lastIndexOf(":");
  const lastGroup = zoneless.slice(lastColon + 1);
  if (lastGroup.includes(".")) {
    tailIpv4 = [...ipv4Bytes(lastGroup)];
    head = `${zoneless.slice(0, lastColon + 1)}0:0`;
  }
  const [left = "", right] = head.split("::");
  const leftGroups = hexGroups(left);
  const rightGroups = right === undefined ? [] : hexGroups(right);
  const fill = right === undefined ? 0 : 8 - leftGroups.length - rightGroups.length;
  const all = [...leftGroups, ...Array.from({ length: fill }, () => 0), ...rightGroups];
  const bytes = all.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
  if (tailIpv4.length === 4) {
    bytes.splice(12, 4, ...tailIpv4);
  }
  return Uint8Array.from(bytes);
}

function sanEntryOf(host: string): Result<SanEntry, SelfSignedError> {
  const version = isIP(host);
  if (version === 4) return ok({ kind: "ip", bytes: ipv4Bytes(host) });
  if (version === 6) return ok({ kind: "ip", bytes: ipv6Bytes(host) });
  const labels = host.split(".");
  const valid =
    host.length > 0 && host.length <= 253 && labels.every((label) => DNS_LABEL.test(label));
  if (!valid) return err({ kind: "invalid_host", host });
  return ok({ kind: "dns", name: host });
}

function subjectAltName(entries: readonly SanEntry[]): Uint8Array {
  const names = entries.map((entry) =>
    entry.kind === "dns" ? tlv(0x82, new TextEncoder().encode(entry.name)) : tlv(0x87, entry.bytes),
  );
  return derSequence(derOid("2.5.29.17"), derOctetString(derSequence(...names)));
}

function extension(oid: string, critical: boolean, value: Uint8Array): Uint8Array {
  return critical
    ? derSequence(derOid(oid), derBoolean(true), derOctetString(value))
    : derSequence(derOid(oid), derOctetString(value));
}

function serialNumber(random: (size: number) => Uint8Array): Uint8Array {
  const bytes = Uint8Array.from(random(16));
  // 양수이고 0이 아니게: 최상위 비트를 끄고 마지막 바이트를 1 이상으로
  bytes[0] = (bytes[0] ?? 0) & 0x7f;
  bytes[15] = (bytes[15] ?? 0) | 0x01;
  return derPositiveInteger(bytes);
}

function loadKeyPair(
  keyPem: string | undefined,
): Result<{ readonly privateKey: KeyObject; readonly publicKey: KeyObject }, SelfSignedError> {
  const made = attempt(() => {
    if (keyPem === undefined) {
      return generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    }
    const privateKey = createPrivateKey(keyPem);
    if (
      privateKey.asymmetricKeyType !== "ec" ||
      privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("the key is not an ECDSA P-256 key");
    }
    return { privateKey, publicKey: createPublicKey(privateKey) };
  });
  if (!made.ok) return err({ kind: "invalid_key", cause: made.error.cause });
  return ok(made.value);
}

function toPem(label: string, der: Uint8Array): string {
  const body = Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/gu, "$1\n");
  return `-----BEGIN ${label}-----\n${body.endsWith("\n") ? body : `${body}\n`}-----END ${label}-----\n`;
}

/** 자체 서명 인증서를 만든다. 호스트 이름이 틀리면 만들지 않는다 */
export function createSelfSignedCertificate(
  options: SelfSignedOptions,
): Result<SelfSignedCertificate, SelfSignedError> {
  const random = options.randomBytes ?? ((size: number): Uint8Array => nodeRandomBytes(size));
  if (options.hosts.length === 0) return err({ kind: "no_hosts" });
  const hosts: string[] = [];
  const entries: SanEntry[] = [];
  for (const raw of [...options.hosts, ...ALWAYS_HOSTS]) {
    const host = normalizeHost(raw);
    if (hosts.includes(host)) continue;
    const entry = sanEntryOf(host);
    if (!entry.ok) return entry;
    hosts.push(host);
    entries.push(entry.value);
  }

  const keys = loadKeyPair(options.keyPem);
  if (!keys.ok) return keys;
  const { privateKey, publicKey } = keys.value;

  const now = options.clock.now();
  const notBefore = Math.floor((now - NOT_BEFORE_SKEW_MS) / 1000) * 1000;
  const notAfter = Math.floor((now + SELF_SIGNED_VALID_DAYS * DAY_MS) / 1000) * 1000;

  const spki = publicKey.export({ type: "spki", format: "der" });
  const keyId = Uint8Array.from(random(20));
  const name = derSequence(
    derSet(derSequence(derOid("2.5.4.3"), derUtf8String("Fresnel remote gateway"))),
  );
  const algorithm = derSequence(derOid("1.2.840.10045.4.3.2"));

  const tbs = derSequence(
    tlv(0xa0, derSmallInteger(2)),
    serialNumber(random),
    algorithm,
    name,
    derSequence(derTime(notBefore), derTime(notAfter)),
    name,
    spki,
    tlv(
      0xa3,
      derSequence(
        extension("2.5.29.19", true, derSequence()),
        extension("2.5.29.15", true, derBitString(Uint8Array.of(0x80), 7)),
        extension("2.5.29.37", false, derSequence(derOid("1.3.6.1.5.5.7.3.1"))),
        extension("2.5.29.14", false, derOctetString(keyId)),
        subjectAltName(entries),
      ),
    ),
  );

  const signature = attempt(() => sign("sha256", tbs, privateKey));
  if (!signature.ok) return err({ kind: "sign_failed", cause: signature.error.cause });

  const der = derSequence(tbs, algorithm, derBitString(signature.value, 0));
  const certPem = toPem("CERTIFICATE", der);
  const parsed = attempt(() => new X509Certificate(certPem));
  if (!parsed.ok) return err({ kind: "sign_failed", cause: parsed.error.cause });
  const keyPem: string = privateKey.export({ type: "pkcs8", format: "pem" });
  return ok({
    certPem,
    keyPem,
    fingerprint: fingerprintOfDer(parsed.value.raw),
    notBefore,
    notAfter,
    hosts,
  });
}
