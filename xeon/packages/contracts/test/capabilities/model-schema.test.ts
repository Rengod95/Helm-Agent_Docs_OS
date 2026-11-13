import { describe, expect, test } from "bun:test";
import { Type, type TSchema } from "typebox";
import type { JsonValue } from "../../src/conversation/index.ts";
import {
  modelSchemaScope,
  modelWire,
  toJsonSchema,
  toModelSchema,
  type OrderedTool,
} from "../../src/capabilities/index.ts";

// F.capabilities.spec §4.3 모델이 보는 구조. anyOf-const는 enum으로, 내장 도구는 검증 키워드도 뺀다.

function rewrap(json: JsonValue): TSchema {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("expected an object schema");
  }
  return Type.Unsafe(json);
}

const STATUS = Type.Union([Type.Literal("pending"), Type.Literal("done")]);

describe("toModelSchema", () => {
  test("anyOf of consts becomes an enum with the shared type", () => {
    const json = toModelSchema(Type.Object({ status: STATUS }), "external");
    expect(json).toEqual({
      type: "object",
      required: ["status"],
      properties: { status: { type: "string", enum: ["pending", "done"] } },
    });
  });

  test("anyOf with a non-const member is left as it is", () => {
    const schema = Type.Object({ v: Type.Union([Type.Literal("a"), Type.Null()]) });
    const json = toModelSchema(schema, "external");
    expect(json).toEqual(toJsonSchema(schema));
    const mixed = Type.Object({
      v: Type.Union([Type.Literal("a"), Type.String({ minLength: 2 })]),
    });
    expect(toModelSchema(mixed, "external")).toEqual(toJsonSchema(mixed));
  });

  test("builtin scope removes the validation keywords everywhere", () => {
    const schema = Type.Object({
      text: Type.String({ minLength: 1, maxLength: 5, pattern: "^a", description: "Body" }),
      n: Type.Integer({ minimum: 1, maximum: 9, default: 3 }),
      when: Type.String({ format: "date-time" }),
      list: Type.Array(Type.String({ maxLength: 2 }), { minItems: 1, maxItems: 4 }),
    });
    expect(toModelSchema(schema, "builtin")).toEqual({
      type: "object",
      required: ["text", "n", "when", "list"],
      properties: {
        text: { type: "string", description: "Body" },
        n: { type: "integer", default: 3 },
        when: { type: "string" },
        list: { type: "array", items: { type: "string" } },
      },
    });
  });

  test("a property named like a keyword stays", () => {
    const schema = Type.Object({
      pattern: Type.String({ maxLength: 3 }),
      format: Type.Optional(Type.String()),
      minimum: Type.Optional(Type.Integer({ minimum: 0 })),
    });
    const json = toModelSchema(schema, "builtin");
    expect(json).toEqual({
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string" },
        format: { type: "string" },
        minimum: { type: "integer" },
      },
    });
  });

  test("external scope keeps the limits", () => {
    const schema = Type.Object({ q: Type.String({ minLength: 1, maxLength: 9, pattern: "^a" }) });
    expect(toModelSchema(schema, "external")).toEqual(toJsonSchema(schema));
  });

  test("the transform is idempotent and the definition is not mutated", () => {
    const schema = Type.Object({ s: STATUS, t: Type.String({ maxLength: 4 }) });
    const once = toModelSchema(schema, "builtin");
    expect(toModelSchema(rewrap(once), "builtin")).toEqual(once);
    expect(toJsonSchema(schema)).toMatchObject({
      properties: { t: { maxLength: 4 }, s: { anyOf: expect.any(Array) } },
    });
  });

  test("enum and const values that look like keywords are not rewritten", () => {
    const schema = Type.Object({
      k: Type.Union([Type.Literal("minLength"), Type.Literal("pattern")]),
    });
    expect(toModelSchema(schema, "builtin")).toMatchObject({
      properties: { k: { enum: ["minLength", "pattern"] } },
    });
  });
});

const wire = (capability: string): OrderedTool => ({
  capability,
  name: "t",
  wire: {
    name: "t",
    description: "d",
    parameters: Type.Object({ q: Type.String({ maxLength: 9 }) }),
  },
});

describe("modelSchemaScope and modelWire", () => {
  test("only extension, group and dynamic MCP server tools are external", () => {
    expect(modelSchemaScope("core.tools")).toBe("builtin");
    expect(modelSchemaScope("workspace.files")).toBe("builtin");
    expect(modelSchemaScope("mcp.client")).toBe("builtin");
    expect(modelSchemaScope("mcp.github")).toBe("external");
    expect(modelSchemaScope("ext.my-ext")).toBe("external");
    expect(modelSchemaScope("grp.learning")).toBe("external");
    expect(modelSchemaScope("x.thing")).toBe("external");
    expect(modelSchemaScope("")).toBe("external");
  });

  test("modelWire picks the scope from the capability", () => {
    expect(modelWire(wire("workspace.files")).parameters).toMatchObject({
      properties: { q: { type: "string" } },
    });
    expect(JSON.stringify(modelWire(wire("workspace.files")).parameters)).not.toContain(
      "maxLength",
    );
    expect(JSON.stringify(modelWire(wire("mcp.github")).parameters)).toContain("maxLength");
  });
});
