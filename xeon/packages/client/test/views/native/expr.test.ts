import { describe, expect, test } from "bun:test";
import type { UiCondition } from "@fresnel/contracts/extensions";
import { evalCondition } from "../../../src/views/native/expr.ts";
import { createScope, withLocal } from "../../../src/views/native/scope.ts";

const SCOPE = createScope({
  status: { phase: "diverge", inquiryId: null, lease: "held", findings: 3 },
  flag: false,
  zero: 0,
  empty: "",
  list: [1],
});

interface Case {
  readonly name: string;
  readonly condition: UiCondition;
  readonly expected: boolean;
}

const CASES: readonly Case[] = [
  {
    name: "eq matches an equal string",
    condition: { path: "/status/phase", op: "eq", value: "diverge" },
    expected: true,
  },
  {
    name: "eq rejects a different string",
    condition: { path: "/status/phase", op: "eq", value: "idle" },
    expected: false,
  },
  {
    name: "ne is the negation of eq",
    condition: { path: "/status/phase", op: "ne", value: "idle" },
    expected: true,
  },
  {
    name: "ne is false for an equal value",
    condition: { path: "/status/phase", op: "ne", value: "diverge" },
    expected: false,
  },
  {
    name: "eq null matches a present null",
    condition: { path: "/status/inquiryId", op: "eq", value: null },
    expected: true,
  },
  {
    name: "ne null is false for a present null",
    condition: { path: "/status/inquiryId", op: "ne", value: null },
    expected: false,
  },
  {
    name: "eq null is false for a missing path",
    condition: { path: "/status/missing", op: "eq", value: null },
    expected: false,
  },
  {
    name: "ne null is true for a missing path",
    condition: { path: "/status/missing", op: "ne", value: null },
    expected: true,
  },
  {
    name: "eq is false for a missing path",
    condition: { path: "/nothing", op: "eq", value: "x" },
    expected: false,
  },
  {
    name: "ne is true for a missing path",
    condition: { path: "/nothing", op: "ne", value: "x" },
    expected: true,
  },
  {
    name: "eq false matches a present false",
    condition: { path: "/flag", op: "eq", value: false },
    expected: true,
  },
  { name: "eq 0 matches 0", condition: { path: "/zero", op: "eq", value: 0 }, expected: true },
  {
    name: "eq is strict: 0 is not the string 0",
    condition: { path: "/zero", op: "eq", value: "0" },
    expected: false,
  },
  {
    name: "eq is strict: empty string is not 0",
    condition: { path: "/empty", op: "eq", value: 0 },
    expected: false,
  },
  {
    name: "eq matches the empty string",
    condition: { path: "/empty", op: "eq", value: "" },
    expected: true,
  },
  {
    name: "an object never equals a scalar",
    condition: { path: "/status", op: "eq", value: "diverge" },
    expected: false,
  },
  {
    name: "ne on an object is true",
    condition: { path: "/status", op: "ne", value: "diverge" },
    expected: true,
  },
  {
    name: "eq with no value matches nothing present",
    condition: { path: "/status/phase", op: "eq" },
    expected: false,
  },
  {
    name: "eq reads an array index",
    condition: { path: "/list/0", op: "eq", value: 1 },
    expected: true,
  },
  {
    name: "exists is true for a string",
    condition: { path: "/status/phase", op: "exists" },
    expected: true,
  },
  { name: "exists is true for false", condition: { path: "/flag", op: "exists" }, expected: true },
  {
    name: "exists is true for 0 and the empty string",
    condition: { path: "/zero", op: "exists" },
    expected: true,
  },
  {
    name: "exists is false for null",
    condition: { path: "/status/inquiryId", op: "exists" },
    expected: false,
  },
  {
    name: "exists is false for a missing path",
    condition: { path: "/status/missing", op: "exists" },
    expected: false,
  },
  {
    name: "missing is false for a string",
    condition: { path: "/status/phase", op: "missing" },
    expected: false,
  },
  {
    name: "missing is true for null",
    condition: { path: "/status/inquiryId", op: "missing" },
    expected: true,
  },
  {
    name: "missing is true for a missing path",
    condition: { path: "/status/missing", op: "missing" },
    expected: true,
  },
  {
    name: "a malformed pointer is a missing path",
    condition: { path: "status/phase", op: "exists" },
    expected: false,
  },
  {
    name: "a malformed pointer makes eq false and ne true",
    condition: { path: "status/phase", op: "ne", value: "x" },
    expected: true,
  },
];

describe("evalCondition", () => {
  for (const item of CASES) {
    test(item.name, () => {
      expect(evalCondition(item.condition, SCOPE)).toEqual(item.expected);
    });
  }

  test("a local name is read before the document", () => {
    const scope = withLocal(createScope({ item: { status: "old" } }), "item", { status: "new" });
    expect(evalCondition({ path: "/item/status", op: "eq", value: "new" }, scope)).toEqual(true);
    expect(evalCondition({ path: "/item/status", op: "eq", value: "old" }, scope)).toEqual(false);
  });
});
