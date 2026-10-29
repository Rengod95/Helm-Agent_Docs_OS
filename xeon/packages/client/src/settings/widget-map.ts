import { assertNever, parse } from "@xeon/contracts";
import {
  SettingWidgetSchema,
  type SettingDefWire,
  type SettingWidget,
} from "@xeon/contracts/settings";
import { t } from "../i18n/index.ts";
import type { ListItemKind, TableColumn, ViewDiagnostic, WidgetVM } from "./types.ts";

// 위젯 대응(L4.settings-ui §4.2.1). 정의의 `ui.widget`이 JSON Schema 모양과 맞는지 보고, 맞지 않으면 읽기 전용과 진단을 낸다.
// 정의의 `type`은 와이어 형태(JSON Schema 객체)다. TypeBox가 만든 모양 두 가지를 본다: Nullable·Union([X, Null])은
// `anyOf [X, {type:"null"}]`이고, 손으로 쓴 `type: ["X", "null"]`도 같은 값으로 본다.

type Schema = Readonly<Record<string, unknown>>;

export interface WidgetResolution {
  readonly widget: WidgetVM;
  readonly diagnostic: ViewDiagnostic | null;
}

const READONLY: WidgetVM = { kind: "readonly" };

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isNullSchema(value: unknown): boolean {
  return isSchema(value) && value["type"] === "null";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function unionMembersOf(schema: Schema): readonly unknown[] | null {
  const anyOf = schema["anyOf"];
  if (isList(anyOf)) return anyOf;
  const oneOf = schema["oneOf"];
  return isList(oneOf) ? oneOf : null;
}

/** null을 뺀 본체. `type: ["X", "null"]`이면 `type: "X"`인 사본을, `anyOf`·`oneOf`의 [X, null]이면 X를 돌려준다 */
function coreOf(schema: Schema): Schema {
  const type = schema["type"];
  if (isList(type)) {
    const kept = type.filter((entry) => entry !== "null");
    const [only] = kept;
    return kept.length === 1 && typeof only === "string" ? { ...schema, type: only } : schema;
  }
  const members = unionMembersOf(schema);
  if (members !== null && members.length === 2) {
    const kept = members.filter((member) => !isNullSchema(member));
    const [only] = kept;
    if (kept.length === 1 && isSchema(only)) return only;
  }
  return schema;
}

function primitiveOf(core: Schema): ListItemKind | null {
  const type = core["type"];
  if (type === "string" || type === "number" || type === "integer" || type === "boolean")
    return type;
  return null;
}

/** 문자열이나 숫자만 담긴 목록이면 그 목록을, 아니면 null을 돌려준다 */
function scalarsOf(values: readonly unknown[]): readonly (string | number)[] | null {
  const scalar = values.filter(
    (value): value is string | number => typeof value === "string" || typeof value === "number",
  );
  return scalar.length > 0 && scalar.length === values.length ? scalar : null;
}

/**
 * 열거형의 선택지. `enum` 키워드이거나, TypeBox Union([Literal, Literal, ...])이 만든 `anyOf`의 `const` 원소들이다.
 * 원소가 문자열이나 숫자가 아니면 열거형이 아니다.
 */
function enumOf(core: Schema): readonly (string | number)[] | null {
  const values = core["enum"];
  if (isList(values)) return scalarsOf(values);
  const members = unionMembersOf(core);
  if (members === null) return null;
  const consts = members.map((member) => (isSchema(member) ? member["const"] : undefined));
  return scalarsOf(consts);
}

function propertiesOf(core: Schema): Schema | null {
  const properties = core["properties"];
  if (!isSchema(properties) || Object.keys(properties).length === 0) return null;
  return properties;
}

function requiredOf(core: Schema): readonly string[] {
  const required = core["required"];
  return isList(required)
    ? required.filter((name): name is string => typeof name === "string")
    : [];
}

function columnOf(name: string, schema: unknown, required: boolean): TableColumn {
  const core: Schema = isSchema(schema) ? coreOf(schema) : {};
  const options = enumOf(core);
  if (options !== null) return { name, kind: "enum", options, required };
  const kind = primitiveOf(core);
  if (kind !== null) return { name, kind, options: null, required };
  return { name, kind: "json", options: null, required };
}

/** 객체 배열. 열은 `items.properties`의 순서다 */
function rowsOf(core: Schema): WidgetVM | null {
  if (core["type"] !== "array") return null;
  const items = core["items"];
  if (!isSchema(items)) return null;
  const item = coreOf(items);
  const properties = item["type"] === "object" ? propertiesOf(item) : null;
  if (properties === null) return null;
  const required = requiredOf(item);
  const columns = Object.entries(properties).map(([name, schema]) =>
    columnOf(name, schema, required.includes(name)),
  );
  return { kind: "table", shape: "rows", columns, maxItems: numberOrNull(core["maxItems"]) };
}

/** 속성이 고정된 객체. 추가 속성을 허용하지 않고 모든 속성이 원시 값이나 열거형이다 */
function fixedOf(core: Schema): WidgetVM | null {
  if (core["type"] !== "object") return null;
  const extra = core["additionalProperties"];
  if (extra !== undefined && extra !== false) return null;
  const properties = propertiesOf(core);
  if (properties === null) return null;
  const required = requiredOf(core);
  const columns = Object.entries(properties).map(([name, schema]) =>
    columnOf(name, schema, required.includes(name)),
  );
  if (columns.some((column) => column.kind === "json")) return null;
  return { kind: "table", shape: "fixed", columns, maxItems: null };
}

/**
 * 이름 → 값 맵: 속성이 없고 값 스키마가 `additionalProperties`이거나, TypeBox `Type.Record`가 내는 항목 하나짜리 `patternProperties`다.
 * 값이 원시 값이면 그 종류의 열이고, 객체 같은 중첩 값이면 `json` 열이다(읽기만 하고 편집은 파일 편집기로 넘긴다, §4.2.1)
 */
function recordValueSchema(core: Schema): Schema | null {
  const extra = core["additionalProperties"];
  if (isSchema(extra)) return extra;
  const patterns = core["patternProperties"];
  if (!isSchema(patterns)) return null;
  const values = Object.values(patterns);
  const [only] = values;
  return values.length === 1 && isSchema(only) ? only : null;
}

function recordOf(core: Schema): WidgetVM | null {
  if (core["type"] !== "object" || propertiesOf(core) !== null) return null;
  const value = recordValueSchema(core);
  if (value === null) return null;
  const valueKind = primitiveOf(coreOf(value)) ?? "json";
  const columns: readonly TableColumn[] = [
    { name: t("client.settings.widget.recordName"), kind: "string", options: null, required: true },
    {
      name: t("client.settings.widget.recordValue"),
      kind: valueKind,
      options: null,
      required: true,
    },
  ];
  return { kind: "table", shape: "record", columns, maxItems: numberOrNull(core["maxProperties"]) };
}

function tableOf(core: Schema): WidgetVM | null {
  return rowsOf(core) ?? fixedOf(core) ?? recordOf(core);
}

/** 위젯 하나가 정의 모양과 맞으면 그 VM을, 아니면 null을 돌려준다 */
function widgetFor(widget: SettingWidget, def: SettingDefWire): WidgetVM | null {
  const core = coreOf(def.type);
  switch (widget) {
    case "toggle":
      return primitiveOf(core) === "boolean" ? { kind: "toggle" } : null;
    case "select": {
      const options = def.range?.enum;
      return options === undefined ? null : { kind: "select", options: [...options] };
    }
    case "number": {
      const primitive = primitiveOf(core);
      if (primitive !== "number" && primitive !== "integer") return null;
      return {
        kind: "number",
        min: def.range?.min ?? null,
        max: def.range?.max ?? null,
        integer: primitive === "integer",
        unit: def.ui?.unit ?? null,
      };
    }
    case "text":
      if (primitiveOf(core) !== "string") return null;
      return {
        kind: "text",
        minLength: numberOrNull(core["minLength"]),
        maxLength: numberOrNull(core["maxLength"]),
        pattern: stringOrNull(core["pattern"]),
      };
    case "list": {
      const items = core["items"];
      if (core["type"] !== "array" || !isSchema(items)) return null;
      const itemCore = coreOf(items);
      const options = enumOf(itemCore);
      // 열거형 원소(TypeBox Union of Literal)는 고르는 목록이다. 원소 종류는 선택지의 값에서 읽는다
      const item =
        options === null
          ? primitiveOf(itemCore)
          : typeof options[0] === "number"
            ? "number"
            : "string";
      if (item === null) return null;
      return { kind: "list", item, options, maxItems: numberOrNull(core["maxItems"]) };
    }
    case "table":
      return tableOf(core);
    case "secret":
      return def.secret === true ? { kind: "secret" } : null;
    case "readonly":
      return READONLY;
    default:
      return assertNever(widget, "resolveWidget");
  }
}

/**
 * 정의 하나의 위젯을 정한다. 정의에 `ui`가 없으면 읽기 전용이고 진단이 없다.
 * 알 수 없는 위젯 값은 `unknownWidget`, 모양이 맞지 않는 위젯은 `widgetMismatch`로 진단하고 읽기 전용으로 그린다.
 */
export function resolveWidget(def: SettingDefWire): WidgetResolution {
  const ui = def.ui;
  if (ui === undefined) return { widget: READONLY, diagnostic: null };
  const name: string = ui.widget;
  const parsed = parse(SettingWidgetSchema, name);
  if (!parsed.ok) {
    return { widget: READONLY, diagnostic: { code: "unknownWidget", key: def.key, widget: name } };
  }
  const widget = widgetFor(parsed.value, def);
  if (widget === null) {
    return { widget: READONLY, diagnostic: { code: "widgetMismatch", key: def.key, widget: name } };
  }
  return { widget, diagnostic: null };
}
