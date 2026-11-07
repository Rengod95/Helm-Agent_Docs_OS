import { describe, expect, test } from "bun:test";
import { HostClientError } from "@fresnel/client";
import { wireError } from "@fresnel/contracts/wire";
import { errorOf } from "../../src/app/command-error.ts";

describe("errorOf", () => {
  test("a request that got no answer in time is a timeout, not a generic failure", () => {
    expect(
      errorOf(new HostClientError("timeout", "thread.create timed out after 30000ms")),
    ).toEqual({ kind: "rejected", code: null, issue: "timeout" });
    expect(errorOf(new HostClientError("closed", "connection is closed"))).toEqual({
      kind: "failed",
    });
  });

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

  test("an invalid-params rejection keeps the name of the first bad input, so an unknown plan id can be told apart", () => {
    const unknownPlan = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "planId", message: "unknown plan" }] },
    });
    expect(errorOf(unknownPlan)).toEqual({ kind: "rejected", code: -32602, path: "planId" });
    const devkit = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "name", message: "not_found: skill demo" }] },
    });
    expect(errorOf(devkit)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "not_found: skill demo",
      path: "name",
    });
  });

  test("a bundled extension with no version history keeps history_unavailable as the issue", () => {
    const none = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "/name", message: "history_unavailable: bundled" }] },
    });
    expect(errorOf(none)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "history_unavailable: bundled",
      path: "/name",
    });
  });

  test("an install source that is not absolute or has no plugin file keeps its kind as the issue", () => {
    const relative = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [{ path: "/source", message: "not_absolute: source must be an absolute path" }],
      },
    });
    expect(errorOf(relative)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "not_absolute: source must be an absolute path",
      path: "/source",
    });
    const bare = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [
          { path: "/source", message: "no_manifest: .fresnel-plugin/plugin.json is missing" },
        ],
      },
    });
    expect(errorOf(bare)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "no_manifest: .fresnel-plugin/plugin.json is missing",
      path: "/source",
    });
  });

  test("an extension the loader does not know (a built-in core plugin) keeps unknown_extension as the issue", () => {
    const unknown = wireError("jsonrpc.invalidParams", {
      details: { issues: [{ path: "/name", message: "unknown_extension: core-persistence" }] },
    });
    expect(errorOf(unknown)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "unknown_extension: core-persistence",
      path: "/name",
    });
  });

  test("other wire errors keep their code and a foreign throw is a plain failure", () => {
    expect(errorOf(wireError("thread.notFound"))).toEqual({ kind: "rejected", code: 3001 });
    expect(errorOf(new Error("boom"))).toEqual({ kind: "failed" });
  });

  test("attachment rejections keep their code head as the issue", () => {
    const invalid = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [{ path: "source", message: "attachment_too_large: over the 20 byte limit." }],
      },
    });
    expect(errorOf(invalid)).toEqual({
      kind: "rejected",
      code: invalid.code,
      issue: "attachment_too_large: over the 20 byte limit.",
      path: "source",
    });
  });

  test("an install rejection keeps each reason with its field and line, next to the issue", () => {
    const rejected = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [{ path: "/source", message: "invalid_input: manifest is not valid" }],
        reasons: [
          {
            code: "unknown_key",
            field: "plugins/0/hoks",
            line: 12,
            message: "must NOT have additional properties",
          },
          { code: "missing_field", field: "plugins/0/hooks" },
        ],
      },
    });
    expect(errorOf(rejected)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "invalid_input: manifest is not valid",
      path: "/source",
      reasons: [
        {
          code: "unknown_key",
          field: "plugins/0/hoks",
          line: 12,
          message: "must NOT have additional properties",
        },
        { code: "missing_field", field: "plugins/0/hooks" },
      ],
    });
  });

  test("malformed reasons are ignored and the issue and the input name stay", () => {
    const emptyCode = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [{ path: "/source", message: "not_absolute: source must be an absolute path" }],
        reasons: [{ code: "" }],
      },
    });
    expect(errorOf(emptyCode)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "not_absolute: source must be an absolute path",
      path: "/source",
    });
    const notAList = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [{ path: "/source", message: "not_absolute: source must be an absolute path" }],
        reasons: "unknown_key",
      },
    });
    expect(errorOf(notAList)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "not_absolute: source must be an absolute path",
      path: "/source",
    });
  });

  test("reasons without issues still reject with the reasons, and an empty list adds nothing", () => {
    const bare = wireError("jsonrpc.invalidParams", {
      details: { reasons: [{ code: "no_manifest" }] },
    });
    expect(errorOf(bare)).toEqual({
      kind: "rejected",
      code: -32602,
      reasons: [{ code: "no_manifest" }],
    });
    const empty = wireError("jsonrpc.invalidParams", {
      details: {
        issues: [
          { path: "/source", message: "no_manifest: .fresnel-plugin/plugin.json is missing" },
        ],
        reasons: [],
      },
    });
    expect(errorOf(empty)).toEqual({
      kind: "rejected",
      code: -32602,
      issue: "no_manifest: .fresnel-plugin/plugin.json is missing",
      path: "/source",
    });
  });
});
