import { describe, expect, test } from "bun:test";
import { Type, type TSchema } from "typebox";
import type { JsonValue } from "../../src/conversation/index.ts";
import { Value } from "typebox/value";
import { toJsonSchema, validateCapability } from "../../src/capabilities/index.ts";
import { WebSearchInput } from "./fixtures/web-search.ts";
import { makeDef } from "./helpers.ts";

/** toJsonSchema 결과를 다시 TypeBox 검사기에 넘기기 위해 감싼다 */
function rewrap(json: JsonValue): TSchema {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error("expected an object schema");
  }
  return Type.Unsafe(json);
}

function hasTildeKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    const list: readonly unknown[] = value;
    return list.some(hasTildeKey);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, member]) => key.startsWith("~") || hasTildeKey(member),
    );
  }
  return false;
}

describe("toJsonSchema", () => {
  test("object params emit plain 2020-12 JSON", () => {
    const json = toJsonSchema(WebSearchInput);
    expect(typeof json).toBe("object");
    expect(hasTildeKey(json)).toBe(false);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(json).toMatchObject({ type: "object" });
    expect(JSON.stringify(json)).not.toContain("$schema");
  });

  test("functions, RegExp and undefined are dropped", () => {
    const schema = Type.Object({ a: Type.String({ maxLength: 3 }) });
    const dirty: Record<string, unknown> = {
      ...schema,
      fn: () => 1,
      re: /x/,
      missing: undefined,
      $schema: "https://json-schema.org/draft/2020-12/schema",
    };
    const json = toJsonSchema(Type.Unsafe(dirty));
    expect(json).toEqual({
      type: "object",
      required: ["a"],
      properties: { a: { type: "string", maxLength: 3 } },
    });
  });

  test("Cyclic refs are rewritten to #/$defs/…", () => {
    const cyclic = Type.Cyclic(
      {
        Node: Type.Object(
          { next: Type.Optional(Type.Ref("Node")) },
          { additionalProperties: false },
        ),
      },
      "Node",
    );
    const text = JSON.stringify(toJsonSchema(cyclic));
    expect(text).toContain('"$ref":"#/$defs/Node"');
    expect(text).not.toContain('"$ref":"Node"');
  });

  const samples: readonly unknown[] = [
    { query: "ok" },
    { query: "" },
    { query: "x".repeat(512) },
    { query: "x".repeat(513) },
    { query: "q", limit: 1 },
    { query: "q", limit: 0 },
    { query: "q", limit: 21 },
    { query: "q", limit: 2.5 },
    { query: "q", recency: "day" },
    { query: "q", recency: "decade" },
    { query: "q", domains: { allow: ["a.com"] } },
    { query: "q", domains: { allow: Array.from({ length: 21 }, () => "a") } },
    { query: "q", domains: { deny: [] } },
    { query: "q", content: "full" },
    { query: "q", content: 3 },
    { query: "q", unknown: 1 },
    {},
    [],
    null,
    "query",
  ];

  test("lossless against Value.Check on sample inputs", () => {
    const rewrapped = rewrap(toJsonSchema(WebSearchInput));
    for (const sample of samples) {
      expect(Value.Check(rewrapped, sample)).toBe(Value.Check(WebSearchInput, sample));
    }
  });

  test("Type.Refine schemas keep working at runtime and are flagged for the model", () => {
    const refined = Type.Refine(
      Type.Object({ q: Type.String({ maxLength: 10 }) }, { additionalProperties: false }),
      (value: { q: string }) => value.q !== "bad",
    );
    expect(Value.Check(refined, { q: "bad" })).toBe(false);
    const base = makeDef("web.one", ["a"]);
    const [first] = base.tools;
    if (first === undefined) throw new Error("fixture has no tool");
    const def = {
      ...base,
      tools: [{ ...first, parameters: refined, toInput: () => ({ q: "x" }) }],
    };
    expect(validateCapability(def).map((i) => i.code)).toContain("schema_refine_dropped");
  });
});
