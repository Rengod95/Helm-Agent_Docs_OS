import type { JsonObject, JsonValue } from "../../conversation/index.ts";
import type { SettingDef, SettingScope } from "./def.ts";
import type { SettingCatalog } from "./define.ts";
import { effectiveSchemaJson } from "./validate-value.ts";

export interface SettingsJsonSchemaOptions {
  /** 파일이 있는 범위 */
  readonly scope: Exclude<SettingScope, "session">;
  /** 기본 true(경고 표시용) */
  readonly includeDeprecated?: boolean;
}

export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

export const SETTINGS_JSON_SCHEMA_DIALECT: string = "https://json-schema.org/draft/2020-12/schema";

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 객체 키를 재귀적으로 정렬한다. 같은 입력이 바이트 단위로 같은 출력을 내게 한다. */
function sortObject(value: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const key of Object.keys(value).toSorted()) {
    const member = value[key];
    if (member !== undefined) out[key] = sortKeys(member);
  }
  return out;
}

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return (value as readonly JsonValue[]).map(sortKeys);
  return isObject(value) ? sortObject(value) : value;
}

/** unknown 값을 JSON 값으로 좁힌다. JSON으로 표현할 수 없으면 undefined. */
function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value as readonly unknown[]) {
      const converted = toJsonValue(item);
      if (converted === undefined) return undefined;
      items.push(converted);
    }
    return items;
  }
  if (typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, member] of Object.entries(value)) {
      const converted = toJsonValue(member);
      if (converted === undefined) return undefined;
      out[key] = converted;
    }
    return out;
  }
  return undefined;
}

function describeDeprecation(def: SettingDef): string {
  const deprecation = def.deprecated;
  if (deprecation === undefined) return "";
  const replacement =
    deprecation.replacedBy === undefined ? "" : ` Use ${deprecation.replacedBy} instead.`;
  const note = deprecation.note === undefined ? "" : ` ${deprecation.note}`;
  return `Deprecated since ${deprecation.since}.${replacement}${note}`;
}

function propertyOf(def: SettingDef): JsonObject {
  const property: JsonObject = effectiveSchemaJson(def);
  if (def.default !== undefined && def.secret !== true) {
    // default는 def.default가 있을 때만 싣는다. 비밀 키에는 default가 없다.
    const converted = toJsonValue(def.default);
    if (converted !== undefined) property["default"] = converted;
  }
  if (def.deprecated !== undefined) {
    property["deprecated"] = true;
    property["description"] = describeDeprecation(def);
  }
  const meta: JsonObject = {
    layer: def.layer,
    runtimeChange: def.runtimeChange,
    allowedScopes: [...def.allowedScopes],
    secret: def.secret === true,
    since: def.since,
  };
  if (def.ui !== undefined) meta["ui"] = { ...def.ui };
  property["x-xeon"] = meta;
  return property;
}

/**
 * 순수 함수. 카탈로그를 한 범위의 설정 파일 스키마(JSON Schema 2020-12)로 만든다.
 * 파일 모양은 평평한 객체이고 키는 전체 설정 키다. 그 범위가 allowedScopes에 없는 키는 properties에 넣지 않는다.
 * additionalProperties는 true다(모르는 키 보존, §4.8). 같은 입력이면 바이트 단위로 같은 출력을 낸다(키 정렬).
 */
export function settingsJsonSchema(
  catalog: SettingCatalog,
  options: SettingsJsonSchemaOptions,
): JsonSchemaDocument {
  const includeDeprecated = options.includeDeprecated ?? true;
  const properties: JsonObject = {};
  for (const [key, def] of catalog) {
    if (!def.allowedScopes.includes(options.scope)) continue;
    if (!includeDeprecated && def.deprecated !== undefined) continue;
    properties[key] = propertyOf(def);
  }
  const document: JsonObject = {
    $schema: SETTINGS_JSON_SCHEMA_DIALECT,
    type: "object",
    properties,
    additionalProperties: true,
    "x-xeon-unknownKeys": "warn",
  };
  return sortObject(document);
}
