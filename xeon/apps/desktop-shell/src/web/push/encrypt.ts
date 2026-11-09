// Web Push 페이로드 암호화(RFC 8291 `aes128gcm`, RFC 8188 레코드 형식, spec §6.2). 발송기(`sender.ts`)만 쓴다.
// 레코드는 하나만 만든다(RFC 8291 §4). 키 합의와 HKDF 단계는 RFC 8291 §3.3-3.4의 순서를 그대로 따르고, HMAC 단계를 풀어 쓴다.
// 발송자의 임시 키는 기본으로 매번 새로 만들고, 시험만 고정된 개인 스칼라를 넣는다.
import { createCipheriv, createECDH, createHmac, randomBytes, type ECDH } from "node:crypto";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

/** 레코드 크기(RFC 8188 `rs`). RFC 8291 §4가 정한 값이다 */
const RECORD_SIZE = 4096;
/** 평문 상한(바이트). 4096에서 헤더 86, 패딩 구분자 1, 인증 태그 16을 뺀 값(RFC 8291 §4) */
export const MAX_PLAINTEXT_BYTES = 3993;

const SALT_BYTES = 16;
const AUTH_SECRET_BYTES = 16;
const POINT_BYTES = 65;
const CEK_BYTES = 16;
const NONCE_BYTES = 12;
const LAST_RECORD_DELIMITER = 0x02;

/** 발송자의 임시 키 쌍. 개인 스칼라(32바이트)만 받는다. 공개 점은 여기서 계산한다 */
export interface EphemeralKey {
  readonly privateScalar: Uint8Array;
}

export type EncryptError =
  | { readonly kind: "payload_too_large"; readonly bytes: number; readonly max: number }
  | { readonly kind: "invalid_subscription_keys"; readonly field: "p256dh" | "auth" }
  | { readonly kind: "invalid_salt" }
  | {
      readonly kind: "crypto_failed";
      readonly step: "ephemeral" | "key_agreement" | "cipher";
      readonly cause: unknown;
    };

export interface DerivedKeys {
  /** HKDF-Extract(auth_secret, ecdh_secret) */
  readonly prkKey: Uint8Array;
  /** "WebPush: info" || 0x00 || ua_public || as_public */
  readonly keyInfo: Uint8Array;
  /** 페이로드 키 재료(IKM) */
  readonly ikm: Uint8Array;
  /** HKDF-Extract(salt, IKM) */
  readonly prk: Uint8Array;
  /** 콘텐츠 암호 키(16바이트) */
  readonly cek: Uint8Array;
  /** 논스(12바이트) */
  readonly nonce: Uint8Array;
}

const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");
const NUL = Buffer.of(0x00);
const ONE = Buffer.of(0x01);

function hmac(key: Uint8Array, ...parts: readonly Uint8Array[]): Buffer {
  const mac = createHmac("sha256", key);
  for (const part of parts) mac.update(part);
  return mac.digest();
}

/** RFC 8291 §3.3-3.4의 HKDF 단계를 그대로 푼다. 입력 길이는 호출자가 맞춘다 */
export function deriveContentKeys(input: {
  readonly ecdhSecret: Uint8Array;
  readonly authSecret: Uint8Array;
  readonly salt: Uint8Array;
  readonly uaPublic: Uint8Array;
  readonly asPublic: Uint8Array;
}): DerivedKeys {
  const prkKey = hmac(input.authSecret, input.ecdhSecret);
  const keyInfo = Buffer.concat([utf8("WebPush: info"), NUL, input.uaPublic, input.asPublic]);
  const ikm = hmac(prkKey, keyInfo, ONE);
  const prk = hmac(input.salt, ikm);
  const cek = hmac(prk, utf8("Content-Encoding: aes128gcm"), NUL, ONE).subarray(0, CEK_BYTES);
  const nonce = hmac(prk, utf8("Content-Encoding: nonce"), NUL, ONE).subarray(0, NONCE_BYTES);
  return { prkKey, keyInfo, ikm, prk, cek, nonce };
}

/** base64url 문자열을 엄격하게 푼다. 알파벳 밖의 글자가 있으면 `null`이다 */
export function decodeBase64url(text: string): Buffer | null {
  return /^[A-Za-z0-9_-]+$/u.test(text) ? Buffer.from(text, "base64url") : null;
}

function ephemeralOf(scalar: Uint8Array | undefined): Result<ECDH, EncryptError> {
  const made = attempt(() => {
    const ecdh = createECDH("prime256v1");
    if (scalar === undefined) ecdh.generateKeys();
    else ecdh.setPrivateKey(scalar);
    return ecdh;
  });
  if (!made.ok) {
    return err({ kind: "crypto_failed", step: "ephemeral", cause: made.error.cause });
  }
  return ok(made.value);
}

/**
 * 페이로드를 `aes128gcm` 본문(헤더 + 암호문 + 태그)으로 암호화한다.
 * `p256dh`는 구독의 비압축 점(65바이트), `auth`는 16바이트 시크릿의 base64url이다.
 * `salt`와 `ephemeral`은 시험만 고정 값을 넣고, 발송 때는 생략해 매번 새 값을 쓴다.
 */
export function encryptPayload(input: {
  readonly plaintext: Uint8Array;
  readonly p256dh: string;
  readonly auth: string;
  readonly salt?: Uint8Array;
  readonly ephemeral?: EphemeralKey;
}): Result<Uint8Array<ArrayBuffer>, EncryptError> {
  if (input.plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    return err({
      kind: "payload_too_large",
      bytes: input.plaintext.byteLength,
      max: MAX_PLAINTEXT_BYTES,
    });
  }
  const uaPublic = decodeBase64url(input.p256dh);
  if (uaPublic === null || uaPublic.byteLength !== POINT_BYTES || uaPublic[0] !== 0x04) {
    return err({ kind: "invalid_subscription_keys", field: "p256dh" });
  }
  const authSecret = decodeBase64url(input.auth);
  if (authSecret === null || authSecret.byteLength !== AUTH_SECRET_BYTES) {
    return err({ kind: "invalid_subscription_keys", field: "auth" });
  }
  const salt = input.salt ?? randomBytes(SALT_BYTES);
  if (salt.byteLength !== SALT_BYTES) return err({ kind: "invalid_salt" });

  const ephemeral = ephemeralOf(input.ephemeral?.privateScalar);
  if (!ephemeral.ok) return err(ephemeral.error);
  const asPublic = ephemeral.value.getPublicKey();
  const shared = attempt(() => ephemeral.value.computeSecret(uaPublic));
  if (!shared.ok) {
    return err({ kind: "crypto_failed", step: "key_agreement", cause: shared.error.cause });
  }

  const keys = deriveContentKeys({
    ecdhSecret: shared.value,
    authSecret,
    salt,
    uaPublic,
    asPublic,
  });

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(RECORD_SIZE);
  const header = Buffer.concat([salt, recordSize, Buffer.of(asPublic.byteLength), asPublic]);

  const sealed = attempt(() => {
    const cipher = createCipheriv("aes-128-gcm", keys.cek, keys.nonce);
    const record = Buffer.concat([input.plaintext, Buffer.of(LAST_RECORD_DELIMITER)]);
    const body = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
    return body;
  });
  if (!sealed.ok) {
    return err({ kind: "crypto_failed", step: "cipher", cause: sealed.error.cause });
  }
  return ok(Buffer.concat([header, sealed.value]));
}
