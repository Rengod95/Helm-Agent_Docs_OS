import { expect, test } from "bun:test";
import * as capabilities from "@xeon/contracts/capabilities";
import { capabilityEffectOf } from "@xeon/contracts/extensions";
import { BUILTIN_CAPABILITY_DEFS, capabilityDefsOf } from "../../src/assembly/capability-defs.ts";

// 능력 래퍼가 읽는 내장 정의 표(X.primitives.spec §4.4.7)가 contracts가 내보내는 능력 정의를 빠짐없이 담는다.

function defIdOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("id" in value) || !("service" in value) || !("tools" in value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

test("the table holds every capability definition that contracts exports", () => {
  const exported: string[] = [];
  for (const value of Object.values(capabilities)) {
    const id = defIdOf(value);
    if (id !== undefined) exported.push(id);
  }
  expect(exported.length).toBeGreaterThan(0);
  const listed: string[] = BUILTIN_CAPABILITY_DEFS.map((def) => def.id);
  expect(listed.toSorted((a, b) => a.localeCompare(b))).toEqual(
    exported.toSorted((a, b) => a.localeCompare(b)),
  );
});

test("lookup finds a built-in definition and an extra one, and returns nothing for an unknown id", () => {
  const lookup = capabilityDefsOf();
  expect(lookup("workspace.files")?.id).toBe("workspace.files");
  expect(lookup("demo.unknown")).toBeUndefined();
  const [any] = BUILTIN_CAPABILITY_DEFS;
  if (any === undefined) throw new Error("no built-in definitions");
  const extended = capabilityDefsOf([{ ...any, id: "demo.extra" }]);
  expect(extended("demo.extra")?.id).toBe("demo.extra");
});

test("classification state of the built-in methods is visible to the wrapper", () => {
  // 분류(idempotent·readOnly)는 L2 정의 쪽 작업이다. 표가 정의 원본을 그대로 넘기므로 분류가 더해지면 래퍼가 바로 읽는다
  const lookup = capabilityDefsOf();
  const method = lookup("workspace.files")?.service.methods["read"];
  expect(method).toBeDefined();
  const effect = method === undefined ? undefined : capabilityEffectOf(method);
  expect(effect ?? "none").toMatch(/^capability\./);
});
