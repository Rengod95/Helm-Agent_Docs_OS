// 대리 등록이 자식의 JSON Schema 문서를 검증 스키마로 쓰는 자리(proxy-entry.ts의 schemaOfJson) 시험.
// 자식이 보낸 문서가 TypeBox 스키마의 원래 검사를 그대로 하는지, 객체가 아닌 문서를 거부하는지 본다.
import { expect, test } from "bun:test";
import { Type, type TSchema } from "typebox";
import { parse } from "@fresnel/contracts";
import { JsonValueSchema, type JsonValue } from "@fresnel/contracts/conversation";
import { schemaOfJson } from "../../src/isolation/proxy-entry.ts";

/** TypeBox 스키마를 JSON 왕복으로 자식의 문서 모양으로 만든다. 자식은 `toJsonValue`로 같은 일을 한다 */
function documentOf(schema: TSchema): JsonValue {
  const json = JSON.parse(JSON.stringify(schema));
  const parsed = parse(JsonValueSchema, json);
  if (!parsed.ok) throw new Error("the schema document is not JSON");
  return parsed.value;
}

function rebuiltOf(schema: TSchema): TSchema {
  const rebuilt = schemaOfJson(documentOf(schema));
  if (rebuilt === undefined) throw new Error("the document is not a schema object");
  return rebuilt;
}

test("a rebuilt object schema keeps the required fields, types and no-extra rule of the original", () => {
  const original = Type.Object(
    { count: Type.Number(), tags: Type.Array(Type.String()), note: Type.Optional(Type.String()) },
    { additionalProperties: false },
  );
  const rebuilt = rebuiltOf(original);
  expect(parse(rebuilt, { count: 1, tags: ["a"] }).ok).toBe(true);
  expect(parse(rebuilt, { count: 1, tags: ["a"], note: "x" }).ok).toBe(true);
  expect(parse(rebuilt, { count: "1", tags: [] }).ok).toBe(false);
  expect(parse(rebuilt, { tags: [] }).ok).toBe(false);
  expect(parse(rebuilt, { count: 1, tags: [], extra: true }).ok).toBe(false);
});

test("a rebuilt schema agrees with the original on the same values", () => {
  const original = Type.Object({ kind: Type.Literal("a"), n: Type.Integer({ minimum: 0 }) });
  const rebuilt = rebuiltOf(original);
  for (const value of [
    { kind: "a", n: 0 },
    { kind: "a", n: -1 },
    { kind: "b", n: 1 },
    { kind: "a", n: 1.5 },
  ]) {
    expect(parse(rebuilt, value).ok).toBe(parse(original, value).ok);
  }
});

test("a document that is not an object is not a schema", () => {
  expect(schemaOfJson("string")).toBeUndefined();
  expect(schemaOfJson(null)).toBeUndefined();
  expect(schemaOfJson([{ type: "object" }])).toBeUndefined();
});
