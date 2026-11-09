import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 시험용 자체 서명 인증서(ECDSA P-256, SAN localhost·127.0.0.1, 2일). 다른 패키지의 wss 시험이 로컬 TLS 서버를 띄울 때 쓴다.
// 프로세스를 띄우는 일은 L0가 맡는다(DR-07). openssl이 없으면 null이고 시험은 건너뛴다. 진짜 키가 아니며 시험이 끝나면 지운다.

export interface TestTlsIdentity {
  readonly cert: string;
  readonly key: string;
  /** DER 인증서의 SHA-256, 64자리 소문자 16진수 */
  readonly fingerprint: string;
}

export async function createTestTlsIdentity(): Promise<TestTlsIdentity | null> {
  if (Bun.which("openssl") === null) return null;
  const dir = mkdtempSync(join(tmpdir(), "fresnel-test-tls-"));
  const keyFile = join(dir, "key.pem");
  const certFile = join(dir, "cert.pem");
  const proc = Bun.spawn(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      keyFile,
      "-out",
      certFile,
      "-days",
      "2",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await proc.exited) !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const cert = readFileSync(certFile, "utf8");
  const key = readFileSync(keyFile, "utf8");
  rmSync(dir, { recursive: true, force: true });
  const der = Buffer.from(
    cert
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("-----"))
      .join(""),
    "base64",
  );
  return {
    cert,
    key,
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}
