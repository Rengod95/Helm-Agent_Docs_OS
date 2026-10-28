import { describe, expect, test } from "bun:test";
import { Type, type TSchema } from "typebox";
import {
  validateCapability,
  validateCapabilitySet,
  type AnyCapabilityDef,
  type CapabilityIssue,
} from "../../src/capabilities/index.ts";
import { WebSearch } from "./fixtures/web-search.ts";
import { loose, makeDef } from "./helpers.ts";

function find(issues: readonly CapabilityIssue[], code: string): CapabilityIssue | undefined {
  return issues.find((issue) => issue.code === code);
}

function withTool(
  def: AnyCapabilityDef,
  patch: Partial<AnyCapabilityDef["tools"][number]>,
): AnyCapabilityDef {
  const [first, ...rest] = def.tools;
  if (first === undefined) throw new Error("fixture has no tool");
  return { ...def, tools: [{ ...first, ...patch }, ...rest] };
}

describe("web.search fixture", () => {
  test("has no issues", () => {
    expect(validateCapability(WebSearch)).toEqual([]);
  });
});

describe("methods", () => {
  test("method_missing for an unknown method (JS plugins skip the type checker)", () => {
    const issues = validateCapability(withTool(makeDef("web.one", ["a"]), { method: "nope" }));
    expect(find(issues, "method_missing")?.path).toBe("/tools/0/method");
  });

  test("method name, input root and error codes", () => {
    const base = makeDef("web.one", []);
    const bad: AnyCapabilityDef = {
      ...base,
      service: {
        methods: {
          Bad_Name: {
            description: "x",
            input: Type.String({ maxLength: 4 }),
            output: Type.Object({}, { additionalProperties: false }),
            errors: {
              Bad: { description: "x", retryable: false },
              timeout: { description: "x", retryable: true },
              mine: { description: "x", retryable: false },
            },
          },
        },
      },
    };
    const issues = validateCapability(bad);
    expect(find(issues, "method_name_invalid")).toBeDefined();
    expect(find(issues, "method_input_not_object")).toBeDefined();
    expect(issues.filter((i) => i.code === "error_code_invalid").length).toBe(1);
    expect(issues.filter((i) => i.code === "error_code_shadow").length).toBe(1);
  });
});

describe("tool names", () => {
  test("duplicate tool names in one definition", () => {
    const issues = validateCapability(makeDef("web.one", ["a_tool", "a_tool"]));
    expect(find(issues, "tool_name_duplicate")?.path).toBe("/tools/1/name");
  });

  test("provider-invalid names are errors", () => {
    expect(
      find(validateCapability(makeDef("web.one", ["web:search"])), "tool_name_invalid")?.severity,
    ).toBe("error");
    expect(
      find(validateCapability(makeDef("web.one", ["a".repeat(65)])), "tool_name_invalid"),
    ).toBeDefined();
  });

  test("style warning for builtin tools only", () => {
    for (const style of ["WebSearch", "web-search"]) {
      const found = find(validateCapability(makeDef("web.one", [style])), "tool_name_style");
      expect(found?.severity).toBe("warning");
    }
    expect(validateCapability(makeDef("web.one", ["web-exa__search"]))).toEqual([]);
  });

  test("label length", () => {
    const base = makeDef("web.one", ["a"]);
    expect(
      find(validateCapability(withTool(base, { label: "" })), "tool_label_invalid"),
    ).toBeDefined();
    expect(
      find(validateCapability(withTool(base, { label: "x".repeat(65) })), "tool_label_invalid"),
    ).toBeDefined();
    expect(
      find(validateCapability(withTool(base, { label: "x".repeat(64) })), "tool_label_invalid"),
    ).toBeUndefined();
  });

  test("description limits", () => {
    const base = makeDef("web.one", ["a"]);
    const long = find(
      validateCapability(withTool(base, { description: "x".repeat(2000) })),
      "description_too_long",
    );
    expect(long?.severity).toBe("warning");
    const huge = find(
      validateCapability(withTool(base, { description: "x".repeat(5000) })),
      "description_too_long",
    );
    expect(huge?.severity).toBe("error");
    expect(
      find(validateCapability(withTool(base, { description: " " })), "description_empty"),
    ).toBeDefined();
  });
});

describe("tool ↔ method mapping", () => {
  test("parameters that differ from the method input need toInput", () => {
    const other = Type.Object(
      { other: Type.String({ maxLength: 4 }) },
      { additionalProperties: false },
    );
    const base = makeDef("web.one", ["a"]);
    const mismatch = validateCapability(withTool(base, { parameters: other }));
    expect(find(mismatch, "tool_input_mismatch")).toBeDefined();
    const mapped = validateCapability(
      withTool(base, { parameters: other, toInput: () => ({ q: "x" }) }),
    );
    expect(find(mapped, "tool_input_mismatch")).toBeUndefined();
  });

  test("a safe tool over an unsafe or unspecified method is replay_widened", () => {
    const base = makeDef("web.one", ["a"]);
    const unsafeMethod: AnyCapabilityDef = {
      ...base,
      service: {
        methods: {
          run: {
            ...(base.service.methods["run"] ?? {
              description: "",
              input: Type.Object({}),
              output: Type.Object({}),
            }),
            replay: "unsafe",
          },
        },
      },
    };
    expect(
      find(validateCapability(withTool(unsafeMethod, { replay: "safe" })), "replay_widened"),
    ).toBeDefined();
    const unspecified: AnyCapabilityDef = {
      ...base,
      service: {
        methods: {
          run: {
            description: "x",
            input: Type.Object(
              { q: Type.String({ maxLength: 10 }) },
              { additionalProperties: false },
            ),
            output: Type.Object({}, { additionalProperties: false }),
          },
        },
      },
    };
    expect(
      find(validateCapability(withTool(unspecified, { replay: "safe" })), "replay_widened"),
    ).toBeDefined();
    expect(
      find(validateCapability(withTool(base, { replay: "safe" })), "replay_widened"),
    ).toBeUndefined();
  });

  test("non-object parameters", () => {
    const issues = validateCapability(
      withTool(makeDef("web.one", ["a"]), {
        parameters: Type.String({ maxLength: 3 }),
        toInput: () => ({ q: "x" }),
      }),
    );
    expect(find(issues, "parameters_not_object")).toBeDefined();
  });
});

function nested(depth: number): TSchema {
  let schema: TSchema = Type.String({ maxLength: 3 });
  for (let i = 0; i < depth; i += 1) {
    schema = Type.Object({ child: schema }, { additionalProperties: false });
  }
  return schema;
}

function tool(parameters: TSchema): AnyCapabilityDef {
  return withTool(makeDef("web.one", ["a"]), { parameters, toInput: () => ({ q: "x" }) });
}

describe("schema limits", () => {
  test("33 KiB parameters are too large, small ones are fine", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [
        `field_${i}`,
        Type.String({ description: "x".repeat(100), maxLength: 5 }),
      ]),
    );
    const big = Type.Object(fields, { additionalProperties: false });
    expect(find(validateCapability(tool(big)), "schema_too_large")).toBeDefined();
    expect(find(validateCapability(tool(nested(2))), "schema_too_large")).toBeUndefined();
  });

  test("depth 13 is too deep, depth 12 is fine", () => {
    expect(find(validateCapability(tool(nested(12))), "schema_too_deep")).toBeDefined();
    expect(find(validateCapability(tool(nested(10))), "schema_too_deep")).toBeUndefined();
  });

  test("external $ref is an error, internal $defs ref is not", () => {
    const external = Type.Object(
      { a: Type.Ref("https://example.com/schema.json") },
      { additionalProperties: false },
    );
    expect(find(validateCapability(tool(external)), "schema_ref_external")).toBeDefined();
  });

  test("Type.Cyclic warns schema_cyclic and keeps refs inside the document", () => {
    const cyclic = Type.Cyclic(
      {
        Node: Type.Object(
          { next: Type.Optional(Type.Ref("Node")) },
          { additionalProperties: false },
        ),
      },
      "Node",
    );
    const issues = validateCapability(tool(cyclic));
    expect(find(issues, "schema_cyclic")?.severity).toBe("warning");
    expect(find(issues, "schema_ref_external")).toBeUndefined();
  });

  test("Type.Refine warns schema_refine_dropped", () => {
    const refined = Type.Refine(
      Type.Object({ q: Type.String({ maxLength: 4 }) }, { additionalProperties: false }),
      (value: { q: string }) => value.q.length > 0,
    );
    expect(find(validateCapability(tool(refined)), "schema_refine_dropped")?.severity).toBe(
      "warning",
    );
  });
});

describe("requires", () => {
  test("invalid and self references", () => {
    const base = makeDef("web.one", []);
    const bad = loose(base, { requires: ["web.one", "nope"] });
    const found = validateCapability(bad).map((i) => i.code);
    expect(found).toContain("requires_self");
    expect(found).toContain("requires_invalid");
  });
});

describe("validateCapabilitySet", () => {
  test("two capabilities with the same tool name conflict, same id duplicates", () => {
    const a = makeDef("web.one", ["shared"]);
    const b = makeDef("web.two", ["shared"]);
    expect(validateCapabilitySet([a, b]).map((i) => i.code)).toEqual(["tool_name_conflict"]);
    expect(validateCapabilitySet([a, a]).map((i) => i.code)).toContain("capability_duplicate");
  });

  test("unresolved requires is a warning", () => {
    const a: AnyCapabilityDef = { ...makeDef("web.one", []), requires: ["web.missing"] };
    const issues = validateCapabilitySet([a]);
    expect(issues[0]?.code).toBe("requires_unresolved");
    expect(issues[0]?.severity).toBe("warning");
    expect(validateCapabilitySet([a, makeDef("web.missing", [])])).toEqual([]);
  });
});

describe("capabilities without tools (M3-REQ-07)", () => {
  test("tools: [] is valid and only a service-less definition is rejected", () => {
    const noTools = makeDef("knowledge.write", []);
    expect(noTools.tools).toEqual([]);
    expect(validateCapability(noTools)).toEqual([]);
    const noMethods: AnyCapabilityDef = { ...noTools, service: { methods: {} } };
    expect(validateCapability(noMethods).map((i) => i.code)).toEqual(["service_empty"]);
  });
});
