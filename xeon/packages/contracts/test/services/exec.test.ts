import { describe, expect, test } from "bun:test";
import {
  ExecutionError,
  FileError,
  SENSITIVE_ENV_PATTERNS,
  type CancelScope,
  type ExecutionErrorCode,
  type FileErrorCode,
} from "../../src/services/index.ts";

/** 끝의 *만 와일드카드인 패턴이 이름과 맞는가(L0.exec.spec §3.5 deny 규칙) */
function denied(name: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) =>
    pattern.startsWith("*")
      ? name.endsWith(pattern.slice(1))
      : pattern.endsWith("*")
        ? name.startsWith(pattern.slice(0, -1))
        : name === pattern,
  );
}

describe("SENSITIVE_ENV_PATTERNS", () => {
  test("covers provider and secret variables", () => {
    for (const name of [
      "SOPS_AGE_KEY_FILE",
      "SOPS_AGE_KEY_CMD",
      "AGE_SECRET",
      "OP_SERVICE_ACCOUNT_TOKEN",
      "BWS_ACCESS_TOKEN",
      "BW_SESSION",
      "XEON_SECRET_X",
      "GITHUB_TOKEN",
      "STRIPE_API_KEY",
      "AWS_ACCESS_KEY_ID",
      "ANTHROPIC_API_KEY",
      "OPENAI_ORG",
      "GEMINI_KEY",
      "OPENROUTER_X",
      "SSH_AUTH_SOCK",
      "NODE_OPTIONS",
      "BUN_OPTIONS",
      "DB_PASSWORD",
      "CLIENT_SECRET",
    ]) {
      expect({ name, denied: denied(name) }).toEqual({ name, denied: true });
    }
  });

  test("leaves the base pass list alone", () => {
    for (const name of [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TZ",
      "TMPDIR",
      "SHELL",
      "TERM",
      "NO_COLOR",
      "CI",
    ]) {
      expect({ name, denied: denied(name) }).toEqual({ name, denied: false });
    }
  });

  test("only a trailing or leading star is used", () => {
    for (const pattern of SENSITIVE_ENV_PATTERNS) {
      const stars = pattern.split("*").length - 1;
      expect(stars).toBeLessThanOrEqual(1);
      if (stars === 1) expect(pattern.startsWith("*") || pattern.endsWith("*")).toBe(true);
    }
    expect(new Set(SENSITIVE_ENV_PATTERNS).size).toBe(SENSITIVE_ENV_PATTERNS.length);
  });
});

describe("error classes", () => {
  test("FileError carries code, path and cause", () => {
    const cause = new Error("boom");
    const error = new FileError("not_found", "no such file", "/a/b", cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FileError);
    expect(error.name).toBe("FileError");
    expect(error.code).toBe("not_found");
    expect(error.path).toBe("/a/b");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("no such file");
  });

  test("FileError without a path has no path key", () => {
    const error = new FileError("aborted", "stopped");
    expect("path" in error).toBe(false);
    expect(error.cause).toBeUndefined();
  });

  test("ExecutionError carries code, a mutable spill path and cause", () => {
    const error = new ExecutionError("timeout", "too slow");
    expect(error).toBeInstanceOf(ExecutionError);
    expect(error.name).toBe("ExecutionError");
    expect(error.code).toBe("timeout");
    expect(error.spillPath).toBeUndefined();
    error.spillPath = "/tmp/out.log";
    expect(error.spillPath).toBe("/tmp/out.log");
    const cause = new Error("inner");
    expect(new ExecutionError("spawn_error", "x", cause).cause).toBe(cause);
  });

  test("the two classes are distinct", () => {
    expect(new FileError("unknown", "m") instanceof ExecutionError).toBe(false);
    expect(new ExecutionError("unknown", "m") instanceof FileError).toBe(false);
  });

  test("error codes include the Xeon additions", () => {
    const codes: readonly ExecutionErrorCode[] = [
      "env_denied",
      "secret_unavailable",
      "sandbox_unavailable",
      "sandbox_failed",
    ];
    for (const code of codes) expect(new ExecutionError(code, "m").code).toBe(code);
    const fileCodes: readonly FileErrorCode[] = ["aborted", "not_found", "permission_denied"];
    expect(fileCodes).toHaveLength(3);
  });

  test("CancelScope accepts an undefined signal", () => {
    const none: CancelScope = { abortSignal: undefined };
    const active: CancelScope = { abortSignal: new AbortController().signal };
    expect(none.abortSignal).toBeUndefined();
    expect(active.abortSignal?.aborted).toBe(false);
  });
});
