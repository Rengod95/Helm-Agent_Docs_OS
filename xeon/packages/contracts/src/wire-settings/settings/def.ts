import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TInteger,
  type TLiteral,
  type TNumber,
  type TObject,
  type TOptional,
  type TRecord,
  type TSchema,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { SemVerSchema, toJsonSchema, type SemVer } from "../../capabilities/index.ts";
import { SECRET_REF_PATTERN } from "../../capabilities/secrets.ts";
import { validateSettingValue } from "./validate-value.ts";

// 형식 정본은 F.capabilities.spec §3.10이다(F.wire-settings.spec §3.8.1).
export { SecretRef } from "../../capabilities/secrets.ts";

/** 설정 키: `<층>.<도메인>.<이름>` 또는 `ext.<확장id>.<이름>`. 이름 부분은 소문자 낙타 표기이고 점으로 더 나눌 수 있다. */
export const SETTING_KEY_PATTERN: string =
  "^((f|x|l[0-4])\\.[a-z][a-z0-9-]*|ext\\.[a-z][a-z0-9-]*)(\\.[a-z][A-Za-z0-9]*)+$";
export const SettingKeySchema: TString = Type.String({
  minLength: 3,
  maxLength: 128,
  pattern: SETTING_KEY_PATTERN,
});
export type SettingKey = string;

export const SettingScopeSchema: TUnion<
  [
    TLiteral<"managed">,
    TLiteral<"user">,
    TLiteral<"project">,
    TLiteral<"local">,
    TLiteral<"session">,
  ]
> = Type.Union([
  Type.Literal("managed"),
  Type.Literal("user"),
  Type.Literal("project"),
  Type.Literal("local"),
  Type.Literal("session"),
]);
export type SettingScope = Static<typeof SettingScopeSchema>;

export const RuntimeChangeSchema: TUnion<
  [TLiteral<"live">, TLiteral<"nextTurn">, TLiteral<"restart">]
> = Type.Union([Type.Literal("live"), Type.Literal("nextTurn"), Type.Literal("restart")]);
export type RuntimeChange = Static<typeof RuntimeChangeSchema>;

/**
 * 설정의 구현 단계 [결정: m2c G5-04]. `active`는 값을 읽어 동작을 바꾸는 키다. `reserved`는 이름과 모양만 선언했고 읽는 곳이 아직 없는 키다
 * (2차·M3 기능의 키). `reserved` 키는 `settings.list`에서 기본으로 빠지고 화면에 두지 않으며 `settings.set`이 거부한다(`settings.reserved`).
 */
export const SettingStageSchema: TUnion<[TLiteral<"active">, TLiteral<"reserved">]> = Type.Union([
  Type.Literal("active"),
  Type.Literal("reserved"),
]);
export type SettingStage = Static<typeof SettingStageSchema>;

export const SettingLayerSchema: TUnion<
  [
    TLiteral<"F">,
    TLiteral<"X">,
    TLiteral<"L0">,
    TLiteral<"L1">,
    TLiteral<"L2">,
    TLiteral<"L3">,
    TLiteral<"L4">,
  ]
> = Type.Union([
  Type.Literal("F"),
  Type.Literal("X"),
  Type.Literal("L0"),
  Type.Literal("L1"),
  Type.Literal("L2"),
  Type.Literal("L3"),
  Type.Literal("L4"),
]);
export type SettingLayer = Static<typeof SettingLayerSchema>;

export const SettingsTabSchema: TUnion<
  [
    TLiteral<"overview">,
    TLiteral<"models">,
    TLiteral<"budgets">,
    TLiteral<"providers">,
    TLiteral<"secrets">,
    TLiteral<"permissions">,
    TLiteral<"sessions">,
    TLiteral<"tools">,
    TLiteral<"plugins">,
    TLiteral<"execution">,
    TLiteral<"appearance">,
    TLiteral<"advanced">,
  ]
> = Type.Union([
  Type.Literal("overview"),
  Type.Literal("models"),
  Type.Literal("budgets"),
  Type.Literal("providers"),
  Type.Literal("secrets"),
  Type.Literal("permissions"),
  Type.Literal("sessions"),
  Type.Literal("tools"),
  Type.Literal("plugins"),
  Type.Literal("execution"),
  Type.Literal("appearance"),
  Type.Literal("advanced"),
]);
export type SettingsTab = Static<typeof SettingsTabSchema>;

export const SettingWidgetSchema: TUnion<
  [
    TLiteral<"toggle">,
    TLiteral<"select">,
    TLiteral<"number">,
    TLiteral<"text">,
    TLiteral<"list">,
    TLiteral<"table">,
    TLiteral<"secret">,
    TLiteral<"readonly">,
  ]
> = Type.Union([
  Type.Literal("toggle"),
  Type.Literal("select"),
  Type.Literal("number"),
  Type.Literal("text"),
  Type.Literal("list"),
  Type.Literal("table"),
  Type.Literal("secret"),
  Type.Literal("readonly"),
]);
export type SettingWidget = Static<typeof SettingWidgetSchema>;

export const SettingUiSchema: TObject<{
  tab: typeof SettingsTabSchema;
  widget: typeof SettingWidgetSchema;
  order: TInteger;
  label: TString;
  help: TOptional<TString>;
  unit: TOptional<TString>;
}> = Type.Object(
  {
    tab: SettingsTabSchema,
    widget: SettingWidgetSchema,
    order: Type.Integer({ minimum: 0, maximum: 9999 }),
    label: Type.String({ minLength: 1, maxLength: 80 }),
    help: Type.Optional(Type.String({ maxLength: 500 })),
    unit: Type.Optional(Type.String({ maxLength: 16 })),
  },
  { additionalProperties: false },
);
export type SettingUi = Static<typeof SettingUiSchema>;

export const SettingRangeSchema: TObject<{
  min: TOptional<TNumber>;
  max: TOptional<TNumber>;
  enum: TOptional<TArray<TUnion<[TString, TNumber]>>>;
}> = Type.Object(
  {
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
    enum: Type.Optional(
      Type.Array(Type.Union([Type.String({ maxLength: 200 }), Type.Number()]), {
        minItems: 1,
        maxItems: 64,
      }),
    ),
  },
  { additionalProperties: false },
);
export type SettingRange = Static<typeof SettingRangeSchema>;

export const SettingDeprecationSchema: TObject<{
  since: TString;
  replacedBy: TOptional<TString>;
  note: TOptional<TString>;
}> = Type.Object(
  {
    since: SemVerSchema,
    replacedBy: Type.Optional(SettingKeySchema),
    note: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type SettingDeprecation = {
  readonly since: SemVer;
  readonly replacedBy?: SettingKey;
  readonly note?: string;
};

/** 코드에서 쓰는 형태. type은 TypeBox 스키마이고 default는 그 정적 타입이다. */
export interface SettingDef<S extends TSchema = TSchema> {
  readonly key: SettingKey;
  readonly type: S;
  /** secret이면 두지 않는다 */
  readonly default?: Static<S>;
  readonly range?: SettingRange;
  readonly runtimeChange: RuntimeChange;
  readonly layer: SettingLayer;
  readonly allowedScopes: readonly [SettingScope, ...SettingScope[]];
  /** 없으면 화면에 두지 않는다(파일·명령만, advanced 탭의 파일 편집기에서만 보인다) */
  readonly ui?: SettingUi;
  /** 기본 false */
  readonly secret?: boolean;
  readonly since: SemVer;
  readonly deprecated?: SettingDeprecation;
  /** 생략하면 `active`. 값을 읽는 코드가 없는 키는 `reserved`로 선언한다 */
  readonly stage?: SettingStage;
}

/** 전송·검사용 형태(settings.list 결과, 확장 매니페스트 userConfig 변환 결과). type은 JSON Schema 객체다. */
export const SettingDefWireSchema: TObject<{
  key: TString;
  type: TRecord<"^.*$", TUnknown>;
  default: TOptional<TUnknown>;
  range: TOptional<typeof SettingRangeSchema>;
  runtimeChange: typeof RuntimeChangeSchema;
  layer: typeof SettingLayerSchema;
  allowedScopes: TArray<typeof SettingScopeSchema>;
  ui: TOptional<typeof SettingUiSchema>;
  secret: TOptional<TBoolean>;
  since: TString;
  deprecated: TOptional<typeof SettingDeprecationSchema>;
  stage: TOptional<typeof SettingStageSchema>;
}> = Type.Object(
  {
    key: SettingKeySchema,
    type: Type.Record(Type.String(), Type.Unknown()),
    default: Type.Optional(Type.Unknown()),
    range: Type.Optional(SettingRangeSchema),
    runtimeChange: RuntimeChangeSchema,
    layer: SettingLayerSchema,
    allowedScopes: Type.Array(SettingScopeSchema, { minItems: 1, maxItems: 5, uniqueItems: true }),
    ui: Type.Optional(SettingUiSchema),
    secret: Type.Optional(Type.Boolean()),
    since: SemVerSchema,
    deprecated: Type.Optional(SettingDeprecationSchema),
    /** 생략하면 `active` */
    stage: Type.Optional(SettingStageSchema),
  },
  { additionalProperties: false },
);
export type SettingDefWire = Static<typeof SettingDefWireSchema>;

/** 키 접두 → 층. `ext.`는 층을 접두로 정하지 않는다(확장 매니페스트가 선언한 층). */
export const KEY_PREFIX_LAYERS: Readonly<Record<string, SettingLayer>> = {
  f: "F",
  x: "X",
  l0: "L0",
  l1: "L1",
  l2: "L2",
  l3: "L3",
  l4: "L4",
};

/** SettingDef 검사 규칙 D1~D9. D9는 카탈로그를 조립할 때 검사한다(buildCatalog). */
export type SettingDefRule = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9";

export interface SettingDefIssue {
  readonly rule: SettingDefRule;
  readonly message: string;
}

const KEY_REGEX = new RegExp(SETTING_KEY_PATTERN);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringSchema(json: unknown): boolean {
  return isRecord(json) && json["type"] === "string";
}

function typeName(json: unknown): string | undefined {
  if (!isRecord(json)) return undefined;
  const name = json["type"];
  return typeof name === "string" ? name : undefined;
}

/**
 * SettingDef 하나를 규칙 D1~D8로 검사한다. 순수 함수. 하나라도 어기면 정의를 거부해야 한다.
 * D3의 ui는 선택이다: ui가 있을 때만 widget이 "secret"이어야 한다(화면에 두지 않는 비밀 키는 파일·명령으로만 쓴다).
 */
export function checkSettingDef(def: SettingDef): readonly SettingDefIssue[] {
  const issues: SettingDefIssue[] = [];
  const add = (rule: SettingDefRule, message: string): void => {
    issues.push({ rule, message });
  };
  const typeJson = toJsonSchema(def.type);
  const kind = typeName(typeJson);

  // D1
  if (!KEY_REGEX.test(def.key)) {
    add("D1", `key "${def.key}" does not match the setting key pattern`);
  } else {
    const prefix = def.key.split(".")[0] ?? "";
    const expected = KEY_PREFIX_LAYERS[prefix];
    if (expected !== undefined && expected !== def.layer) {
      add("D1", `key prefix "${prefix}" requires layer ${expected}, got ${def.layer}`);
    }
  }

  // D2, D3
  if (def.secret === true) {
    if (def.default !== undefined) add("D2", "a secret setting must not have a default");
    const pattern = isRecord(typeJson) ? typeJson["pattern"] : undefined;
    if (!isStringSchema(typeJson) || pattern !== SECRET_REF_PATTERN) {
      add("D3", "a secret setting's type must be the SecretRef string schema");
    }
    if (def.ui !== undefined && def.ui.widget !== "secret") {
      add("D3", 'a secret setting\'s ui.widget must be "secret"');
    }
  }

  // D5
  const range = def.range;
  if (range !== undefined) {
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      add("D5", `range.min (${range.min}) is greater than range.max (${range.max})`);
    }
    const numeric = kind === "number" || kind === "integer";
    if ((range.min !== undefined || range.max !== undefined) && !numeric) {
      add("D5", "range.min/max need a number or integer type");
    }
    if (range.enum !== undefined && kind !== "string" && !numeric) {
      add("D5", "range.enum needs a string, number or integer type");
    }
  }

  // D6
  if (range !== undefined && isRecord(typeJson)) {
    const direct = ["minimum", "maximum", "enum"].filter((keyword) => keyword in typeJson);
    if (direct.length > 0) {
      add("D6", `constraints ${direct.join(", ")} appear both in type and in range`);
    }
  }

  // D7
  if (new Set(def.allowedScopes).size !== def.allowedScopes.length) {
    add("D7", "allowedScopes has duplicates");
  }
  if (def.runtimeChange === "restart" && def.allowedScopes.includes("session")) {
    add("D7", 'a "restart" setting cannot be allowed in the session scope');
  }

  // D8
  if (def.ui !== undefined) {
    const widget = def.ui.widget;
    if (widget === "toggle" && kind !== "boolean") add("D8", "widget toggle needs a boolean type");
    if (widget === "number" && kind !== "number" && kind !== "integer") {
      add("D8", "widget number needs a number or integer type");
    }
    if (widget === "select" && range?.enum === undefined) {
      add("D8", "widget select needs range.enum");
    }
    if (widget === "secret" && def.secret !== true) {
      add("D8", "widget secret needs secret: true");
    }
  }

  // D4: 마지막에 본다. 앞의 규칙을 어긴 정의의 기본값 검사는 의미가 흐리다.
  if (def.default !== undefined && def.secret !== true) {
    const verdict = validateSettingValue(def, def.default);
    if (!verdict.ok) {
      add(
        "D4",
        `default does not satisfy type and range: ${verdict.issues.map((i) => i.message).join("; ")}`,
      );
    }
  }
  return issues;
}

/** SettingDef를 전송용 SettingDefWire로 바꾼다. type은 JSON Schema 문서, range는 합치지 않고 그대로 싣는다. 순수 함수. */
export function toSettingDefWire(def: SettingDef): SettingDefWire {
  const typeJson = toJsonSchema(def.type);
  return {
    key: def.key,
    type: isRecord(typeJson) ? { ...typeJson } : {},
    ...(def.default === undefined ? {} : { default: def.default }),
    ...(def.range === undefined ? {} : { range: def.range }),
    runtimeChange: def.runtimeChange,
    layer: def.layer,
    allowedScopes: [...def.allowedScopes],
    ...(def.ui === undefined ? {} : { ui: def.ui }),
    ...(def.secret === undefined ? {} : { secret: def.secret }),
    since: def.since,
    ...(def.deprecated === undefined ? {} : { deprecated: def.deprecated }),
    ...(def.stage === undefined ? {} : { stage: def.stage }),
  };
}
