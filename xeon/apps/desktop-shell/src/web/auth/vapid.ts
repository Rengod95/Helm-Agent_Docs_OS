// Web Push용 VAPID 키(RFC 8292, spec §6.2). ECDSA P-256 한 쌍을 만들어 `<remote 폴더>/vapid.json`(0600)에 둔다.
// 공개 키는 브라우저의 `applicationServerKey`(비압축 점 65바이트의 base64url)이고, 개인 키는 JWT 서명에만 쓴다.
// 발송(페이로드 암호화, HTTP 호출)은 W2·W3 몫이다. 이 파일은 키와 `Authorization` 헤더 값까지 만든다.
// 키를 바꾸면 기존 구독이 모두 무효가 된다. 교체 기능은 두지 않는다(파일을 지우면 새로 만들어진다).
import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { attempt, err, ok, parseJson, type Clock, type Result } from "@fresnel/contracts";
import { isInteger, isRecord, ownField } from "../../main/lib/narrow.ts";
import { readTextFile, writeSecretFile, type FileError } from "./atomic-file.ts";

export const VAPID_FILE = "vapid.json";
/** JWT 만료 상한(초). RFC 8292는 24시간을 넘지 못하게 한다 */
export const VAPID_MAX_TTL_SECONDS = 86_400;

export type VapidError =
  | FileError
  | { readonly kind: "corrupt"; readonly path: string; readonly reason: string }
  | { readonly kind: "generate_failed"; readonly cause: unknown };

export type VapidSignError =
  | { readonly kind: "invalid_endpoint" }
  | { readonly kind: "invalid_subject" }
  | { readonly kind: "invalid_ttl" }
  | { readonly kind: "signClaimsfailed"; readonly cause: unknown };

export interface VapidKeyring {
  /** `applicationServerKey`: 비압축 점(65바이트)의 base64url */
  readonly publicKey: string;
  readonly createdAt: number;
  /** 푸시 서비스 주소(endpoint)에 대한 VAPID JWT. `aud`는 endpoint의 출처다 */
  signJwt(input: {
    readonly endpoint: string;
    /** `mailto:`나 `https://` 연락처 */
    readonly subject: string;
    readonly ttlSeconds: number;
  }): Result<string, VapidSignError>;
  /** `Authorization` 헤더 값: `vapid t=<jwt>, k=<공개 키>` */
  authorizationHeader(input: {
    readonly endpoint: string;
    readonly subject: string;
    readonly ttlSeconds: number;
  }): Result<string, VapidSignError>;
}

function b64url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * 저장된 공개 키와 개인 스칼라로 개인 키를 만든다. JWK 가져오기는 `d`와 `x`,`y`가 짝인지 보지 않으므로,
 * 개인 스칼라에서 공개 점을 직접 계산(ECDH)해 저장된 공개 키와 같은지 확인한다.
 */
function keyPairFromParts(
  publicKey: string,
  privateScalar: string,
): Result<KeyObject, { readonly reason: string }> {
  const point = Buffer.from(publicKey, "base64url");
  if (point.byteLength !== 65 || point[0] !== 0x04) return err({ reason: "public_key" });
  const derived = attempt(() => {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(privateScalar, "base64url"));
    return ecdh.getPublicKey();
  });
  if (!derived.ok) return err({ reason: "private_key" });
  if (!derived.value.equals(point)) return err({ reason: "key_mismatch" });
  const made = attempt(() =>
    createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: b64url(point.subarray(1, 33)),
        y: b64url(point.subarray(33, 65)),
        d: privateScalar,
      },
      format: "jwk",
    }),
  );
  if (!made.ok) return err({ reason: "private_key" });
  return ok(made.value);
}

function publicPointOf(privateKey: KeyObject): string | null {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  if (jwk.x === undefined || jwk.y === undefined) return null;
  return b64url(
    Buffer.concat([
      Buffer.of(0x04),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]),
  );
}

function keyringOf(
  privateKey: KeyObject,
  publicKey: string,
  createdAt: number,
  clock: Clock,
): VapidKeyring {
  function signClaims(input: {
    readonly endpoint: string;
    readonly subject: string;
    readonly ttlSeconds: number;
  }): Result<string, VapidSignError> {
    const url = attempt(() => new URL(input.endpoint));
    if (!url.ok || url.value.protocol !== "https:") return err({ kind: "invalid_endpoint" });
    if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/u.test(input.subject)) {
      return err({ kind: "invalid_subject" });
    }
    if (
      !isInteger(input.ttlSeconds) ||
      input.ttlSeconds <= 0 ||
      input.ttlSeconds > VAPID_MAX_TTL_SECONDS
    ) {
      return err({ kind: "invalid_ttl" });
    }
    const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const claims = b64url(
      JSON.stringify({
        aud: url.value.origin,
        exp: Math.floor(clock.now() / 1000) + input.ttlSeconds,
        sub: input.subject,
      }),
    );
    const data = `${header}.${claims}`;
    const signature = attempt(() =>
      sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" }),
    );
    if (!signature.ok) return err({ kind: "signClaimsfailed", cause: signature.error.cause });
    return ok(`${data}.${b64url(signature.value)}`);
  }

  return {
    publicKey,
    createdAt,
    signJwt: signClaims,
    authorizationHeader(input) {
      const jwt = signClaims(input);
      if (!jwt.ok) return jwt;
      return ok(`vapid t=${jwt.value}, k=${publicKey}`);
    },
  };
}

/** 폴더의 VAPID 키를 열고, 없으면 만들어 저장한다. 파일이 손상이면 새로 만들지 않고 오류로 돌려준다(구독이 모두 무효가 되기 때문이다) */
export function openVapid(options: {
  readonly dir: string;
  readonly clock: Clock;
}): Result<VapidKeyring, VapidError> {
  const file = `${options.dir}/${VAPID_FILE}`;
  const text = readTextFile(file);
  if (!text.ok) return text;

  if (text.value !== null) {
    const json = parseJson(text.value);
    const corrupt = (reason: string): Result<VapidKeyring, VapidError> =>
      err({ kind: "corrupt", path: file, reason });
    if (!json.ok || !isRecord(json.value) || ownField(json.value, "version") !== 1)
      return corrupt("shape");
    const publicKey = ownField(json.value, "publicKey");
    const privateKey = ownField(json.value, "privateKey");
    const createdAt = ownField(json.value, "createdAt");
    if (typeof publicKey !== "string" || typeof privateKey !== "string" || !isInteger(createdAt)) {
      return corrupt("fields");
    }
    const key = keyPairFromParts(publicKey, privateKey);
    if (!key.ok) return corrupt(key.error.reason);
    return ok(keyringOf(key.value, publicKey, createdAt, options.clock));
  }

  const generated = attempt(() => generateKeyPairSync("ec", { namedCurve: "prime256v1" }));
  if (!generated.ok) return err({ kind: "generate_failed", cause: generated.error.cause });
  const jwk = generated.value.privateKey.export({ format: "jwk" });
  const point = publicPointOf(generated.value.privateKey);
  if (jwk.d === undefined || point === null) {
    return err({ kind: "generate_failed", cause: new Error("the generated key has no JWK parts") });
  }
  const createdAt = options.clock.now();
  const written = writeSecretFile(
    file,
    `${JSON.stringify({ version: 1, publicKey: point, privateKey: jwk.d, createdAt }, null, 2)}\n`,
  );
  if (!written.ok) return written;
  return ok(keyringOf(generated.value.privateKey, point, createdAt, options.clock));
}
