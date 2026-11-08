// 게이트웨이가 쓸 TLS 재료를 준비한다(spec §8.2).
// - 사용자 인증서 경로가 있으면 그 파일을 읽어 검사만 한다(복사하지 않는다, 갱신도 사용자 몫이다).
// - 없으면 상태 폴더의 자체 서명 인증서(`cert.pem`, `key.pem`, 0600)를 쓴다. 없거나 호스트가 늘었거나 30일 안에 만료하면
//   같은 키로 새 인증서를 만든다. 키 파일이 읽히지 않거나 손상이면 조용히 새로 만들지 않고 오류로 돌려준다(지문이 바뀌기 때문이다).
import { createPrivateKey, X509Certificate } from "node:crypto";
import { attempt, err, ok, type Clock, type Result } from "@fresnel/contracts";
import { readTextFile, writeSecretFile, type FileError } from "../auth/atomic-file.ts";
import { fingerprintOfDer } from "./fingerprint.ts";
import { createSelfSignedCertificate, normalizeHost, type SelfSignedError } from "./self-signed.ts";

/** 만료가 이 안에 들면 경고하고 자체 서명은 다시 만든다(spec §11) */
export const EXPIRY_WARNING_MS: number = 30 * 86_400_000;

export const CERT_FILE = "cert.pem";
export const KEY_FILE = "key.pem";

interface UserCertificatePaths {
  readonly certPath: string;
  readonly keyPath: string;
}

export interface TlsOptions {
  /** 자체 서명 파일을 두는 폴더(예: `<origin 상태 폴더>/remote/tls`) */
  readonly dir: string;
  readonly hosts: readonly string[];
  readonly clock: Clock;
  readonly userCertificate?: UserCertificatePaths;
  readonly randomBytes?: (size: number) => Uint8Array;
}

type TlsSource = "self_signed" | "user";

export interface TlsMaterial {
  readonly source: TlsSource;
  readonly certPem: string;
  readonly keyPem: string;
  /** 소문자 16진 SHA-256 */
  readonly fingerprint: string;
  readonly notBefore: number;
  readonly notAfter: number;
  /** 만료까지 30일 안인가(연결 화면과 데스크톱 알림이 경고한다) */
  readonly expiresSoon: boolean;
  /** 이번 호출에서 자체 서명 인증서를 새로 만들었나(처음 만듦, 갱신 모두) */
  readonly created: boolean;
  /** 사용자 인증서가 덮지 못하는 호스트(자체 서명은 항상 비어 있다). 브라우저 경고의 원인이라 알려 준다 */
  readonly unmatchedHosts: readonly string[];
}

export type TlsError =
  | FileError
  | SelfSignedError
  | { readonly kind: "invalid_certificate"; readonly path: string; readonly cause: unknown }
  | { readonly kind: "invalid_key"; readonly path: string; readonly cause: unknown }
  | { readonly kind: "key_mismatch"; readonly certPath: string; readonly keyPath: string }
  | { readonly kind: "expired"; readonly certPath: string; readonly notAfter: number }
  | { readonly kind: "missing_file"; readonly path: string };

function sanCovers(cert: X509Certificate, host: string): boolean {
  const normalized = normalizeHost(host);
  const byName = attempt(() => cert.checkHost(normalized, { wildcards: true, subject: "never" }));
  if (byName.ok && byName.value !== undefined) return true;
  const byAddress = attempt(() => cert.checkIP(normalized));
  return byAddress.ok && byAddress.value !== undefined;
}

function summarize(
  source: TlsSource,
  certPem: string,
  keyPem: string,
  cert: X509Certificate,
  options: { readonly clock: Clock; readonly created: boolean; readonly hosts: readonly string[] },
): TlsMaterial {
  const notBefore = Date.parse(cert.validFrom);
  const notAfter = Date.parse(cert.validTo);
  return {
    source,
    certPem,
    keyPem,
    fingerprint: fingerprintOfDer(cert.raw),
    notBefore,
    notAfter,
    expiresSoon: notAfter - options.clock.now() < EXPIRY_WARNING_MS,
    created: options.created,
    unmatchedHosts: options.hosts.filter((host) => !sanCovers(cert, host)),
  };
}

function loadUserCertificate(
  paths: UserCertificatePaths,
  options: TlsOptions,
): Result<TlsMaterial, TlsError> {
  const certText = readTextFile(paths.certPath);
  if (!certText.ok) return certText;
  if (certText.value === null) return err({ kind: "missing_file", path: paths.certPath });
  const keyText = readTextFile(paths.keyPath);
  if (!keyText.ok) return keyText;
  if (keyText.value === null) return err({ kind: "missing_file", path: paths.keyPath });
  const certPem = certText.value;
  const keyPem = keyText.value;

  const cert = attempt(() => new X509Certificate(certPem));
  if (!cert.ok) {
    return err({ kind: "invalid_certificate", path: paths.certPath, cause: cert.error.cause });
  }
  const key = attempt(() => createPrivateKey(keyPem));
  if (!key.ok) return err({ kind: "invalid_key", path: paths.keyPath, cause: key.error.cause });
  if (!cert.value.checkPrivateKey(key.value)) {
    return err({ kind: "key_mismatch", certPath: paths.certPath, keyPath: paths.keyPath });
  }
  const notAfter = Date.parse(cert.value.validTo);
  if (notAfter <= options.clock.now()) {
    return err({ kind: "expired", certPath: paths.certPath, notAfter });
  }
  return ok(
    summarize("user", certPem, keyPem, cert.value, {
      clock: options.clock,
      created: false,
      hosts: options.hosts,
    }),
  );
}

function selfSigned(options: TlsOptions): Result<TlsMaterial, TlsError> {
  const certFile = `${options.dir}/${CERT_FILE}`;
  const keyFile = `${options.dir}/${KEY_FILE}`;
  const certText = readTextFile(certFile);
  if (!certText.ok) return certText;
  const keyText = readTextFile(keyFile);
  if (!keyText.ok) return keyText;

  const existingKey = keyText.value;
  const existingCert = certText.value;
  let keepKey: string | undefined;
  if (existingKey !== null) {
    const key = attempt(() => createPrivateKey(existingKey));
    if (!key.ok) return err({ kind: "invalid_key", path: keyFile, cause: key.error.cause });
    keepKey = existingKey;
    if (existingCert !== null) {
      const cert = attempt(() => new X509Certificate(existingCert));
      if (!cert.ok) {
        return err({ kind: "invalid_certificate", path: certFile, cause: cert.error.cause });
      }
      const usable =
        cert.value.checkPrivateKey(key.value) &&
        Date.parse(cert.value.validTo) - options.clock.now() >= EXPIRY_WARNING_MS &&
        options.hosts.every((host) => sanCovers(cert.value, host));
      if (usable) {
        return ok(
          summarize("self_signed", existingCert, existingKey, cert.value, {
            clock: options.clock,
            created: false,
            hosts: options.hosts,
          }),
        );
      }
    }
  }

  const made = createSelfSignedCertificate({
    hosts: options.hosts,
    clock: options.clock,
    ...(keepKey === undefined ? {} : { keyPem: keepKey }),
    ...(options.randomBytes === undefined ? {} : { randomBytes: options.randomBytes }),
  });
  if (!made.ok) return made;
  if (keepKey === undefined) {
    const wroteKey = writeSecretFile(keyFile, made.value.keyPem);
    if (!wroteKey.ok) return wroteKey;
  }
  const wroteCert = writeSecretFile(certFile, made.value.certPem);
  if (!wroteCert.ok) return wroteCert;
  const cert = attempt(() => new X509Certificate(made.value.certPem));
  if (!cert.ok)
    return err({ kind: "invalid_certificate", path: certFile, cause: cert.error.cause });
  return ok(
    summarize("self_signed", made.value.certPem, made.value.keyPem, cert.value, {
      clock: options.clock,
      created: true,
      hosts: options.hosts,
    }),
  );
}

/** TLS 재료를 준비한다. 사용자 인증서 경로가 있으면 그것만 본다(실패해도 자체 서명으로 물러서지 않는다) */
export function prepareTls(options: TlsOptions): Result<TlsMaterial, TlsError> {
  return options.userCertificate === undefined
    ? selfSigned(options)
    : loadUserCertificate(options.userCertificate, options);
}
