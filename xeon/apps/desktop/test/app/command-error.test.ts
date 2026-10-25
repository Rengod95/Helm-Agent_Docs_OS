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

  test("other wire errors keep their code and a foreign throw is a plain failure", () => {
    expect(errorOf(wireError("thread.notFound"))).toEqual({ kind: "rejected", code: 3001 });
    expect(errorOf(new Error("boom"))).toEqual({ kind: "failed" });
  });
});
