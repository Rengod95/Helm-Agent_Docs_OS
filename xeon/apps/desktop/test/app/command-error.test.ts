import { describe, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { errorOf } from "../../src/app/command-error.ts";

describe("errorOf", () => {
  test("a missing method is unsupported, not a rejection", () => {
    expect(
      errorOf(wireError("jsonrpc.methodNotFound", { details: { method: "trust.get" } })),
    ).toEqual({
      kind: "unsupported",
    });
  });

  test("thread.locked keeps the owner and only the options this screen can draw", () => {
    const locked = wireError("thread.locked", {
      details: { ownerKind: "cli", options: ["observe", "fork", "delegate"] },
    });
    expect(errorOf(locked)).toEqual({
      kind: "locked",
      ownerKind: "cli",
      options: ["observe", "fork"],
    });
  });

  test("thread.locked with details of the wrong shape still reports the lock, without options", () => {
    const locked = wireError("thread.locked", { details: { ownerKind: 7 } });
    expect(errorOf(locked)).toEqual({ kind: "locked", ownerKind: "unknown", options: [] });
  });

  test("a rejected value keeps the first issue sentence the host wrote, and a malformed details keeps only the code", () => {
    const invalid = wireError("settings.invalidValue", {
      details: {
        key: "l1.models.default",
        issues: [
          {
            path: "value",
            message:
              "알 수 없는 모델 anthropic/claude-sonnet-5.5 (anthropic의 모델: claude-sonnet-5-5)",
          },
        ],
      },
    });
    expect(errorOf(invalid)).toEqual({
      kind: "rejected",
      code: 3102,
      detail: "알 수 없는 모델 anthropic/claude-sonnet-5.5 (anthropic의 모델: claude-sonnet-5-5)",
    });
    const bare = wireError("settings.invalidValue", { details: { key: "k", issues: [] } });
    expect(errorOf(bare)).toEqual({ kind: "rejected", code: 3102 });
  });

  test("other wire errors keep their code and a foreign throw is a plain failure", () => {
    expect(errorOf(wireError("thread.notFound"))).toEqual({ kind: "rejected", code: 3001 });
    expect(errorOf(new Error("boom"))).toEqual({ kind: "failed" });
  });
});
