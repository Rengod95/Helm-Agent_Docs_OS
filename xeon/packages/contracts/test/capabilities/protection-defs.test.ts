import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  ProtectInputSchema,
  ProtectOutputSchema,
  ProtectedListOutputSchema,
  WorkspaceProtection,
  WorkspaceProtectionKey,
  validateCapability,
  validateCapabilitySet,
  type AnyCapabilityDef,
} from "../../src/capabilities/index.ts";

// [제안, AGE-63] 기능 `workspace.protection`은 더하기만 한다. 이 시험은 모양을 값으로 고정한다:
// 메서드와 도구 이름, 도구 입력의 속성 목록(정확히 같아야 한다), 그리고 보호를 낮추는 길이 없다는 것.

const PROTECT = WorkspaceProtection.tools.find((tool) => tool.name === "sandbox_protect");
const LIST = WorkspaceProtection.tools.find((tool) => tool.name === "sandbox_protected");

/** 객체 스키마의 속성 이름과 추가 속성 허용 여부 */
function shapeOf(schema: unknown): { readonly properties: string[]; readonly additional: unknown } {
  if (typeof schema !== "object" || schema === null) throw new Error("schema is not an object");
  const additional = "additionalProperties" in schema ? schema.additionalProperties : undefined;
  const properties = "properties" in schema ? schema.properties : undefined;
  if (typeof properties !== "object" || properties === null) {
    return { properties: [], additional };
  }
  return { properties: Object.keys(properties).toSorted(), additional };
}

describe("workspace.protection definition", () => {
  test("validates with no issues, alone and in a set", () => {
    expect(validateCapability(WorkspaceProtection)).toEqual([]);
    expect(validateCapabilitySet([WorkspaceProtection] satisfies AnyCapabilityDef[])).toEqual([]);
  });

  test("id, version and key", () => {
    expect(WorkspaceProtection.id).toBe("workspace.protection");
    expect(WorkspaceProtection.version).toBe("1.0.0");
    expect(WorkspaceProtectionKey).toEqual({
      capability: "workspace.protection",
      version: "1.0.0",
    });
  });

  test("exactly two methods, protect and list, and no method that lowers protection", () => {
    expect(Object.keys(WorkspaceProtection.service.methods).toSorted()).toEqual([
      "list",
      "protect",
    ]);
    const names = Object.keys(WorkspaceProtection.service.methods).join(" ");
    for (const word of ["remove", "unprotect", "replace", "set", "clear", "reset", "delete"]) {
      expect(names.includes(word)).toBe(false);
    }
  });

  test("exactly two model tools, sandbox_protect and sandbox_protected", () => {
    expect(WorkspaceProtection.tools.map((tool) => tool.name)).toEqual([
      "sandbox_protect",
      "sandbox_protected",
    ]);
    expect(PROTECT?.method).toBe("protect");
    expect(LIST?.method).toBe("list");
  });

  test("the tool input of sandbox_protect has exactly the property paths, and no extra property", () => {
    const shape = shapeOf(PROTECT?.parameters);
    expect(shape.properties).toEqual(["paths"]);
    expect(shape.additional).toBe(false);
    expect(shapeOf(ProtectInputSchema)).toEqual(shape);
  });

  test("the tool input of sandbox_protected has no property and no extra property", () => {
    const shape = shapeOf(LIST?.parameters);
    expect(shape.properties).toEqual([]);
    expect(shape.additional).toBe(false);
  });

  test("paths holds 1 to 32 strings of at most 4096 characters, and the input rejects extra keys", () => {
    expect(parse(ProtectInputSchema, { paths: ["/tmp/a"] }).ok).toBe(true);
    expect(parse(ProtectInputSchema, { paths: [] }).ok).toBe(false);
    expect(parse(ProtectInputSchema, { paths: Array.from({ length: 33 }, () => "/a") }).ok).toBe(
      false,
    );
    expect(parse(ProtectInputSchema, { paths: ["x".repeat(4097)] }).ok).toBe(false);
    expect(parse(ProtectInputSchema, { paths: ["/a"], remove: ["/a"] }).ok).toBe(false);
    expect(parse(ProtectInputSchema, { paths: ["/a"], scope: "project" }).ok).toBe(false);
  });

  test("the outputs of both methods carry only their declared fields", () => {
    expect(
      parse(ProtectOutputSchema, {
        added: ["~/vault"],
        alreadyProtected: [],
        protected: ["~/vault"],
        effective: "next_shell_or_file_call",
      }).ok,
    ).toBe(true);
    expect(
      parse(ProtectOutputSchema, {
        added: [],
        alreadyProtected: [],
        protected: [],
        effective: "next_turn",
      }).ok,
    ).toBe(false);
    expect(
      parse(ProtectedListOutputSchema, {
        blocked: [{ path: "~/vault", origin: "user" }],
        suggested: [{ path: "~/.ssh", label: "SSH keys", blocked: false }],
      }).ok,
    ).toBe(true);
    expect(parse(ProtectedListOutputSchema, { blocked: [], suggested: [], extra: 1 }).ok).toBe(
      false,
    );
  });

  test("protect writes settings, so it has no read-only class; list is read only and replay safe", () => {
    const protect = WorkspaceProtection.service.methods.protect;
    const list = WorkspaceProtection.service.methods.list;
    expect(protect.readOnly).toBeUndefined();
    expect(protect.idempotent).toBeUndefined();
    expect(list.readOnly).toBe(true);
    expect(list.replay).toBe("safe");
  });

  test("both tools are sequential-safe and advertise their hints", () => {
    expect(PROTECT?.executionMode).toBe("sequential");
    expect(PROTECT?.hints).toEqual({
      readOnly: false,
      destructive: false,
      idempotent: true,
      openWorld: false,
    });
    expect(LIST?.hints?.readOnly).toBe(true);
  });
});
