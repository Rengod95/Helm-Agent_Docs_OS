import { describe, expect, test } from "bun:test";
import { Nullable } from "@xeon/contracts";
import {
  toSettingDefWire,
  type SettingDefWire,
  type SettingWidget,
} from "@xeon/contracts/settings";
import { Type, type TSchema } from "typebox";
import { resolveWidget } from "../../src/settings/index.ts";
import { wireDef } from "./fixtures.ts";

const UI = { tab: "models", order: 1, label: "값" } as const;

/** TypeBox 스키마로 정의를 만든다. 실제 설정 정의가 전송될 때의 모양이다 */
function typed(
  type: TSchema,
  widget: SettingWidget,
  extra: {
    range?: { min?: number; max?: number; enum?: string[] };
    secret?: boolean;
    unit?: string;
  } = {},
): SettingDefWire {
  return toSettingDefWire({
    key: "l1.models.sample",
    type,
    runtimeChange: "nextTurn",
    layer: "L1",
    allowedScopes: ["user"],
    ui: { ...UI, widget, ...(extra.unit === undefined ? {} : { unit: extra.unit }) },
    since: "0.1.0",
    ...(extra.range === undefined ? {} : { range: extra.range }),
    ...(extra.secret === undefined ? {} : { secret: extra.secret }),
  });
}

describe("widget map: toggle, select, number", () => {
  test("toggle needs a boolean", () => {
    expect(resolveWidget(typed(Type.Boolean(), "toggle"))).toEqual({
      widget: { kind: "toggle" },
      diagnostic: null,
    });
    expect(resolveWidget(typed(Type.String(), "toggle"))).toEqual({
      widget: { kind: "readonly" },
      diagnostic: { code: "widgetMismatch", key: "l1.models.sample", widget: "toggle" },
    });
  });

  test("a nullable boolean is still a toggle", () => {
    expect(resolveWidget(typed(Nullable(Type.Boolean()), "toggle")).widget).toEqual({
      kind: "toggle",
    });
  });

  test("select needs range.enum and keeps its order", () => {
    expect(
      resolveWidget(
        typed(Type.String({ maxLength: 8 }), "select", { range: { enum: ["low", "high"] } }),
      ).widget,
    ).toEqual({ kind: "select", options: ["low", "high"] });
    expect(resolveWidget(typed(Type.String(), "select")).diagnostic).toEqual({
      code: "widgetMismatch",
      key: "l1.models.sample",
      widget: "select",
    });
  });

  test("number needs number or integer; integer sets the integer flag, range and unit come along", () => {
    expect(
      resolveWidget(typed(Type.Integer(), "number", { range: { min: 0, max: 10 }, unit: "토큰" }))
        .widget,
    ).toEqual({ kind: "number", min: 0, max: 10, integer: true, unit: "토큰" });
    expect(resolveWidget(typed(Type.Number(), "number")).widget).toEqual({
      kind: "number",
      min: null,
      max: null,
      integer: false,
      unit: null,
    });
    expect(resolveWidget(typed(Type.String(), "number")).diagnostic?.code).toBe("widgetMismatch");
  });
});

describe("widget map: text, list", () => {
  test("text needs a string and carries length and pattern", () => {
    expect(
      resolveWidget(typed(Type.String({ minLength: 2, maxLength: 9, pattern: "^a" }), "text"))
        .widget,
    ).toEqual({ kind: "text", minLength: 2, maxLength: 9, pattern: "^a" });
    expect(resolveWidget(typed(Type.Number(), "text")).diagnostic?.code).toBe("widgetMismatch");
  });

  test("a nullable string (TypeBox Union([String, Null]) → anyOf) is a text widget", () => {
    const resolved = resolveWidget(
      typed(Nullable(Type.String({ pattern: "^p/m$", maxLength: 265 })), "text"),
    );
    expect(resolved).toEqual({
      widget: { kind: "text", minLength: null, maxLength: 265, pattern: "^p/m$" },
      diagnostic: null,
    });
  });

  test('the array form type ["string", "null"] is treated the same as the anyOf form', () => {
    const def = wireDef({
      key: "l1.models.sample",
      type: { type: ["string", "null"], maxLength: 4 },
      ui: { ...UI, widget: "text" },
    });
    expect(resolveWidget(def).widget).toEqual({
      kind: "text",
      minLength: null,
      maxLength: 4,
      pattern: null,
    });
  });

  test("list needs an array of a primitive item type", () => {
    expect(resolveWidget(typed(Type.Array(Type.String(), { maxItems: 3 }), "list")).widget).toEqual(
      {
        kind: "list",
        item: "string",
        maxItems: 3,
      },
    );
    expect(resolveWidget(typed(Type.Array(Type.Integer()), "list")).widget).toEqual({
      kind: "list",
      item: "integer",
      maxItems: null,
    });
    expect(
      resolveWidget(typed(Type.Array(Type.Object({ a: Type.String() })), "list")).diagnostic?.code,
    ).toBe("widgetMismatch");
  });
});

describe("widget map: table shapes", () => {
  test("rows: an array of objects, columns follow items.properties order, required and enum are read", () => {
    const row = typed(
      Type.Array(
        Type.Object({
          id: Type.String(),
          level: Type.Union([Type.Literal("a"), Type.Literal("b")]),
          enabled: Type.Optional(Type.Boolean()),
          nested: Type.Object({ x: Type.String() }),
        }),
        { maxItems: 5 },
      ),
      "table",
    );
    const resolved = resolveWidget(row);
    expect(resolved.diagnostic).toBeNull();
    expect(resolved.widget).toEqual({
      kind: "table",
      shape: "rows",
      columns: [
        { name: "id", kind: "string", options: null, required: true },
        { name: "level", kind: "enum", options: ["a", "b"], required: true },
        { name: "enabled", kind: "boolean", options: null, required: false },
        { name: "nested", kind: "json", options: null, required: true },
      ],
      maxItems: 5,
    });
  });

  test("rows with an enum property read the options as an enum column", () => {
    const def = wireDef({
      key: "l1.models.sample",
      type: {
        type: "array",
        items: {
          type: "object",
          required: ["mode"],
          properties: { mode: { type: "string", enum: ["x", "y"] } },
        },
      },
      ui: { ...UI, widget: "table" },
    });
    expect(resolveWidget(def).widget).toEqual({
      kind: "table",
      shape: "rows",
      columns: [{ name: "mode", kind: "enum", options: ["x", "y"], required: true }],
      maxItems: null,
    });
  });

  test("fixed: a closed object of integer properties (thinkingBudgets-like) lists its keys in order", () => {
    const budgets = typed(
      Type.Object(
        {
          minimal: Type.Integer({ minimum: 0 }),
          low: Type.Integer({ minimum: 0 }),
          max: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
      "table",
    );
    expect(resolveWidget(budgets).widget).toEqual({
      kind: "table",
      shape: "fixed",
      columns: [
        { name: "minimal", kind: "integer", options: null, required: true },
        { name: "low", kind: "integer", options: null, required: true },
        { name: "max", kind: "integer", options: null, required: true },
      ],
      maxItems: null,
    });
  });

  test("fixed: an object without additionalProperties: false is fixed too, but an open object is not", () => {
    const closedByDefault = typed(Type.Object({ a: Type.Boolean() }), "table");
    expect(resolveWidget(closedByDefault).widget).toMatchObject({ kind: "table", shape: "fixed" });
    const open = typed(Type.Object({ a: Type.Boolean() }, { additionalProperties: true }), "table");
    expect(resolveWidget(open).diagnostic?.code).toBe("widgetMismatch");
  });

  test("record: an object whose additionalProperties is a primitive schema", () => {
    const record = typed(Type.Object({}, { additionalProperties: Type.Integer() }), "table");
    expect(resolveWidget(record).widget).toEqual({
      kind: "table",
      shape: "record",
      columns: [
        { name: "이름", kind: "string", options: null, required: true },
        { name: "값", kind: "integer", options: null, required: true },
      ],
      maxItems: null,
    });
  });

  test("record: TypeBox Type.Record (patternProperties) is the record shape, with a json value column for object values", () => {
    const ints = resolveWidget(typed(Type.Record(Type.String(), Type.Integer()), "table"));
    expect(ints.diagnostic).toBeNull();
    expect(ints.widget).toMatchObject({
      kind: "table",
      shape: "record",
      columns: [
        { name: "이름", kind: "string" },
        { name: "값", kind: "integer" },
      ],
    });
    const objects = resolveWidget(
      typed(Type.Record(Type.String(), Type.Object({ a: Type.Integer() })), "table"),
    );
    expect(objects.diagnostic).toBeNull();
    expect(objects.widget).toMatchObject({
      kind: "table",
      shape: "record",
      columns: [{ name: "이름" }, { name: "값", kind: "json" }],
    });
  });

  test("a table over a nullable string or a plain scalar is a mismatch", () => {
    expect(resolveWidget(typed(Nullable(Type.String()), "table")).diagnostic?.code).toBe(
      "widgetMismatch",
    );
    expect(resolveWidget(typed(Type.Integer(), "table")).diagnostic?.code).toBe("widgetMismatch");
  });
});

describe("widget map: secret, readonly, unknown", () => {
  test("secret needs secret: true", () => {
    const secret = wireDef({
      key: "l0.secrets.exa",
      type: { type: "string", pattern: "^secret://[a-z][a-z0-9-]{1,63}$" },
      secret: true,
      ui: { tab: "secrets", widget: "secret", order: 1, label: "키" },
    });
    expect(resolveWidget(secret).widget).toEqual({ kind: "secret" });
    const notSecret = wireDef({
      key: "l0.secrets.exa",
      type: { type: "string" },
      ui: { tab: "secrets", widget: "secret", order: 1, label: "키" },
    });
    expect(resolveWidget(notSecret).diagnostic).toEqual({
      code: "widgetMismatch",
      key: "l0.secrets.exa",
      widget: "secret",
    });
  });

  test("readonly always resolves", () => {
    expect(resolveWidget(typed(Type.Object({ a: Type.String() }), "readonly")).widget).toEqual({
      kind: "readonly",
    });
  });

  test("a definition without ui is read-only with no diagnostic", () => {
    const noUi = wireDef({ key: "l1.models.sample", type: { type: "boolean" } });
    expect(resolveWidget(noUi)).toEqual({ widget: { kind: "readonly" }, diagnostic: null });
  });

  test("a widget value outside the eight is unknownWidget", () => {
    const future = wireDef({
      key: "l1.models.sample",
      type: { type: "boolean" },
      // @ts-expect-error -- 새 F 부 버전이 보낸 위젯 값을 흉내 낸다. 타입에는 없는 값이다
      ui: { tab: "models", widget: "slider", order: 1, label: "값" },
    });
    expect(resolveWidget(future)).toEqual({
      widget: { kind: "readonly" },
      diagnostic: { code: "unknownWidget", key: "l1.models.sample", widget: "slider" },
    });
  });
});
