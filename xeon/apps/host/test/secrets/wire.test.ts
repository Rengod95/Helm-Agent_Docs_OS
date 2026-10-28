import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { parseSecretRef, SecretNameSchema, type SecretHandle } from "@xeon/contracts/capabilities";
import type { SecretError } from "@xeon/contracts/services";
import { WIRE_ERRORS, type WireError } from "@xeon/contracts/wire";
import { wireErrorOfSecret } from "../../src/secrets/wire.ts";

// HS-47: SecretError는 internal 하나가 아니라 secret.* 전용 kind로 1:1 옮긴다(F wire §3.5.2 3201~3212).
// 입력 오류만 -32602다. details에는 안전한 필드만 있고 외부 도구의 출력(stderr)과 경로는 없다.

const name = parse(SecretNameSchema, "exa-key");
if (!name.ok) throw new Error("fixture name must be valid");
const reference = parseSecretRef(`secret://${name.value}`);
if (!reference.ok) throw new Error("fixture reference must be valid");
const HANDLE: SecretHandle = reference.value.handle;

function mapped(error: SecretError): { kind: string; code: number; details: unknown } {
  const wire: WireError = wireErrorOfSecret(error, "secret.test");
  return { kind: wire.data.kind, code: wire.code, details: wire.data.details };
}

const CASES: readonly (readonly [SecretError, string, number, unknown])[] = [
  [
    { kind: "secret_missing", handle: HANDLE, where: "provider" },
    "secret.notFound",
    3201,
    { where: "provider" },
  ],
  [
    { kind: "denied", handle: HANDLE, reason: "expired" },
    "secret.denied",
    3202,
    { reason: "expired" },
  ],
  [
    { kind: "provider_unavailable", provider: "sops", reason: "binary_missing" },
    "secret.providerUnavailable",
    3203,
    { provider: "sops", reason: "binary_missing" },
  ],
  [
    { kind: "key_unavailable", key: "darwin-keychain", reason: "locked" },
    "secret.keyUnavailable",
    3204,
    { key: "darwin-keychain", reason: "locked" },
  ],
  [
    { kind: "decrypt_failed", provider: "sops", exitCode: 128, stderrMasked: "PRIVATE-STDERR" },
    "secret.decryptFailed",
    3205,
    { provider: "sops", exitCode: 128 },
  ],
  [{ kind: "in_use", handle: HANDLE, activeLeases: 3 }, "secret.inUse", 3206, { activeLeases: 3 }],
  [{ kind: "already_exists", handle: HANDLE }, "secret.alreadyExists", 3207, undefined],
  [
    { kind: "read_only_provider", provider: "bws" },
    "secret.readOnlyProvider",
    3208,
    { provider: "bws" },
  ],
  [{ kind: "reauth_required" }, "secret.reauthRequired", 3209, undefined],
  [{ kind: "cancelled" }, "secret.cancelled", 3210, undefined],
  [
    { kind: "audit_unwritable", path: "/private/audit.log", code: "EACCES" },
    "secret.auditUnwritable",
    3211,
    { code: "EACCES" },
  ],
  [
    { kind: "write_failed", target: "key_file", path: "/private/keys.txt", code: "EEXIST" },
    "secret.writeFailed",
    3212,
    { target: "key_file", code: "EEXIST" },
  ],
];

test("each SecretError becomes its own secret.* kind with the code the wire table gives", () => {
  for (const [error, kind, code, details] of CASES) {
    expect(mapped(error)).toEqual({ kind, code, details });
    expect(Object.values(WIRE_ERRORS).find((entry) => entry.kind === kind)?.code).toBe(code);
  }
});

test("neither the external tool output nor a file path reaches the wire error", () => {
  const stderr = wireErrorOfSecret(
    { kind: "decrypt_failed", provider: "sops", exitCode: 1, stderrMasked: "PRIVATE-STDERR" },
    "secret.test",
  );
  expect(JSON.stringify(stderr.data)).not.toContain("PRIVATE-STDERR");
  const audit = wireErrorOfSecret(
    { kind: "audit_unwritable", path: "/private/audit.log", code: "EACCES" },
    "secret.test",
  );
  expect(JSON.stringify(audit.data)).not.toContain("/private");
  expect(audit.message).not.toContain("/private");
});

test("input errors stay -32602, they are not secret.* kinds", () => {
  const invalidRef = mapped({ kind: "invalid_ref", reason: "scheme" });
  expect(invalidRef.kind).toBe("jsonrpc.invalidParams");
  expect(invalidRef.code).toBe(-32602);
  expect(mapped({ kind: "value_too_short", minBytes: 8 }).code).toBe(-32602);
  expect(
    mapped({ kind: "meta_invalid", name: "exa-key", path: "", errors: ["/desc: pattern"] }).code,
  ).toBe(-32602);
});
