// Web Push 시험 공용 대역: 브라우저 쪽 복호화(RFC 8291 §3, `hkdfSync`로 따로 푼다)와 가짜 fetch 응답.
// 발송 쪽 구현(`encrypt.ts`)과 같은 HKDF 함수를 쓰지 않아, 암호화가 틀려도 같은 실수로 통과하지 않는다.
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";

export interface UserAgentKeys {
  /** 브라우저 개인 스칼라(32바이트) */
  readonly privateScalar: Buffer;
  /** 브라우저 공개 점(비압축, 65바이트) */
  readonly publicPoint: Buffer;
}

export function userAgentKeys(privateScalar: Buffer): UserAgentKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(privateScalar);
  return { privateScalar, publicPoint: ecdh.getPublicKey() };
}

/** 브라우저가 `PushSubscription.toJSON()`으로 내는 모양과, 시험이 복호화에 쓰는 개인 키·시크릿 */
export interface BrowserSubscription {
  readonly body: {
    readonly endpoint: string;
    readonly keys: { readonly p256dh: string; readonly auth: string };
  };
  readonly ua: UserAgentKeys;
  readonly auth: Buffer;
}

export function browserSubscription(endpoint: string): BrowserSubscription {
  const generated = createECDH("prime256v1");
  generated.generateKeys();
  const ua = userAgentKeys(generated.getPrivateKey());
  const auth = randomBytes(16);
  return {
    body: {
      endpoint,
      keys: { p256dh: ua.publicPoint.toString("base64url"), auth: auth.toString("base64url") },
    },
    ua,
    auth,
  };
}

/** `aes128gcm` 본문을 브라우저처럼 푼다. 패딩 구분자가 0x02가 아니면 `null`이다 */
export function decryptBody(
  body: Uint8Array,
  ua: UserAgentKeys,
  authSecret: Buffer,
): Buffer | null {
  const bytes = Buffer.from(body);
  const salt = bytes.subarray(0, 16);
  const recordSize = bytes.readUInt32BE(16);
  const keyIdLength = bytes[20] ?? 0;
  const asPublic = bytes.subarray(21, 21 + keyIdLength);
  const sealed = bytes.subarray(21 + keyIdLength);
  if (recordSize !== 4096 || keyIdLength !== 65) return null;

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(ua.privateScalar);
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), ua.publicPoint, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12),
  );

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.byteLength - 16));
  const record = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.byteLength - 16)),
    decipher.final(),
  ]);
  if (record[record.byteLength - 1] !== 0x02) return null;
  return record.subarray(0, record.byteLength - 1);
}
