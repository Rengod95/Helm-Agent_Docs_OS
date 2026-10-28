import { Type, type TSchema } from "typebox";
import {
  toJsonSchema,
  type AnyCapabilityDef,
  type CapabilityId,
} from "../../src/capabilities/index.ts";

/** 메서드 하나(run)와 지정한 이름의 도구들을 가진 최소 능력 정의 */
export function makeDef(id: CapabilityId, toolNames: readonly string[]): AnyCapabilityDef {
  const input = Type.Object({ q: Type.String({ maxLength: 10 }) }, { additionalProperties: false });
  const output = Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
  return {
    id,
    version: "1.0.0",
    description: `capability ${id}`,
    service: {
      methods: { run: { description: "run", input, output, replay: "safe", readOnly: true } },
    },
    tools: toolNames.map((name) => ({
      name,
      label: name,
      description: `tool ${name}`,
      method: "run",
      parameters: input,
    })),
  };
}

export function permutations<T>(items: readonly T[]): readonly (readonly T[])[] {
  if (items.length <= 1) return [items];
  const result: (readonly T[])[] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

/**
 * 타입 검사를 거치지 않은 정의(JS 플러그인, 와이어)를 흉내 낸다. 필드를 덮어쓴 뒤 JSON 왕복을 거치므로
 * 함수 필드(toInput, toContent)는 사라진다. 형식이 틀린 id·version·requires를 만들 때만 쓴다.
 */
export function loose(
  def: AnyCapabilityDef,
  patch: Readonly<Record<string, unknown>>,
): AnyCapabilityDef {
  const copy: AnyCapabilityDef = JSON.parse(JSON.stringify({ ...def, ...patch }));
  return copy;
}

/** 객체 스키마의 최상위 속성 이름. 스키마가 Type.Unsafe로 감싸여 있어도 JSON Schema 쪽을 읽는다 */
export function propertyNames(schema: TSchema): readonly string[] {
  const json: unknown = toJsonSchema(schema);
  if (typeof json !== "object" || json === null) return [];
  const properties: unknown = Reflect.get(json, "properties");
  if (typeof properties !== "object" || properties === null) return [];
  return Object.keys(properties);
}
