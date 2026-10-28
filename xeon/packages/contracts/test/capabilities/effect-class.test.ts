import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  COMMON_ERROR_CODES,
  DEFAULT_RETRYABLE,
  defineCapability,
  validateCapability,
  type AnyCapabilityDef,
  type CapabilityApi,
  type CapabilityIssue,
  type IdempotentCallOptions,
  type MethodDef,
} from "../../src/capabilities/index.ts";
import type { Equal, Expect } from "../types/expect.ts";
import { makeDef } from "./helpers.ts";

function withMethod(patch: Partial<MethodDef>): AnyCapabilityDef {
  const INPUT = Type.Object({ q: Type.String({ maxLength: 10 }) }, { additionalProperties: false });
  const OUTPUT = Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
  return {
    ...makeDef("web.one", []),
    service: { methods: { run: { description: "run", input: INPUT, output: OUTPUT, ...patch } } },
  };
}

function classIssues(def: AnyCapabilityDef): readonly (readonly [string, string])[] {
  return validateCapability(def).map((issue: CapabilityIssue) => [issue.severity, issue.code]);
}

describe("effect class declarations (ADR-0015 §3.3)", () => {
  test("a safe idempotent or readOnly method has no issue", () => {
    expect(classIssues(withMethod({ replay: "safe", idempotent: true }))).toEqual([]);
    expect(classIssues(withMethod({ replay: "safe", readOnly: true }))).toEqual([]);
  });

  test("idempotent without replay safe is an error, with unsafe too", () => {
    const path = "/service/methods/run/idempotent";
    expect(classIssues(withMethod({ idempotent: true }))).toEqual([
      ["error", "idempotent_replay_unsafe"],
    ]);
    const unsafe = validateCapability(withMethod({ replay: "unsafe", idempotent: true }));
    expect(unsafe.map((i) => [i.code, i.path])).toEqual([["idempotent_replay_unsafe", path]]);
  });

  test("readOnly without replay safe is an error", () => {
    expect(classIssues(withMethod({ replay: "unsafe", readOnly: true }))).toEqual([
      ["error", "read_only_replay_unsafe"],
    ]);
  });

  test("both marks is effect_class_conflict", () => {
    expect(classIssues(withMethod({ replay: "safe", idempotent: true, readOnly: true }))).toEqual([
      ["error", "effect_class_conflict"],
    ]);
  });

  test("a safe method without a mark is the effect_class_missing warning", () => {
    expect(classIssues(withMethod({ replay: "safe" }))).toEqual([
      ["warning", "effect_class_missing"],
    ]);
  });

  test("an unsafe method without a mark has no issue", () => {
    expect(classIssues(withMethod({ replay: "unsafe" }))).toEqual([]);
    expect(classIssues(withMethod({}))).toEqual([]);
  });
});

describe("effect_not_allowed", () => {
  test("is a common error code that is not retryable, placed before internal", () => {
    expect(COMMON_ERROR_CODES).toEqual([
      "invalid_input",
      "not_found",
      "unsupported",
      "unavailable",
      "denied",
      "rate_limited",
      "timeout",
      "upstream_error",
      "aborted",
      "effect_not_allowed",
      "internal",
    ]);
    expect(DEFAULT_RETRYABLE.effect_not_allowed).toBe(false);
  });

  test("a method cannot shadow it with its own error", () => {
    const def = withMethod({
      replay: "safe",
      readOnly: true,
      errors: { effect_not_allowed: { description: "x", retryable: false } },
    });
    expect(classIssues(def)).toEqual([["error", "error_code_shadow"]]);
  });
});

function makeProbe() {
  const input = Type.Object({ q: Type.String({ maxLength: 10 }) }, { additionalProperties: false });
  const output = Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
  return defineCapability({
    id: "web.probe",
    version: "1.0.0",
    description: "probe",
    service: {
      methods: {
        write: { description: "w", input, output, replay: "safe", idempotent: true },
        read: { description: "r", input, output, replay: "safe", readOnly: true },
      },
    },
    tools: [],
  });
}

test("call shapes: idempotent needs requestId, readOnly does not", () => {
  type ProbeApi = CapabilityApi<ReturnType<typeof makeProbe>>;
  type WriteOptions = Parameters<ProbeApi["write"]>[1];
  const sameOptions: Expect<Equal<WriteOptions, IdempotentCallOptions>> = true;
  const api: ProbeApi = {
    write: async () => ({ ok: true }),
    read: async () => ({ ok: true }),
  };
  void api.read({ q: "a" });
  void api.write({ q: "a" }, { requestId: "x:1" });
  // @ts-expect-error -- idempotent 메서드는 옵션 없이 부를 수 없다 (ADR-0015 §3.3 5)
  void api.write({ q: "a" });
  // @ts-expect-error -- requestId 없는 옵션도 거부된다
  void api.write({ q: "a" }, {});
  expect(sameOptions).toBe(true);
  expect(validateCapability(makeProbe())).toEqual([]);
});
