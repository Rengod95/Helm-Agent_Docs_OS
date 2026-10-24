import { Type, type TSchema } from "typebox";
import { parse } from "../../base/index.ts";
import { toJsonSchema } from "../../capabilities/index.ts";
import type { JsonObject, JsonValue } from "../../conversation/index.ts";

/**
 * 값 검사에 필요한 SettingDef의 부분. def.ts를 import하지 않아 순환이 없다(SettingDef가 이 모양을 만족한다).
 */
export interface ValueCheckedDef {
  readonly type: TSchema;
  readonly range?: {
    readonly min?: number;
    readonly max?: number;
    readonly enum?: readonly (string | number)[];
  };
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * def.type의 JSON Schema에 range를 합친 문서. 설정 파일 JSON Schema 출력(settingsJsonSchema)과
 * 값 검사(validateSettingValue)가 같은 문서를 쓰므로 두 결과가 같다(F.wire-settings.spec §4.10, §4.11).
 */
export function effectiveSchemaJson(def: ValueCheckedDef): JsonObject {
  const base = toJsonSchema(def.type);
  const merged: JsonObject = isRecord(base) ? { ...base } : {};
  const range = def.range;
  if (range !== undefined) {
    if (range.min !== undefined) merged["minimum"] = range.min;
    if (range.max !== undefined) merged["maximum"] = range.max;
    if (range.enum !== undefined) merged["enum"] = [...range.enum];
  }
  return merged;
}

const validators = new WeakMap<ValueCheckedDef, TSchema>();

function validatorSchema(def: ValueCheckedDef): TSchema {
  const cached = validators.get(def);
  if (cached !== undefined) return cached;
  const schema = Type.Unsafe(effectiveSchemaJson(def));
  validators.set(def, schema);
  return schema;
}

export type ValueIssue = { readonly path: string; readonly message: string };

/** 순수 함수. 값 하나를 def의 type과 range로 검사한다. JSON Schema 출력과 같은 검사다. */
export function validateSettingValue(
  def: ValueCheckedDef,
  value: unknown,
): { readonly ok: true } | { readonly ok: false; readonly issues: readonly ValueIssue[] } {
  const result = parse(validatorSchema(def), value);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
  };
}
