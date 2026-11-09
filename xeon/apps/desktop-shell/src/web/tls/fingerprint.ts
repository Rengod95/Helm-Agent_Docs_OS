// 인증서 지문(SHA-256). 켜는 화면과 페어링 화면이 보이고, 다른 컴퓨터 데스크톱이 처음 접속에서 고정한다(spec §8.2).
// 내부 표현은 소문자 16진 64자이고, `wss://host:port/pin/<지문>` 주소 문법이 같은 글자를 쓴다.
import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

const HEX_64 = /^[0-9a-f]{64}$/u;

export type FingerprintError =
  | { readonly kind: "invalid_fingerprint" }
  | { readonly kind: "invalid_certificate"; readonly cause: unknown };

/** DER 인증서 바이트의 지문 */
export function fingerprintOfDer(der: Uint8Array): string {
  return createHash("sha256").update(der).digest("hex");
}

/** PEM 인증서의 지문 */
export function fingerprintOfPem(pem: string): Result<string, FingerprintError> {
  const parsed = attempt(() => new X509Certificate(pem));
  if (!parsed.ok) return err({ kind: "invalid_certificate", cause: parsed.error.cause });
  return ok(fingerprintOfDer(parsed.value.raw));
}

/** 사람이 보는 모양: 대문자 16진을 콜론으로 나눈다(`AB:CD:…`, 브라우저 인증서 화면과 같다) */
export function formatFingerprint(fingerprint: string): string {
  return fingerprint.toUpperCase().replace(/(..)(?=.)/gu, "$1:");
}

/** 사용자가 붙여 넣은 지문(콜론·공백·대소문자 섞임)을 내부 표현으로 */
export function parseFingerprint(text: string): Result<string, FingerprintError> {
  const compact = text.replace(/[:\s]/gu, "").toLowerCase();
  if (!HEX_64.test(compact)) return err({ kind: "invalid_fingerprint" });
  return ok(compact);
}

/** 두 지문이 같은가(고정 확인). 둘 다 내부 표현이어야 한다 */
export function fingerprintsEqual(a: string, b: string): boolean {
  if (!HEX_64.test(a) || !HEX_64.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
