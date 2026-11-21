import type { TSchema } from "typebox";

/**
 * TypeBox 스키마 객체를 매니페스트에 싣는 JSON Schema 객체로 옮긴다. 최상위 키만 복사한다.
 * TypeBox의 종류 기호(symbol)는 JSON으로 가지 않으므로 그대로 두어도 된다(manifest.ts, methods.ts가 쓴다)
 */
export function jsonSchemaOf(schema: TSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = value;
  return out;
}
