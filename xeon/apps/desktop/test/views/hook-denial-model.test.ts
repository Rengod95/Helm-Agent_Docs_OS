import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@fresnel/contracts/conversation";
import { hookDenialOf } from "../../src/views/hook-denial-model.ts";

/** 엔진이 싣는 모양의 기본 details. 시험마다 바뀌는 칸만 덮는다 */
const details = (fields: JsonObject): JsonObject => ({
  code: "denied_by_extension",
  hook: "tool.call.before",
  extension: "guard",
  outcome: "blocked",
  reason: "no reads today",
  ...fields,
});

describe("hookDenialOf", () => {
  test("a blocked decision keeps its extension name and the hook's reason", () => {
    expect(hookDenialOf(details({}))).toEqual({
      outcome: "blocked",
      extension: "guard",
      reason: "no reads today",
    });
  });

  test("a threw outcome keeps the extension name and has no reason", () => {
    expect(hookDenialOf(details({ outcome: "threw", reason: null }))).toEqual({
      outcome: "threw",
      extension: "guard",
    });
  });

  test("a dispatcher failure has no extension name", () => {
    expect(hookDenialOf(details({ outcome: "threw", extension: null, reason: null }))).toEqual({
      outcome: "threw",
      extension: null,
    });
  });

  test("a blocked outcome without a string reason is not read as a hook denial", () => {
    expect(hookDenialOf(details({ reason: null }))).toBeNull();
  });

  test("an unknown outcome or another code is not a hook denial", () => {
    expect(hookDenialOf(details({ outcome: "unknown" }))).toBeNull();
    expect(hookDenialOf(details({ code: "denied_by_user" }))).toBeNull();
  });

  test("missing or non-object details are not a hook denial", () => {
    expect(hookDenialOf(undefined)).toBeNull();
    expect(hookDenialOf(null)).toBeNull();
    expect(hookDenialOf(["denied_by_extension"])).toBeNull();
  });

  test("a non-string extension name reads as no name", () => {
    expect(hookDenialOf(details({ extension: 7 }))).toEqual({
      outcome: "blocked",
      extension: null,
      reason: "no reads today",
    });
  });
});
