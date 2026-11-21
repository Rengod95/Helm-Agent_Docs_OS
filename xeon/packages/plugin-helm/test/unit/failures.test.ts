import { expect, test } from "bun:test";
import { CapabilityError } from "@fresnel/contracts/capabilities";
import { PrimitiveError, type PrimitiveErrorCode } from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  failureOf,
  failureOfRefusal,
  failureOfTurn,
  type HelmFailure,
} from "../../src/failures.ts";

const TURN = fixedIdFactory(0).next("trn");

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
    ["registration_inactive", { kind: "disabled" }],
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

test("failureOfRefusal keeps the engine codes that Helm knows and names the rest", () => {
  expect(failureOfRefusal("state_conflict")).toEqual({ kind: "state_conflict" });
  expect(failureOfRefusal("state_too_large")).toEqual({ kind: "state_too_large" });
  expect(failureOfRefusal("storage_unavailable")).toEqual({ kind: "storage" });
  expect(failureOfRefusal("registration_inactive")).toEqual({ kind: "disabled" });
  expect(failureOfRefusal("depth_limit")).toEqual({ kind: "refused", code: "depth_limit" });
});

test("failureOfTurn makes a turn that did not complete a turn failure and lets a completed one pass", () => {
  expect(failureOfTurn({ turnId: TURN, status: "completed" }, "diverge")).toBeUndefined();
  expect(failureOfTurn({ turnId: TURN, status: "aborted" }, "apply")).toEqual({
    kind: "turn",
    phase: "apply",
    status: "aborted",
  });
  expect(failureOfTurn({ turnId: TURN, status: "error" }, "diverge")).toEqual({
    kind: "turn",
    phase: "diverge",
    status: "error",
  });
});
