import {
  Type,
  type Static,
  type TArray,
  type TBoolean,
  type TLiteral,
  type TNull,
  type TNumber,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { parse } from "../../base/index.ts";
import { SecretRef } from "../../capabilities/secrets.ts";
import {
  RuntimeChangeSchema,
  SettingKeySchema,
  SettingScopeSchema,
  type SettingDef,
  type SettingKey,
  type SettingScope,
} from "./def.ts";
import { SCOPE_PRECEDENCE, type ScopeStack } from "./layers.ts";
import { validateSettingValue } from "./validate-value.ts";

export { effectiveSchemaJson, validateSettingValue, type ValueIssue } from "./validate-value.ts";

// ── 유효 값 ──────────────────────────────────────────────────────────────

export const SettingSourceSchema: TObject<{
  scope: TUnion<[typeof SettingScopeSchema, TLiteral<"default">]>;
  path: TOptional<TString>;
}> = Type.Object(
  {
    scope: Type.Union([SettingScopeSchema, Type.Literal("default")]),
    path: Type.Optional(Type.String({ maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export type SettingSource = Static<typeof SettingSourceSchema>;

/**
 * 관리 잠금의 사유 [결정: M3-REQ-15, 오케스트레이터 기본값]. 문장이 아니라 종류다(M3-REQ-21): 화면이 종류별 문구를 만든다.
 * `managed_file`은 managed 범위 파일이 값을 정했다, `managed_policy`는 OS 정책 등 파일 밖 관리 수단이 정했다.
 */
export const SettingLockReasonSchema: TUnion<
  [TLiteral<"managed_file">, TLiteral<"managed_policy">]
> = Type.Union([Type.Literal("managed_file"), Type.Literal("managed_policy")]);
export type SettingLockReason = Static<typeof SettingLockReasonSchema>;

/**
 * 유효 값의 문제 표시 [결정: M3-REQ-15·m2c-02, 오케스트레이터 기본값]. 값은 검사를 통과했지만 호스트만 아는 사실(모르는 모델 id,
 * 없는 제공자)로 쓸 수 없을 때 호스트가 싣는다. 첫 실행 안내가 "기본 모델 선택" 단계를 완료로 보이지 않게 하는 길이다.
 * `kind`와 `args`는 클라이언트가 문장으로 바꾼다(M3-REQ-21).
 */
export const SettingProblemSchema: TObject<{
  kind: TString;
  args: TOptional<TRecord<"^.*$", TUnion<[TString, TNumber, TBoolean, TNull]>>>;
}> = Type.Object(
  {
    kind: Type.String({ pattern: "^[a-z][A-Za-z0-9_.]{0,63}$" }),
    args: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
      ),
    ),
  },
  { additionalProperties: false },
);
export type SettingProblem = Static<typeof SettingProblemSchema>;

export const EffectiveSettingSchema: TObject<{
  key: TString;
  value: TUnknown;
  source: typeof SettingSourceSchema;
  locked: TBoolean;
  lockReason: TOptional<typeof SettingLockReasonSchema>;
  problem: TOptional<typeof SettingProblemSchema>;
  shadowed: TArray<typeof SettingSourceSchema>;
  runtimeChange: typeof RuntimeChangeSchema;
  pendingUntil: TUnion<[TLiteral<"nextTurn">, TLiteral<"restart">, TNull]>;
  deprecated: TBoolean;
}> = Type.Object(
  {
    key: SettingKeySchema,
    /** secret이면 SecretRef 문자열 또는 null. 해석한 값은 절대 없다 */
    value: Type.Unknown(),
    /** 이 값을 정한 범위 */
    source: SettingSourceSchema,
    /** managed가 값을 정했으면 true */
    locked: Type.Boolean(),
    /** `locked`일 때의 사유. 생략하면 managed 파일이다(호스트가 채운다) */
    lockReason: Type.Optional(SettingLockReasonSchema),
    /** 호스트가 아는 사실로 값을 쓸 수 없을 때의 문제 표시 */
    problem: Type.Optional(SettingProblemSchema),
    /** 같은 키를 정했지만 가려진 범위들, 우선순위 순 */
    shadowed: Type.Array(SettingSourceSchema, { maxItems: 5 }),
    runtimeChange: RuntimeChangeSchema,
    /** 값이 적용되는 시점. live는 즉시라 null, nextTurn·restart는 그 시점까지 대기 */
    pendingUntil: Type.Union([Type.Literal("nextTurn"), Type.Literal("restart"), Type.Null()]),
    deprecated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type EffectiveSetting = Static<typeof EffectiveSettingSchema>;

export interface ResolveIssue {
  readonly scope: SettingScope;
  readonly message: string;
}

function isSecretRefString(value: unknown): boolean {
  return typeof value === "string" && parse(SecretRef, value).ok;
}

/**
 * 순수 함수. 한 키의 유효 값을 계산한다. 값 검사를 통과하지 못한 층의 값은 건너뛰고 issues에 남긴다.
 * 병합 단위는 키 하나다(깊은 병합 없음). allowedScopes에 없는 범위의 값은 무시하고 issues에 남긴다.
 * 비밀 키는 secret:// 참조 문자열만 적용하고 평문 값은 건너뛴다(값은 issues에도 싣지 않는다).
 * pendingUntil은 "이 키의 변경이 적용되는 시점"이다. 적용된 값을 모르는 F는 실제 대기 여부를 알 수 없다.
 */
export function resolveSetting(
  def: SettingDef,
  layers: ScopeStack,
): { readonly setting: EffectiveSetting; readonly issues: readonly ResolveIssue[] } {
  const issues: ResolveIssue[] = [];
  const candidates: { source: SettingSource; value: unknown }[] = [];

  for (const scope of SCOPE_PRECEDENCE) {
    const layer = layers.find((candidate) => candidate.scope === scope);
    if (layer === undefined || !layer.values.has(def.key)) continue;
    const value = layer.values.get(def.key);
    const source: SettingSource = {
      scope,
      ...(layer.path === undefined ? {} : { path: layer.path }),
    };
    if (!def.allowedScopes.includes(scope)) {
      issues.push({
        scope,
        message: `${def.key} is not allowed in the ${scope} scope; value ignored`,
      });
      continue;
    }
    if (def.secret === true && value !== null && !isSecretRefString(value)) {
      issues.push({
        scope,
        message: `${def.key} holds a secret: only secret:// references are applied`,
      });
      continue;
    }
    const verdict =
      def.secret === true && value === null
        ? ({ ok: true } as const)
        : validateSettingValue(def, value);
    if (!verdict.ok) {
      const first = verdict.issues[0];
      issues.push({
        scope,
        message: `${def.key} has an invalid value in the ${scope} scope${first === undefined ? "" : `: ${first.message}`}`,
      });
      continue;
    }
    candidates.push({ source, value });
  }

  const winner = candidates[0];
  const rest = candidates.slice(1);
  const value =
    winner === undefined ? (def.secret === true ? null : (def.default ?? null)) : winner.value;
  const setting: EffectiveSetting = {
    key: def.key,
    value,
    source: winner === undefined ? { scope: "default" } : winner.source,
    locked: winner?.source.scope === "managed",
    shadowed: rest.map((candidate) => candidate.source),
    runtimeChange: def.runtimeChange,
    pendingUntil: def.runtimeChange === "live" ? null : def.runtimeChange,
    deprecated: def.deprecated !== undefined,
  };
  return { setting, issues };
}

// ── 쓰기 검사 ────────────────────────────────────────────────────────────

export type WriteCheckKind =
  | "settings.unknownKey"
  | "settings.reserved"
  | "settings.invalidValue"
  | "settings.scopeNotAllowed"
  | "settings.locked"
  | "settings.secretValue";

export type WriteCheck =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly kind: WriteCheckKind;
      readonly details: Readonly<Record<string, unknown>>;
    };

/**
 * 순수 함수. 쓰기 전에 키·구현 단계·범위·잠금·값을 이 순서로 검사한다. settings.set과 CLI config set이 같은 함수를 쓴다.
 * 오류 details에는 값을 싣지 않는다(비밀 값 비표시 규칙, F.wire-settings.spec §4.9).
 */
export function checkSettingWrite(
  catalog: ReadonlyMap<SettingKey, SettingDef>,
  layers: ScopeStack,
  key: string,
  scope: SettingScope,
  value: unknown,
): WriteCheck {
  const def = catalog.get(key);
  if (def === undefined) return { ok: false, kind: "settings.unknownKey", details: { key } };
  // 읽는 코드가 없는 키에 값을 써도 아무 일도 일어나지 않는다. 일반 키처럼 받지 않는다 [결정: m2c G5-04]
  if (def.stage === "reserved") return { ok: false, kind: "settings.reserved", details: { key } };
  if (!def.allowedScopes.includes(scope)) {
    return {
      ok: false,
      kind: "settings.scopeNotAllowed",
      details: { key, scope, allowedScopes: [...def.allowedScopes] },
    };
  }
  if (scope !== "managed") {
    const managed = layers.find((layer) => layer.scope === "managed");
    if (managed !== undefined && managed.values.has(key)) {
      return {
        ok: false,
        kind: "settings.locked",
        details: {
          key,
          lockedBy: "managed",
          ...(managed.path === undefined ? {} : { path: managed.path }),
        },
      };
    }
  }
  if (def.secret === true && value !== null && !isSecretRefString(value)) {
    return { ok: false, kind: "settings.secretValue", details: { key } };
  }
  const verdict =
    def.secret === true && value === null
      ? ({ ok: true } as const)
      : validateSettingValue(def, value);
  if (!verdict.ok) {
    return {
      ok: false,
      kind: "settings.invalidValue",
      details: { key, issues: verdict.issues },
    };
  }
  return { ok: true, value };
}
