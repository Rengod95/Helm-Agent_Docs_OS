import { expect, test } from "bun:test";
import { CapabilityError } from "@xeon/contracts/capabilities";
import { PrimitiveError, type PrimitiveErrorCode } from "@xeon/ext-host";
import { failureOf, type HelmFailure } from "../../src/failures.ts";

const capability = (code: string): CapabilityError =>
  new CapabilityError({
    capability: "web.search",
    method: "search",
    code,
    message: code,
    retryable: false,
  });

function primitive(code: PrimitiveErrorCode): PrimitiveError {
  return new PrimitiveError(code, code);
}

test("failureOf maps primitive errors to Helm failures", () => {
  const cases: readonly (readonly [PrimitiveErrorCode, HelmFailure | undefined])[] = [
    ["lease_inactive", { kind: "lease_lost" }],
    ["lease_revoked", { kind: "lease_lost" }],
    ["handler_aborted", { kind: "lease_lost" }],
    ["lease_budget", { kind: "budget", limit: "spawns" }],
    ["state_conflict", { kind: "state_conflict" }],
    ["state_too_large", { kind: "state_too_large" }],
    ["storage_unavailable", { kind: "storage" }],
    ["scope_inactive", { kind: "disabled" }],
    ["record_invalid", undefined],
    ["post_undeclared", undefined],
    ["state_schema", undefined],
  ];
  for (const [code, expected] of cases) {
    expect({ code, failure: failureOf(primitive(code), { limit: "spawns" }) }).toEqual({
      code,
      failure: expected,
    });
  }
  expect(failureOf(primitive("capability_unavailable"), {})).toBeUndefined();
  expect(failureOf(primitive("capability_unavailable"), { capability: "web.search" })).toEqual({
    kind: "capability",
    capability: "web.search",
    code: "unavailable",
  });
});

test("failureOf maps capability errors and aborts, and leaves unknown errors alone", () => {
  expect(failureOf(capability("effect_not_allowed"), {})).toEqual({
    kind: "capability",
    capability: "web.search",
    code: "effect_not_allowed",
  });
  expect(failureOf(capability("query_rejected"), {})).toEqual({
    kind: "capability",
    capability: "web.search",
    code: "internal",
  });
  expect(failureOf(capability("aborted"), {})).toEqual({ kind: "lease_lost" });
  expect(failureOf(new DOMException("x", "AbortError"), {})).toEqual({ kind: "lease_lost" });
  expect(failureOf(new TypeError("boom"), {})).toBeUndefined();
  expect(failureOf("text", {})).toBeUndefined();
  expect(failureOf(undefined, {})).toBeUndefined();
});
