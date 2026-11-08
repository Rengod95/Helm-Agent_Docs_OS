import { afterEach, describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  derBitString,
  derOid,
  derPositiveInteger,
  derTime,
  derUtf8String,
  tlv,
} from "../../src/web/tls/der.ts";
import {
  fingerprintOfDer,
  fingerprintOfPem,
  fingerprintsEqual,
  formatFingerprint,
  parseFingerprint,
} from "../../src/web/tls/fingerprint.ts";
import {
  createSelfSignedCertificate,
  SELF_SIGNED_VALID_DAYS,
} from "../../src/web/tls/self-signed.ts";
import { CERT_FILE, EXPIRY_WARNING_MS, KEY_FILE, prepareTls } from "../../src/web/tls/store.ts";
import { cleanupTempDirs, manualClock, sequenceBytes, tempDir } from "./support/fixtures.ts";

afterEach(cleanupTempDirs);

const DAY = 86_400_000;

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("der", () => {
  test("lengths use the short form below 128 and the long form above", () => {
    expect(hex(tlv(0x04, new Uint8Array(127))).slice(0, 4)).toBe("047f");
    expect(hex(tlv(0x04, new Uint8Array(128))).slice(0, 6)).toBe("048180");
    expect(hex(tlv(0x04, new Uint8Array(256))).slice(0, 8)).toBe("04820100");
  });

  test("integers stay positive: a high first bit gets a zero byte and leading zeros are trimmed", () => {
    expect(hex(derPositiveInteger(Uint8Array.of(0x7f)))).toBe("02017f");
    expect(hex(derPositiveInteger(Uint8Array.of(0x80)))).toBe("02020080");
    expect(hex(derPositiveInteger(Uint8Array.of(0, 0, 1)))).toBe("020101");
    expect(hex(derPositiveInteger(Uint8Array.of(0)))).toBe("020100");
  });

  test("object identifiers encode multi-byte arcs", () => {
    expect(hex(derOid("2.5.29.17"))).toBe("0603551d11");
    expect(hex(derOid("1.2.840.10045.4.3.2"))).toBe("06082a8648ce3d040302");
    expect(hex(derOid("1.3.6.1.5.5.7.3.1"))).toBe("06082b06010505070301");
  });

  test("times use UTCTime before 2050 and GeneralizedTime from 2050", () => {
    expect(Buffer.from(derTime(Date.UTC(2026, 10, 8, 1, 2, 3, 999))).toString("latin1")).toBe(
      "\x17\x0d261108010203Z",
    );
    expect(Buffer.from(derTime(Date.UTC(2051, 0, 2, 3, 4, 5))).toString("latin1")).toBe(
      "\x18\x0f20510102030405Z",
    );
  });

  test("strings and bit strings", () => {
    expect(hex(derUtf8String("가"))).toBe("0c03eab080");
    expect(hex(derBitString(Uint8Array.of(0x80), 7))).toBe("03020780");
  });
});

describe("fingerprint", () => {
  test("SHA-256 of known bytes, in both display forms", () => {
    const fingerprint = fingerprintOfDer(new TextEncoder().encode("abc"));
    expect(fingerprint).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(formatFingerprint(fingerprint)).toBe(
      "BA:78:16:BF:8F:01:CF:EA:41:41:40:DE:5D:AE:22:23:B0:03:61:A3:96:17:7A:9C:B4:10:FF:61:F2:00:15:AD",
    );
  });

  test("parse accepts colons, spaces and any case and rejects wrong lengths and characters", () => {
    const fingerprint = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(parseFingerprint(formatFingerprint(fingerprint))).toEqual({
      ok: true,
      value: fingerprint,
    });
    expect(parseFingerprint(` ${fingerprint.toUpperCase()} `)).toEqual({
      ok: true,
      value: fingerprint,
    });
    expect(parseFingerprint(fingerprint.slice(2))).toEqual({
      ok: false,
      error: { kind: "invalid_fingerprint" },
    });
    expect(parseFingerprint(`${fingerprint.slice(0, 63)}g`)).toEqual({
      ok: false,
      error: { kind: "invalid_fingerprint" },
    });
  });

  test("equality compares values and refuses malformed input", () => {
    const a = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(fingerprintsEqual(a, a)).toBe(true);
    expect(fingerprintsEqual(a, `${a.slice(0, 63)}0`)).toBe(false);
    expect(fingerprintsEqual(a, "ba78")).toBe(false);
    expect(fingerprintsEqual("", "")).toBe(false);
  });

  test("a PEM certificate's fingerprint matches what X509Certificate reports", () => {
    const made = createSelfSignedCertificate({ hosts: ["a.example.com"], clock: manualClock() });
    if (!made.ok) throw new Error(`certificate was not made: ${made.error.kind}`);
    const cert = new X509Certificate(made.value.certPem);
    expect(made.value.fingerprint).toBe(parseFingerprintOrThrow(cert.fingerprint256));
    expect(fingerprintOfPem(made.value.certPem)).toEqual({
      ok: true,
      value: made.value.fingerprint,
    });
    expect(fingerprintOfPem("not a certificate").ok).toBe(false);
  });
});

function publicOf(pem: string): string {
  return createPublicKey(createPrivateKey(pem)).export({ type: "spki", format: "pem" });
}

function mode(file: string): number {
  return statSync(file).mode & 0o777;
}

function userFiles(
  hosts: readonly string[],
  clock = manualClock(),
): { readonly certPath: string; readonly keyPath: string; readonly fingerprint: string } {
  const dir = tempDir();
  const made = createSelfSignedCertificate({ hosts, clock });
  if (!made.ok) throw new Error("certificate was not made");
  const certPath = path.join(dir, "user.crt");
  const keyPath = path.join(dir, "user.key");
  writeFileSync(certPath, made.value.certPem);
  writeFileSync(keyPath, made.value.keyPem);
  return { certPath, keyPath, fingerprint: made.value.fingerprint };
}

function parseFingerprintOrThrow(text: string): string {
  const parsed = parseFingerprint(text);
  if (!parsed.ok) throw new Error("fingerprint did not parse");
  return parsed.value;
}

describe("self-signed certificate", () => {
  const clock = manualClock();

  function made(
    hosts: readonly string[],
    keyPem?: string,
  ): ReturnType<typeof createSelfSignedCertificate> {
    return createSelfSignedCertificate({
      hosts,
      clock,
      randomBytes: sequenceBytes(3),
      ...(keyPem === undefined ? {} : { keyPem }),
    });
  }

  test("is ECDSA P-256, valid two years from now, signed by its own key", () => {
    const result = made(["fresnel.example.com", "192.168.1.5"]);
    if (!result.ok) throw new Error(`certificate was not made: ${result.error.kind}`);
    const cert = new X509Certificate(result.value.certPem);
    expect(cert.publicKey.asymmetricKeyType).toBe("ec");
    expect(cert.publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.ca).toBe(false);
    expect(cert.subject).toBe("CN=Fresnel remote gateway");
    expect(cert.issuer).toBe(cert.subject);
    // 시작은 시계 어긋남을 견디도록 5분 앞이고, 끝은 정확히 730일 뒤다
    expect(Date.parse(cert.validFrom)).toBe(clock.now() - 5 * 60_000);
    expect(Date.parse(cert.validTo)).toBe(clock.now() + SELF_SIGNED_VALID_DAYS * DAY);
    expect(result.value.notBefore).toBe(Date.parse(cert.validFrom));
    expect(result.value.notAfter).toBe(Date.parse(cert.validTo));
    expect(SELF_SIGNED_VALID_DAYS).toBe(730);
    expect(cert.keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
  });

  test("the subject alternative names are the given names and addresses plus loopback", () => {
    const result = made(["Fresnel.Example.com", "192.168.1.5", "[fe80::1]", "fresnel.example.com"]);
    if (!result.ok) throw new Error(`certificate was not made: ${result.error.kind}`);
    expect(result.value.hosts).toEqual([
      "fresnel.example.com",
      "192.168.1.5",
      "fe80::1",
      "localhost",
      "127.0.0.1",
      "::1",
    ]);
    const cert = new X509Certificate(result.value.certPem);
    expect(cert.subjectAltName).toBe(
      "DNS:fresnel.example.com, IP Address:192.168.1.5, IP Address:FE80:0:0:0:0:0:0:1, DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
    );
    expect(cert.checkHost("fresnel.example.com")).toBe("fresnel.example.com");
    expect(cert.checkHost("other.example.com")).toBeUndefined();
    expect(cert.checkIP("192.168.1.5")).toBe("192.168.1.5");
    expect(cert.checkIP("192.168.1.6")).toBeUndefined();
  });

  test("an IPv4-mapped IPv6 address keeps its tail", () => {
    const result = made(["::ffff:1.2.3.4", "2001:db8::8:800:200c:417a"]);
    if (!result.ok) throw new Error(`certificate was not made: ${result.error.kind}`);
    const cert = new X509Certificate(result.value.certPem);
    expect(cert.subjectAltName).toContain("IP Address:0:0:0:0:0:FFFF:102:304");
    expect(cert.subjectAltName).toContain("IP Address:2001:DB8:0:0:8:800:200C:417A");
  });

  test("the same key signs a renewal, so only the certificate changes", () => {
    const first = made(["a.example.com"]);
    if (!first.ok) throw new Error("first certificate was not made");
    clock.advance(700 * DAY);
    const second = made(["a.example.com", "b.example.com"], first.value.keyPem);
    clock.advance(-700 * DAY);
    if (!second.ok) throw new Error("second certificate was not made");
    expect(second.value.keyPem).toBe(first.value.keyPem);
    expect(second.value.fingerprint).not.toBe(first.value.fingerprint);
    expect(publicOf(second.value.keyPem)).toBe(publicOf(first.value.keyPem));
    expect(new X509Certificate(second.value.certPem).checkHost("b.example.com")).toBe(
      "b.example.com",
    );
  });

  test("bad input is refused with a kind", () => {
    expect(made([])).toEqual({ ok: false, error: { kind: "no_hosts" } });
    expect(made(["bad host"])).toEqual({
      ok: false,
      error: { kind: "invalid_host", host: "bad host" },
    });
    expect(made(["-a.example.com"])).toEqual({
      ok: false,
      error: { kind: "invalid_host", host: "-a.example.com" },
    });
    expect(made(["*.example.com"])).toEqual({
      ok: false,
      error: { kind: "invalid_host", host: "*.example.com" },
    });
    const bad = made(["a.example.com"], "not a key");
    expect(bad.ok ? "ok" : bad.error.kind).toBe("invalid_key");
  });

  test("Bun's TLS server accepts it and presents the same certificate", async () => {
    const result = made(["localhost"]);
    if (!result.ok) throw new Error("certificate was not made");
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert: result.value.certPem, key: result.value.keyPem },
      fetch: () => new Response("ok"),
    });
    try {
      const response = await fetch(`https://localhost:${server.port}/`, {
        tls: { rejectUnauthorized: false },
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    } finally {
      await server.stop(true);
    }
  });
});

describe("prepareTls", () => {
  test("the first call writes a 0600 key and certificate and the next call reuses them", () => {
    const dir = path.join(tempDir(), "tls");
    const clock = manualClock();
    const first = prepareTls({ dir, hosts: ["a.example.com"], clock });
    if (!first.ok) throw new Error(`prepare failed: ${first.error.kind}`);
    expect(first.value.source).toBe("self_signed");
    expect(first.value.created).toBe(true);
    expect(first.value.expiresSoon).toBe(false);
    expect(first.value.unmatchedHosts).toEqual([]);
    expect(mode(path.join(dir, KEY_FILE))).toBe(0o600);
    expect(mode(path.join(dir, CERT_FILE))).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
    expect(readFileSync(path.join(dir, CERT_FILE), "utf8")).toBe(first.value.certPem);

    const second = prepareTls({ dir, hosts: ["a.example.com"], clock });
    if (!second.ok) throw new Error("second prepare failed");
    expect(second.value.created).toBe(false);
    expect(second.value.fingerprint).toBe(first.value.fingerprint);
    expect(second.value.keyPem).toBe(first.value.keyPem);
  });

  test("a new host renews the certificate and keeps the key", () => {
    const dir = path.join(tempDir(), "tls");
    const clock = manualClock();
    const first = prepareTls({ dir, hosts: ["a.example.com"], clock });
    const second = prepareTls({ dir, hosts: ["a.example.com", "b.example.com"], clock });
    if (!first.ok || !second.ok) throw new Error("prepare failed");
    expect(second.value.created).toBe(true);
    expect(second.value.keyPem).toBe(first.value.keyPem);
    expect(second.value.fingerprint).not.toBe(first.value.fingerprint);
    expect(new X509Certificate(second.value.certPem).checkHost("b.example.com")).toBe(
      "b.example.com",
    );
  });

  test("within 30 days of expiry the certificate is renewed with the same key, at 30 days it is not", () => {
    const dir = path.join(tempDir(), "tls");
    const clock = manualClock();
    const first = prepareTls({ dir, hosts: ["a.example.com"], clock });
    if (!first.ok) throw new Error("prepare failed");
    // 만료까지 정확히 30일: 아직 쓴다(경고는 `<`로 판단하므로 expiresSoon도 거짓)
    clock.set(first.value.notAfter - EXPIRY_WARNING_MS);
    const edge = prepareTls({ dir, hosts: ["a.example.com"], clock });
    if (!edge.ok) throw new Error("edge prepare failed");
    expect(edge.value.created).toBe(false);
    expect(edge.value.expiresSoon).toBe(false);
    // 1ms 모자라면 새로 만든다
    clock.set(first.value.notAfter - EXPIRY_WARNING_MS + 1);
    const renewed = prepareTls({ dir, hosts: ["a.example.com"], clock });
    if (!renewed.ok) throw new Error("renew failed");
    expect(renewed.value.created).toBe(true);
    expect(renewed.value.keyPem).toBe(first.value.keyPem);
    expect(renewed.value.notAfter).toBe(Math.floor(clock.now() / 1000) * 1000 + 730 * DAY);
    expect(renewed.value.expiresSoon).toBe(false);
  });

  test("a damaged key is reported and neither file is replaced", () => {
    const dir = path.join(tempDir(), "tls");
    const clock = manualClock();
    const first = prepareTls({ dir, hosts: ["a.example.com"], clock });
    if (!first.ok) throw new Error("prepare failed");
    writeFileSync(path.join(dir, KEY_FILE), "garbage", { mode: 0o600 });
    const second = prepareTls({ dir, hosts: ["a.example.com"], clock });
    expect(second.ok ? "ok" : second.error.kind).toBe("invalid_key");
    expect(readFileSync(path.join(dir, KEY_FILE), "utf8")).toBe("garbage");
    expect(readFileSync(path.join(dir, CERT_FILE), "utf8")).toBe(first.value.certPem);
  });

  test("an unreadable key file is an io error", () => {
    const dir = path.join(tempDir(), "tls");
    const clock = manualClock();
    prepareTls({ dir, hosts: ["a.example.com"], clock });
    chmodSync(path.join(dir, KEY_FILE), 0o000);
    const result = prepareTls({ dir, hosts: ["a.example.com"], clock });
    chmodSync(path.join(dir, KEY_FILE), 0o600);
    // root로 돌면 0000 파일도 읽히므로 그때는 건너뛴다
    if (process.getuid?.() === 0) return;
    expect(result.ok ? "ok" : result.error.kind).toBe("io");
  });

  describe("user certificate", () => {
    test("is read in place, not copied, and reports hosts it does not cover", () => {
      const files = userFiles(["a.example.com"]);
      const stateDir = path.join(tempDir(), "tls");
      const result = prepareTls({
        dir: stateDir,
        hosts: ["a.example.com", "other.example.com"],
        clock: manualClock(),
        userCertificate: files,
      });
      if (!result.ok) throw new Error(`prepare failed: ${result.error.kind}`);
      expect(result.value.source).toBe("user");
      expect(result.value.created).toBe(false);
      expect(result.value.fingerprint).toBe(files.fingerprint);
      expect(result.value.unmatchedHosts).toEqual(["other.example.com"]);
      expect(() => statSync(stateDir)).toThrow();
    });

    test("a missing file, a mismatched key and an expired certificate are refused without falling back", () => {
      const clock = manualClock();
      const files = userFiles(["a.example.com"], clock);
      const stateDir = path.join(tempDir(), "tls");
      const base = { dir: stateDir, hosts: ["a.example.com"], clock };

      const missing = prepareTls({
        ...base,
        userCertificate: { certPath: files.certPath, keyPath: `${files.keyPath}.nope` },
      });
      expect(missing).toEqual({
        ok: false,
        error: { kind: "missing_file", path: `${files.keyPath}.nope` },
      });

      const other = userFiles(["a.example.com"]);
      const mismatch = prepareTls({
        ...base,
        userCertificate: { certPath: files.certPath, keyPath: other.keyPath },
      });
      expect(mismatch).toEqual({
        ok: false,
        error: { kind: "key_mismatch", certPath: files.certPath, keyPath: other.keyPath },
      });

      clock.advance(731 * DAY);
      const expired = prepareTls({ ...base, userCertificate: files });
      expect(expired.ok ? "ok" : expired.error.kind).toBe("expired");
      expect(() => statSync(stateDir)).toThrow();
    });

    test("a certificate within 30 days of expiry still works but warns", () => {
      const clock = manualClock();
      const files = userFiles(["a.example.com"], clock);
      clock.advance(710 * DAY);
      const result = prepareTls({
        dir: path.join(tempDir(), "tls"),
        hosts: ["a.example.com"],
        clock,
        userCertificate: files,
      });
      if (!result.ok) throw new Error("prepare failed");
      expect(result.value.expiresSoon).toBe(true);
    });
  });
});
