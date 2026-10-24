import { canonicalJson } from "@xeon/contracts";
import { MAX_PARAMETERS_BYTES, MAX_SCHEMA_DEPTH } from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import { asJsonObject } from "../json.ts";

// L2.mcp.spec §3.3. 서버가 광고한 `inputSchema`를 노출해도 되는지 본다. 한도는 F.capabilities.spec §4.3의 상수를 쓴다.
// 문제가 있으면 도구를 노출하지 않고 `hiddenReason: "schema_invalid"`로 둔다.

const CHILD_KEYS_MAP = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
] as const;
const CHILD_KEYS_SINGLE = [
  "additionalProperties",
  "items",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedProperties",
  "unevaluatedItems",
] as const;
const CHILD_KEYS_LIST = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

function children(
  node: Readonly<Record<string, JsonValue>>,
): readonly Readonly<Record<string, JsonValue>>[] {
  const out: Readonly<Record<string, JsonValue>>[] = [];
  for (const key of CHILD_KEYS_MAP) {
    const table = asJsonObject(node[key]);
    if (table === undefined) continue;
    for (const value of Object.values(table)) {
      const child = asJsonObject(value);
      if (child !== undefined) out.push(child);
    }
  }
  for (const key of CHILD_KEYS_SINGLE) {
    const value = node[key];
    const child = asJsonObject(value);
    if (child !== undefined) out.push(child);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        const item = asJsonObject(entry);
        if (item !== undefined) out.push(item);
      }
    }
  }
  for (const key of CHILD_KEYS_LIST) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const item = asJsonObject(entry);
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

function depthOf(node: Readonly<Record<string, JsonValue>>): number {
  let deepest = 0;
  for (const child of children(node)) deepest = Math.max(deepest, depthOf(child));
  return deepest + 1;
}

function externalRef(node: Readonly<Record<string, JsonValue>>): boolean {
  const ref = node["$ref"];
  if (
    typeof ref === "string" &&
    !ref.startsWith("#/$defs/") &&
    !ref.startsWith("#/definitions/") &&
    ref !== "#"
  ) {
    return true;
  }
  return children(node).some(externalRef);
}

export type SchemaProblem = "not_object_schema" | "external_ref" | "too_deep" | "too_large";

/** 노출해도 되는 스키마면 undefined, 아니면 이유 */
export function schemaProblem(schema: JsonValue): SchemaProblem | undefined {
  const root = asJsonObject(schema);
  if (root === undefined || root["type"] !== "object") return "not_object_schema";
  if (externalRef(root)) return "external_ref";
  if (depthOf(root) > MAX_SCHEMA_DEPTH) return "too_deep";
  if (new TextEncoder().encode(canonicalJson(schema)).length > MAX_PARAMETERS_BYTES)
    return "too_large";
  return undefined;
}
