import type { TSchema } from "typebox";
import { Bug, canonicalJson } from "../base/index.ts";
import type { JsonObject, JsonValue } from "../conversation/index.ts";
import type { AnyCapabilityDef } from "./capability.ts";
import { COMMON_ERROR_CODES } from "./errors.ts";

import {
  EXTENSION_TOOL_NAME_PATTERN,
  RESERVED_CAPABILITY_PREFIXES,
  TOOL_NAME_PATTERN,
  TOOL_NAME_WIRE_PATTERN,
  isCapabilityId,
  isSemVer,
  type CapabilityId,
} from "./ids.ts";

const COMMON_CODE_SET: ReadonlySet<string> = new Set(COMMON_ERROR_CODES);

export type IssueSeverity = "error" | "warning";

export type CapabilityIssueCode =
  | "id_invalid"
  | "id_reserved"
  | "version_invalid"
  | "description_empty"
  | "service_empty"
  | "method_name_invalid"
  | "method_input_not_object"
  | "error_code_invalid"
  | "error_code_shadow"
  | "tool_name_invalid"
  | "tool_name_style"
  | "tool_name_duplicate"
  | "tool_label_invalid"
  | "method_missing"
  | "tool_input_mismatch"
  | "replay_widened"
  | "parameters_not_object"
  | "schema_ref_external"
  | "schema_cyclic"
  | "schema_too_large"
  | "schema_too_deep"
  | "schema_not_json"
  | "schema_refine_dropped"
  | "description_too_long"
  | "requires_invalid"
  | "requires_self";

export interface CapabilityIssue {
  readonly severity: IssueSeverity;
  readonly code: CapabilityIssueCode;
  /** 정의 안의 JSON Pointer. 예: "/tools/0/method" */
  readonly path: string;
  readonly message: string;
}

export type CapabilitySetIssueCode =
  | "capability_duplicate"
  | "tool_name_conflict"
  | "requires_unresolved";

export interface CapabilitySetIssue {
  readonly severity: IssueSeverity;
  readonly code: CapabilitySetIssueCode;
  readonly capabilities: readonly CapabilityId[];
  readonly message: string;
}

// ── 한도(F.capabilities.spec §4.3). provider 공식 한도를 확인하지 않은 보수값이다 [가정] ──
/** 도구 하나의 parameters 정규화 JSON 최대 바이트 */
export const MAX_PARAMETERS_BYTES: number = 32 * 1024;
/** 스키마 중첩 깊이 */
export const MAX_SCHEMA_DEPTH: number = 12;
/** 도구 description 오류 한도(자) */
export const MAX_TOOL_DESCRIPTION: number = 4096;
/** 도구 description 경고 한도(자) */
export const WARN_TOOL_DESCRIPTION: number = 1024;
/** 도구 label 최대 길이 */
export const MAX_TOOL_LABEL: number = 64;

const METHOD_NAME_REGEX = /^[a-z][a-zA-Z0-9]{0,47}$/;
const ERROR_CODE_REGEX = /^[a-z][a-z0-9_]{0,47}$/;
const TOOL_NAME_REGEX = new RegExp(TOOL_NAME_PATTERN);
const TOOL_NAME_WIRE_REGEX = new RegExp(TOOL_NAME_WIRE_PATTERN);
const EXTENSION_TOOL_NAME_REGEX = new RegExp(EXTENSION_TOOL_NAME_PATTERN);

// ── TypeBox 스키마 → JSON Schema 2020-12 ────────────────────────────────

const DROPPED: unique symbol = Symbol("dropped");
const MAX_WALK_DEPTH = 256;

interface WalkState {
  /** 지워진 값이 있었는가(함수, RegExp, undefined, 심볼, 비유한 수) */
  dropped: boolean;
  /** ~refine 검사가 모델 노출 스키마에서 빠졌는가 */
  refine: boolean;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeValue(
  value: unknown,
  state: WalkState,
  depth: number,
): JsonValue | typeof DROPPED {
  if (depth > MAX_WALK_DEPTH) throw new Bug("toJsonSchema: schema nesting exceeds the walk limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    state.dropped = true;
    return DROPPED;
  }
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    const list: readonly unknown[] = value;
    for (const item of list) {
      const normalized = normalizeValue(item, state, depth + 1);
      if (normalized === DROPPED) continue;
      items.push(normalized);
    }
    return items;
  }
  if (value instanceof RegExp) {
    state.dropped = true;
    return DROPPED;
  }
  if (isPlainRecord(value)) {
    if (Object.hasOwn(value, "~refine")) state.refine = true;
    const out: JsonObject = {};
    for (const key of Object.keys(value)) {
      if (key.startsWith("~") || key === "$schema") continue;
      const normalized = normalizeValue(value[key], state, depth + 1);
      if (normalized === DROPPED) {
        state.dropped = true;
        continue;
      }
      out[key] = normalized;
    }
    return out;
  }
  state.dropped = true;
  return DROPPED;
}

const DEFS_PREFIX = "#/$defs/";

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** TypeBox Cyclic이 내는 `$ref: "Node"`(이름만)를 같은 문서의 `#/$defs/Node`로 고친다. */
function rewriteRefs(node: JsonValue, defNames: ReadonlySet<string>): JsonValue {
  if (isJsonArray(node)) return node.map((item) => rewriteRefs(item, defNames));
  if (!isJsonObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, member] of Object.entries(node)) {
    if (key === "$ref" && typeof member === "string" && defNames.has(member)) {
      out[key] = `${DEFS_PREFIX}${member}`;
    } else if (key === "$id" && typeof member === "string" && defNames.has(member)) {
      continue;
    } else {
      out[key] = rewriteRefs(member, defNames);
    }
  }
  return out;
}

interface SchemaAnalysis {
  readonly json: JsonValue;
  readonly dropped: boolean;
  readonly refineDropped: boolean;
}

function analyzeSchema(schema: TSchema): SchemaAnalysis {
  const state: WalkState = { dropped: false, refine: false };
  const normalized = normalizeValue(schema, state, 0);
  if (normalized === DROPPED) {
    return { json: {}, dropped: true, refineDropped: state.refine };
  }
  let json: JsonValue = normalized;
  if (isPlainRecord(json) && isPlainRecord(json["$defs"])) {
    json = rewriteRefs(json, new Set(Object.keys(json["$defs"])));
  }
  return { json, dropped: state.dropped, refineDropped: state.refine };
}

/**
 * TypeBox 스키마를 JSON Schema 2020-12 문서(순수 JSON)로 바꾼다(F.capabilities.spec §4.3). 순수 함수.
 * `~` 접두 키, `$schema`, 함수·RegExp·undefined·심볼을 지운다. Type.Refine의 검사는 JSON으로 표현되지 않아 빠진다.
 */
export function toJsonSchema(schema: TSchema): JsonValue {
  return analyzeSchema(schema).json;
}

// ── 스키마 구조 검사 ────────────────────────────────────────────────────

const SCHEMA_MAP_KEYS: readonly string[] = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
];
const SCHEMA_SINGLE_KEYS: readonly string[] = [
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
];
const SCHEMA_LIST_KEYS: readonly string[] = ["prefixItems", "anyOf", "oneOf", "allOf"];

/** 스키마 자리에 있는 하위 스키마를 모두 돌려준다. 값(const, enum, default)은 보지 않는다. */
function childSchemas(
  node: Readonly<Record<string, unknown>>,
): readonly Readonly<Record<string, unknown>>[] {
  const children: Readonly<Record<string, unknown>>[] = [];
  for (const key of SCHEMA_MAP_KEYS) {
    const map = node[key];
    if (!isPlainRecord(map)) continue;
    for (const member of Object.values(map)) if (isPlainRecord(member)) children.push(member);
  }
  for (const key of SCHEMA_SINGLE_KEYS) {
    const member = node[key];
    if (isPlainRecord(member)) children.push(member);
    else if (Array.isArray(member)) {
      const list: readonly unknown[] = member;
      for (const item of list) if (isPlainRecord(item)) children.push(item);
    }
  }
  for (const key of SCHEMA_LIST_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    const items: readonly unknown[] = list;
    for (const item of items) if (isPlainRecord(item)) children.push(item);
  }
  return children;
}

function schemaDepth(node: Readonly<Record<string, unknown>>): number {
  let deepest = 0;
  for (const child of childSchemas(node)) deepest = Math.max(deepest, schemaDepth(child));
  return deepest + 1;
}

function collectRefs(node: Readonly<Record<string, unknown>>, out: string[]): void {
  const ref = node["$ref"];
  if (typeof ref === "string") out.push(ref);
  for (const child of childSchemas(node)) collectRefs(child, out);
}

function hasDefCycle(root: Readonly<Record<string, unknown>>): boolean {
  const defs = root["$defs"];
  if (!isPlainRecord(defs)) return false;
  const graph = new Map<string, readonly string[]>();
  for (const [name, def] of Object.entries(defs)) {
    if (!isPlainRecord(def)) continue;
    const refs: string[] = [];
    collectRefs(def, refs);
    graph.set(
      name,
      refs.filter((r) => r.startsWith(DEFS_PREFIX)).map((r) => r.slice(DEFS_PREFIX.length)),
    );
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string): boolean => {
    const mark = state.get(name);
    if (mark === "visiting") return true;
    if (mark === "done") return false;
    state.set(name, "visiting");
    for (const next of graph.get(name) ?? []) if (visit(next)) return true;
    state.set(name, "done");
    return false;
  };
  for (const name of graph.keys()) if (visit(name)) return true;
  return false;
}

function isObjectRoot(json: JsonValue): boolean {
  return isPlainRecord(json) && json["type"] === "object";
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function jsonBytes(json: JsonValue): number {
  return new TextEncoder().encode(canonicalJson(json)).length;
}

type Push = (
  severity: IssueSeverity,
  code: CapabilityIssueCode,
  path: string,
  message: string,
) => void;

interface SchemaCheckOptions {
  /** 모델에 광고되는 스키마면 크기·깊이·비JSON 값을 검사한다 */
  readonly modelFacing: boolean;
}

function checkSchema(
  schema: TSchema,
  path: string,
  push: Push,
  options: SchemaCheckOptions,
): SchemaAnalysis {
  const analysis = analyzeSchema(schema);
  const json = analysis.json;
  if (isPlainRecord(json)) {
    const refs: string[] = [];
    collectRefs(json, refs);
    for (const ref of refs) {
      if (!ref.startsWith(DEFS_PREFIX)) {
        push(
          "error",
          "schema_ref_external",
          path,
          `$ref "${ref}" must point into the same document's #/$defs`,
        );
      }
    }
    if (hasDefCycle(json)) {
      push("warning", "schema_cyclic", path, "schema has a recursive $defs reference");
    }
    if (options.modelFacing) {
      const depth = schemaDepth(json);
      if (depth > MAX_SCHEMA_DEPTH) {
        push("error", "schema_too_deep", path, `schema depth ${depth} exceeds ${MAX_SCHEMA_DEPTH}`);
      }
    }
  }
  if (options.modelFacing) {
    const bytes = jsonBytes(json);
    if (bytes > MAX_PARAMETERS_BYTES) {
      push(
        "error",
        "schema_too_large",
        path,
        `schema is ${bytes} bytes, limit ${MAX_PARAMETERS_BYTES}`,
      );
    }
    if (analysis.dropped) {
      push("warning", "schema_not_json", path, "non-JSON values were dropped from the schema");
    }
    if (analysis.refineDropped) {
      push(
        "warning",
        "schema_refine_dropped",
        path,
        "Type.Refine checks are not visible to the model",
      );
    }
  }
  return analysis;
}

// ── 정의 하나 검사 ──────────────────────────────────────────────────────

/** 정의 하나를 검사한다. 순수 함수. 입력을 바꾸지 않는다 */
export function validateCapability(def: AnyCapabilityDef): readonly CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const push: Push = (severity, code, path, message) => {
    issues.push({ severity, code, path, message });
  };

  // 동적 입력(JS 플러그인)은 타입을 거치지 않으므로 string으로 다시 본다.
  const id: string = def.id;
  const version: string = def.version;
  if (!isCapabilityId(id)) {
    push("error", "id_invalid", "/id", `"${id}" is not a valid capability id`);
  } else {
    const first = id.split(".")[0] ?? "";
    if (RESERVED_CAPABILITY_PREFIXES.includes(first)) {
      push("error", "id_reserved", "/id", `"${first}" is a reserved capability prefix`);
    }
  }
  if (!isSemVer(version)) {
    push("error", "version_invalid", "/version", `"${version}" is not a semver version`);
  }
  if (def.description.trim() === "") {
    push("error", "description_empty", "/description", "capability description is empty");
  }

  const methodNames = Object.keys(def.service.methods);
  if (methodNames.length === 0) {
    push(
      "error",
      "service_empty",
      "/service/methods",
      "a capability needs at least one service method",
    );
  }
  for (const name of methodNames) {
    const method = def.service.methods[name];
    if (method === undefined) continue;
    const base = `/service/methods/${escapePointer(name)}`;
    if (!METHOD_NAME_REGEX.test(name)) {
      push("error", "method_name_invalid", base, `method name "${name}" is invalid`);
    }
    if (method.description.trim() === "") {
      push("error", "description_empty", `${base}/description`, "method description is empty");
    }
    const input = checkSchema(method.input, `${base}/input`, push, { modelFacing: false });
    if (!isObjectRoot(input.json)) {
      push(
        "error",
        "method_input_not_object",
        `${base}/input`,
        "method input root must be an object schema",
      );
    }
    checkSchema(method.output, `${base}/output`, push, { modelFacing: false });
    for (const code of Object.keys(method.errors ?? {})) {
      const codePath = `${base}/errors/${escapePointer(code)}`;
      if (!ERROR_CODE_REGEX.test(code)) {
        push("error", "error_code_invalid", codePath, `error code "${code}" is invalid`);
      } else if (COMMON_CODE_SET.has(code)) {
        push("error", "error_code_shadow", codePath, `error code "${code}" shadows a common code`);
      }
    }
  }

  const seenNames = new Set<string>();
  for (const [index, tool] of def.tools.entries()) {
    const base = `/tools/${index}`;
    if (!TOOL_NAME_WIRE_REGEX.test(tool.name)) {
      push(
        "error",
        "tool_name_invalid",
        `${base}/name`,
        `tool name "${tool.name}" is not allowed by providers`,
      );
    } else if (!EXTENSION_TOOL_NAME_REGEX.test(tool.name) && !TOOL_NAME_REGEX.test(tool.name)) {
      push(
        "warning",
        "tool_name_style",
        `${base}/name`,
        `tool name "${tool.name}" is not lowercase snake_case`,
      );
    }
    if (seenNames.has(tool.name)) {
      push(
        "error",
        "tool_name_duplicate",
        `${base}/name`,
        `tool name "${tool.name}" appears twice`,
      );
    }
    seenNames.add(tool.name);
    if (tool.label.length < 1 || tool.label.length > MAX_TOOL_LABEL) {
      push(
        "error",
        "tool_label_invalid",
        `${base}/label`,
        `label must be 1-${MAX_TOOL_LABEL} characters`,
      );
    }
    if (tool.description.trim() === "") {
      push("error", "description_empty", `${base}/description`, "tool description is empty");
    } else if (tool.description.length > MAX_TOOL_DESCRIPTION) {
      push(
        "error",
        "description_too_long",
        `${base}/description`,
        `description exceeds ${MAX_TOOL_DESCRIPTION} characters`,
      );
    } else if (tool.description.length > WARN_TOOL_DESCRIPTION) {
      push(
        "warning",
        "description_too_long",
        `${base}/description`,
        `description exceeds ${WARN_TOOL_DESCRIPTION} characters`,
      );
    }

    const parameters = checkSchema(tool.parameters, `${base}/parameters`, push, {
      modelFacing: true,
    });
    if (!isObjectRoot(parameters.json)) {
      push(
        "error",
        "parameters_not_object",
        `${base}/parameters`,
        "tool parameters root must be an object schema",
      );
    }
    if (tool.outputSchema !== undefined) {
      checkSchema(tool.outputSchema, `${base}/outputSchema`, push, { modelFacing: false });
    }

    const method = Object.hasOwn(def.service.methods, tool.method)
      ? def.service.methods[tool.method]
      : undefined;
    if (method === undefined) {
      push(
        "error",
        "method_missing",
        `${base}/method`,
        `method "${tool.method}" is not in service.methods`,
      );
      continue;
    }
    if (
      tool.toInput === undefined &&
      canonicalJson(parameters.json) !== canonicalJson(toJsonSchema(method.input))
    ) {
      push(
        "error",
        "tool_input_mismatch",
        `${base}/parameters`,
        `parameters differ from method "${tool.method}" input and no toInput is given`,
      );
    }
    if (tool.replay === "safe" && method.replay !== "safe") {
      push(
        "error",
        "replay_widened",
        `${base}/replay`,
        `tool replay "safe" is wider than method "${tool.method}"`,
      );
    }
  }

  for (const [index, entry] of (def.requires ?? []).entries()) {
    const required: string = entry;
    if (!isCapabilityId(required)) {
      push(
        "error",
        "requires_invalid",
        `/requires/${index}`,
        `"${required}" is not a valid capability id`,
      );
    } else if (required === id) {
      push("error", "requires_self", `/requires/${index}`, "a capability cannot require itself");
    }
  }
  return issues;
}

/** 정의 집합을 검사한다(같은 id 중복, 도구 이름 충돌, requires 미해결). 순수 함수 */
export function validateCapabilitySet(
  defs: readonly AnyCapabilityDef[],
): readonly CapabilitySetIssue[] {
  const issues: CapabilitySetIssue[] = [];
  const byId = new Map<string, number>();
  for (const def of defs) byId.set(def.id, (byId.get(def.id) ?? 0) + 1);
  for (const [id, count] of byId) {
    if (count > 1 && isCapabilityId(id)) {
      issues.push({
        severity: "error",
        code: "capability_duplicate",
        capabilities: [id],
        message: `capability "${id}" is defined ${count} times`,
      });
    }
  }

  const owners = new Map<string, CapabilityId[]>();
  for (const def of defs) {
    for (const tool of def.tools) {
      const list = owners.get(tool.name) ?? [];
      if (!list.includes(def.id)) list.push(def.id);
      owners.set(tool.name, list);
    }
  }
  for (const [name, list] of owners) {
    if (list.length > 1) {
      issues.push({
        severity: "error",
        code: "tool_name_conflict",
        capabilities: list,
        message: `tool name "${name}" is used by ${list.join(", ")}`,
      });
    }
  }

  for (const def of defs) {
    for (const required of def.requires ?? []) {
      if (!byId.has(required)) {
        issues.push({
          severity: "warning",
          code: "requires_unresolved",
          capabilities: [def.id],
          message: `"${def.id}" requires "${required}", which is not in the set`,
        });
      }
    }
  }
  return issues;
}
