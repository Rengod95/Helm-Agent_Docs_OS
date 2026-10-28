import { describe, expect, test } from "bun:test";
import { assertNever } from "../../src/base/index.ts";
import type { SecretError } from "../../src/services/index.ts";

/** 새 변형을 더하면 이 switch가 컴파일되지 않는다(TY-13) */
function labelOf(error: SecretError): string {
  switch (error.kind) {
    case "secret_missing":
    case "denied":
    case "provider_unavailable":
    case "key_unavailable":
    case "decrypt_failed":
    case "meta_invalid":
    case "value_too_short":
    case "in_use":
    case "already_exists":
    case "read_only_provider":
    case "reauth_required":
    case "cancelled":
    case "invalid_ref":
    case "unsupported_ref_syntax":
      return error.kind;
    case "audit_unwritable":
      return `audit:${error.code}`;
    case "write_failed":
      return `${error.target}:${error.code}`;
    default:
      return assertNever(error, "SecretError");
  }
}

describe("SecretError file failures", () => {
  test("audit_unwritable and write_failed carry the path and the OS code", () => {
    const audit: SecretError = { kind: "audit_unwritable", path: "/p/audit.log", code: "EACCES" };
    const key: SecretError = {
      kind: "write_failed",
      target: "key_file",
      path: "/p/keys.txt",
      code: "EEXIST",
    };
    expect(labelOf(audit)).toBe("audit:EACCES");
    expect(labelOf(key)).toBe("key_file:EEXIST");
    const sops: SecretError = {
      kind: "write_failed",
      target: "sops_file",
      path: "/p/user.yaml",
      code: "sops_encrypt_failed",
    };
    const store: SecretError = {
      kind: "write_failed",
      target: "key_store",
      path: "keychain",
      code: "add_failed",
    };
    expect(labelOf(sops)).toBe("sops_file:sops_encrypt_failed");
    expect(labelOf(store)).toBe("key_store:add_failed");
  });
});
