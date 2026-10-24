import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { CapabilityError, type CommonErrorCode } from "@xeon/contracts/capabilities";
import {
  ExecutionError,
  FileError,
  type ExecutionErrorCode,
  type FileErrorCode,
} from "@xeon/contracts/services";
import {
  executionErrorCode,
  fileErrorCode,
  guarded,
  toCapabilityError,
  WorkspaceFailure,
} from "../src/errors.ts";

describe("error mapping", () => {
  test("maps env errors", () => {
    // spec §4.1 표의 각 행
    const files: readonly (readonly [FileErrorCode, CommonErrorCode])[] = [
      ["aborted", "aborted"],
      ["not_found", "not_found"],
      ["permission_denied", "denied"],
      ["not_directory", "invalid_input"],
      ["is_directory", "invalid_input"],
      ["invalid", "invalid_input"],
      ["not_supported", "unsupported"],
      ["unknown", "internal"],
    ];
    for (const [from, to] of files) expect(fileErrorCode(from)).toBe(to);
    const executions: readonly (readonly [ExecutionErrorCode, CommonErrorCode])[] = [
      ["aborted", "aborted"],
      ["timeout", "timeout"],
      ["shell_unavailable", "unavailable"],
      ["spawn_error", "internal"],
      ["callback_error", "internal"],
      ["unknown", "internal"],
      // Xeon 추가 코드: 표에 없어 막은 것은 denied, 래핑 실패는 internal
      ["env_denied", "denied"],
      ["secret_unavailable", "denied"],
      ["sandbox_unavailable", "denied"],
      ["sandbox_failed", "internal"],
    ];
    for (const [from, to] of executions) expect(executionErrorCode(from)).toBe(to);
  });

  test("builds a CapabilityError with the capability, method and retryability", () => {
    const fromFile = toCapabilityError(
      "workspace.files",
      "read",
      new FileError("not_found", "gone", "/x"),
    );
    expect(fromFile).toBeInstanceOf(CapabilityError);
    expect(fromFile instanceof CapabilityError ? fromFile.data : undefined).toEqual({
      capability: "workspace.files",
      method: "read",
      code: "not_found",
      message: "gone",
      retryable: false,
    });
    const timeout = toCapabilityError(
      "workspace.shell",
      "run",
      new ExecutionError("timeout", "slow"),
    );
    expect(timeout instanceof CapabilityError ? timeout.data.retryable : undefined).toBe(true);
    const own = toCapabilityError(
      "workspace.files",
      "read",
      new WorkspaceFailure("offset_beyond_end", "past", { detail: { totalLines: 2 } }),
    );
    expect(own instanceof CapabilityError ? own.data : undefined).toMatchObject({
      code: "offset_beyond_end",
      retryable: false,
      detail: { totalLines: 2 },
    });
  });

  test("keeps bugs and finished errors, and names unknown failures internal", async () => {
    const bug = new Bug("invariant");
    expect(toCapabilityError("workspace.files", "read", bug)).toBe(bug);
    const done = new CapabilityError({
      capability: "workspace.files",
      method: "read",
      code: "denied",
      message: "no",
      retryable: false,
    });
    expect(toCapabilityError("workspace.files", "read", done)).toBe(done);
    const abort = new DOMException("stop", "AbortError");
    expect(toCapabilityError("workspace.files", "read", abort)).toMatchObject({
      data: { code: "aborted" },
    });
    expect(toCapabilityError("workspace.files", "read", new TypeError("oops"))).toMatchObject({
      data: { code: "internal", message: "oops" },
    });
    let caught: unknown;
    try {
      await guarded("workspace.files", "read", () =>
        Promise.reject(new FileError("invalid", "bad")),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CapabilityError);
  });
});
