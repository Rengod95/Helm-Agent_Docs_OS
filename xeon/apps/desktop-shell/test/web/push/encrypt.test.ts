import { describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import {
  decodeBase64url,
  deriveContentKeys,
  encryptPayload,
  MAX_PLAINTEXT_BYTES,
} from "../../../src/web/push/encrypt.ts";
import { decryptBody, userAgentKeys } from "./support/webpush.ts";

// RFC 8291 Appendix A(과 §5)의 입력과 중간 값. 줄바꿈은 원문에서 없앴다.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkKey: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  keyInfo:
    "V2ViUHVzaDogaW5mbwAEJXGyvs3942BVGq8e0PTNNmwRzr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0EwbZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAvMBKiiujwa7t45ewP",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cekInfo: "Q29udGVudC1FbmNvZGluZzogYWVzMTI4Z2NtAA",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonceInfo: "Q29udGVudC1FbmNvZGluZzogbm9uY2UA",
  nonce: "4h_95klXJ5E_qnoN",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
} as const;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function b64(text: string): Buffer {
  const bytes = decodeBase64url(text);
  if (bytes === null) throw new Error(`not base64url: ${text.slice(0, 12)}`);
  return bytes;
}

function encryptRfc(plaintext: Uint8Array = new TextEncoder().encode(RFC.plaintext)) {
  return encryptPayload({
    plaintext,
    p256dh: RFC.uaPublic,
    auth: RFC.authSecret,
    salt: b64(RFC.salt),
    ephemeral: { privateScalar: b64(RFC.asPrivate) },
  });
}

describe("RFC 8291 aes128gcm", () => {
  test("the sender's key agreement gives the RFC ECDH secret and public key", () => {
    const sender = createECDH("prime256v1");
    sender.setPrivateKey(b64(RFC.asPrivate));
    expect(sender.getPublicKey().toString("base64url")).toBe(RFC.asPublic);
    expect(sender.computeSecret(b64(RFC.uaPublic)).toString("base64url")).toBe(RFC.ecdhSecret);
  });

  test("the HKDF steps give the RFC intermediate values byte for byte", () => {
    const keys = deriveContentKeys({
      ecdhSecret: b64(RFC.ecdhSecret),
      authSecret: b64(RFC.authSecret),
      salt: b64(RFC.salt),
      uaPublic: b64(RFC.uaPublic),
      asPublic: b64(RFC.asPublic),
    });
    expect(b64url(keys.prkKey)).toBe(RFC.prkKey);
    expect(b64url(keys.keyInfo)).toBe(RFC.keyInfo);
    expect(b64url(keys.ikm)).toBe(RFC.ikm);
    expect(b64url(keys.prk)).toBe(RFC.prk);
    expect(Buffer.from(`Content-Encoding: aes128gcm\0`).toString("base64url")).toBe(RFC.cekInfo);
    expect(b64url(keys.cek)).toBe(RFC.cek);
    expect(Buffer.from(`Content-Encoding: nonce\0`).toString("base64url")).toBe(RFC.nonceInfo);
    expect(b64url(keys.nonce)).toBe(RFC.nonce);
  });

  test("encryptPayload reproduces the RFC 8291 section 5 body byte for byte", () => {
    const encrypted = encryptRfc();
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) throw new Error("encryption failed");
    expect(Buffer.from(encrypted.value).toString("base64url")).toBe(RFC.body);
    // RFC 8291 §5은 Content-Length 145를 적지만 본문 글자열은 144바이트다(헤더 86 + 평문 41 + 구분자 1 + 태그 16)
    expect(encrypted.value.byteLength).toBe(144);
    expect(Buffer.from(encrypted.value.subarray(0, 86)).toString("base64url")).toBe(RFC.header);
    expect(Buffer.from(encrypted.value.subarray(86)).toString("base64url")).toBe(RFC.ciphertext);
  });

  test("the browser side decrypts the body with its private key back to the plaintext", () => {
    const body = encryptRfc();
    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error("encryption failed");
    const ua = userAgentKeys(b64(RFC.uaPrivate));
    expect(ua.publicPoint.toString("base64url")).toBe(RFC.uaPublic);
    const plain = decryptBody(body.value, ua, b64(RFC.authSecret));
    expect(plain?.toString("utf8")).toBe(RFC.plaintext);
  });
});

describe("encryptPayload", () => {
  test("random salt and ephemeral key give a different body each time, with the sender key in the header", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const input = {
      plaintext: new TextEncoder().encode(`{"title":"done","threadId":null}`),
      p256dh: ua.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    };
    const first = encryptPayload(input);
    const second = encryptPayload(input);
    if (!first.ok || !second.ok) throw new Error("encryption failed");
    expect(Buffer.from(first.value).equals(Buffer.from(second.value))).toBe(false);
    expect(Array.from(first.value.subarray(16, 21))).toEqual([0, 0, 16, 0, 65]);
    expect(first.value.byteLength).toBe(86 + input.plaintext.byteLength + 1 + 16);
    const plain = decryptBody(first.value, userAgentKeys(Buffer.from(ua.getPrivateKey())), auth);
    expect(plain?.toString("utf8")).toBe(`{"title":"done","threadId":null}`);
  });

  test("the largest plaintext (3993 bytes) round-trips and one more byte is refused", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const input = {
      p256dh: ua.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
    };
    const largest = new Uint8Array(MAX_PLAINTEXT_BYTES).fill(0x61);
    const fits = encryptPayload({ ...input, plaintext: largest });
    if (!fits.ok) throw new Error("the maximum size was refused");
    expect(fits.value.byteLength).toBe(4096);
    const plain = decryptBody(fits.value, userAgentKeys(Buffer.from(ua.getPrivateKey())), auth);
    expect(plain?.byteLength).toBe(MAX_PLAINTEXT_BYTES);
    expect(plain?.equals(Buffer.from(largest))).toBe(true);

    const tooBig = encryptPayload({ ...input, plaintext: new Uint8Array(MAX_PLAINTEXT_BYTES + 1) });
    expect(tooBig).toEqual({
      ok: false,
      error: {
        kind: "payload_too_large",
        bytes: MAX_PLAINTEXT_BYTES + 1,
        max: MAX_PLAINTEXT_BYTES,
      },
    });
  });

  test("keys of the wrong size or alphabet are refused with the field name", () => {
    const plaintext = new TextEncoder().encode("x");
    const point = RFC.uaPublic;
    const auth = RFC.authSecret;
    expect(encryptPayload({ plaintext, p256dh: point.slice(0, 80), auth })).toEqual({
      ok: false,
      error: { kind: "invalid_subscription_keys", field: "p256dh" },
    });
    expect(encryptPayload({ plaintext, p256dh: `${point}+`, auth })).toEqual({
      ok: false,
      error: { kind: "invalid_subscription_keys", field: "p256dh" },
    });
    expect(encryptPayload({ plaintext, p256dh: point, auth: "AAAA" })).toEqual({
      ok: false,
      error: { kind: "invalid_subscription_keys", field: "auth" },
    });
  });

  test("a salt that is not 16 bytes is refused", () => {
    expect(
      encryptPayload({
        plaintext: new Uint8Array(1),
        p256dh: RFC.uaPublic,
        auth: RFC.authSecret,
        salt: new Uint8Array(8),
      }),
    ).toEqual({ ok: false, error: { kind: "invalid_salt" } });
  });

  test("a zero ephemeral scalar is a crypto failure, not a crash", () => {
    const result = encryptPayload({
      plaintext: new Uint8Array(1),
      p256dh: RFC.uaPublic,
      auth: RFC.authSecret,
      ephemeral: { privateScalar: new Uint8Array(32) },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a zero scalar was accepted");
    expect(result.error.kind).toBe("crypto_failed");
  });
});
