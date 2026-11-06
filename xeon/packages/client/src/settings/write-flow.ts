import { assertNever, err, ok, parse, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  SecretRef,
  SettingScopeSchema,
  toValueJsonSchema,
  type EffectiveSetting,
  type SettingDefWire,
  type SettingScope,
} from "@fresnel/contracts/settings";
import { WireError, type WireParams } from "@fresnel/contracts/wire";
import { Type } from "typebox";
import { Errors } from "typebox/schema";
import { t } from "../i18n/index.ts";
import { scopeText, writableScopes } from "./badges.ts";
import type {
  FieldError,
  LocalWriteFailure,
  ValueIssue,
  WidgetVM,
  WritableScope,
} from "./types.ts";

// 쓰기 흐름의 순수 함수(L4.settings-ui §4.4). 입력 변환, 클라이언트 즉시 검사, 보내기 계획, 서버 오류의 문장 변환.
// I/O가 없다. 연결과 상태 전이는 controller.ts와 state.ts가 맡는다.

/** 오류 뒤에 할 일. `refreshValue`는 그 키를 다시 읽고, `reloadCatalog`는 목록을 다시 읽는다 */
export type FollowUp = "none" | "refreshValue" | "reloadCatalog";

export type WritePlan =
  | { readonly kind: "send"; readonly params: WireParams<"settings.set"> }
  | { readonly kind: "blocked"; readonly error: FieldError };

export type ResetPlan =
  | { readonly kind: "send"; readonly params: WireParams<"settings.reset"> }
  | { readonly kind: "blocked"; readonly error: FieldError };

const SettingScopesSchema = Type.Array(SettingScopeSchema);
const IssuesSchema = Type.Array(
  Type.Object({ path: Type.String(), message: Type.String() }, { additionalProperties: false }),
);

function formatIssue(): Result<never, ValueIssue> {
  return err({ path: "", message: t("client.settings.field.format") });
}

/**
 * 위젯 입력을 값으로 바꾼다. number는 문자열이면 Number로 바꾸고, text는 문자열만 받는다.
 * 시크릿은 `secret://<이름>` 참조만 받는다. 참조가 아니면 실패하고, 실패 항목에는 입력 값을 싣지 않는다.
 */
export function coerceInput(widget: WidgetVM, raw: unknown): Result<unknown, ValueIssue> {
  switch (widget.kind) {
    case "toggle":
      return typeof raw === "boolean" ? ok(raw) : formatIssue();
    case "number": {
      const value = typeof raw === "string" ? (raw.trim() === "" ? Number.NaN : Number(raw)) : raw;
      return typeof value === "number" && Number.isFinite(value) ? ok(value) : formatIssue();
    }
    case "text":
      return typeof raw === "string" ? ok(raw) : formatIssue();
    case "select":
    case "list":
    case "table":
      return ok(raw);
    case "secret": {
      const ref = parse(SecretRef, raw);
      return ref.ok ? ok(ref.value) : formatIssue();
    }
    case "readonly":
      return formatIssue();
    default:
      return assertNever(widget, "WidgetVM");
  }
}

/** 정의의 값 범위에 맞는 실패 문장. 열거형, 숫자 범위, 형식(pattern), 그 밖 순서다 */
export function invalidMessage(def: SettingDefWire | undefined): string {
  const range = def?.range;
  if (range?.enum !== undefined) return t("client.settings.field.invalidEnum");
  if (range?.min !== undefined && range.max !== undefined) {
    return t("client.settings.field.invalidRange", { min: range.min, max: range.max });
  }
  if (range?.min !== undefined) return t("client.settings.field.invalidMin", { min: range.min });
  if (range?.max !== undefined) return t("client.settings.field.invalidMax", { max: range.max });
  const minLength = def?.type["minLength"];
  const maxLength = def?.type["maxLength"];
  if (typeof minLength === "number" && typeof maxLength === "number" && minLength > 0) {
    return t("client.settings.field.invalidLength", { min: minLength, max: maxLength });
  }
  if (typeof maxLength === "number") {
    return t("client.settings.field.invalidMaxLength", { max: maxLength });
  }
  if (def !== undefined && Object.hasOwn(def.type, "pattern")) {
    return t("client.settings.field.format");
  }
  return t("client.settings.field.invalidValue");
}

/**
 * 값을 `toValueJsonSchema(def)`(type과 range를 합친 모양)로 검사한다. 서버 검사기와 같은 스키마를 같은 엔진으로 본다.
 * 잠금과 시크릿 값 거부의 최종 판정은 서버 몫이라 여기서 하지 않는다.
 */
export function checkClientValue(
  def: SettingDefWire,
  value: unknown,
): Result<unknown, readonly ValueIssue[]> {
  const [valid, errors] = Errors(toValueJsonSchema(def), value);
  if (valid) return ok(value);
  const message = invalidMessage(def);
  return err(errors.map((error) => ({ path: error.instancePath, message })));
}

/**
 * 보내기 전에 막아야 하는 사유: 잠김, 쓸 수 없는 범위. 막을 것이 없으면 null이다.
 * `session`에 해당하는 `launch` 범위는 열린 대화가 있을 때만 후보다(§4.3.6).
 */
export function blockedBy(
  def: SettingDefWire,
  setting: EffectiveSetting | undefined,
  scope: WritableScope | null,
  threadId: ThreadId | null,
): FieldError | null {
  if (setting?.locked === true)
    return { kind: "locked", message: t("client.settings.field.locked") };
  const writable = writableScopes(def, setting, threadId !== null);
  if (scope === null) {
    return {
      kind: "scopeNotAllowed",
      message: t("client.settings.field.noWritableScope"),
      allowed: writable,
    };
  }
  if (!writable.includes(scope)) {
    return {
      kind: "scopeNotAllowed",
      message: t("client.settings.field.scopeNotAllowed", { scope: scopeText(scope) }),
      allowed: writable,
    };
  }
  return null;
}

/** 초안을 `settings.set` 요청으로 바꾸거나 보내지 않을 사유로 바꾼다. 순수 함수다 */
export function planWrite(
  def: SettingDefWire,
  setting: EffectiveSetting | undefined,
  value: unknown,
  scope: WritableScope | null,
  threadId: ThreadId | null,
): WritePlan {
  const blocked = blockedBy(def, setting, scope, threadId);
  if (blocked !== null) return { kind: "blocked", error: blocked };
  if (scope === null) return { kind: "blocked", error: noWritableScopeError() };
  if (def.secret === true && !parse(SecretRef, value).ok) {
    return { kind: "blocked", error: secretValueError() };
  }
  const checked = checkClientValue(def, value);
  if (!checked.ok) {
    return {
      kind: "blocked",
      error: { kind: "invalidValue", message: invalidMessage(def), issues: checked.error },
    };
  }
  const params: WireParams<"settings.set"> =
    scope === "launch" && threadId !== null
      ? { key: def.key, value, scope, threadId }
      : { key: def.key, value, scope };
  return { kind: "send", params };
}

/** `settings.reset` 요청을 만들거나 막는다. 범위 검사는 쓰기와 같다 */
export function planReset(
  def: SettingDefWire,
  setting: EffectiveSetting | undefined,
  scope: WritableScope,
  threadId: ThreadId | null,
): ResetPlan {
  const blocked = blockedBy(def, setting, scope, threadId);
  if (blocked !== null) return { kind: "blocked", error: blocked };
  const params: WireParams<"settings.reset"> =
    scope === "launch" && threadId !== null
      ? { key: def.key, scope, threadId }
      : { key: def.key, scope };
  return { kind: "send", params };
}

function noWritableScopeError(): FieldError {
  return {
    kind: "scopeNotAllowed",
    message: t("client.settings.field.noWritableScope"),
    allowed: [],
  };
}

function secretValueError(): FieldError {
  return { kind: "secretValue", message: t("client.settings.field.secretValue") };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 오류 details에서 범위 이름을 읽는다. 없으면 빈 문자열이다 */
function scopeNameOf(details: Readonly<Record<string, unknown>>): string {
  const scope = details["scope"];
  return typeof scope === "string" ? scope : "";
}

function allowedScopesOf(details: Readonly<Record<string, unknown>>): readonly SettingScope[] {
  const parsed = parse(SettingScopesSchema, details["allowedScopes"]);
  return parsed.ok ? parsed.value : [];
}

function issuesOf(
  details: Readonly<Record<string, unknown>>,
  def: SettingDefWire | undefined,
): readonly ValueIssue[] {
  const parsed = parse(IssuesSchema, details["issues"]);
  if (!parsed.ok) return [];
  const message = invalidMessage(def);
  return parsed.value.map((issue) => ({ path: issue.path, message }));
}

/**
 * 데스크톱 로컬 저장소의 쓰기 실패를 필드 오류로 바꾼다. 엔진의 같은 종류와 같은 문장을 쓴다(L4.settings-ui §4.1.3 표).
 * 로컬 저장소에는 연결이 없으므로 다시 읽을 것이 없고, 뒤 처리는 `none`이다.
 */
export function localFieldError(
  def: SettingDefWire | undefined,
  failure: LocalWriteFailure,
): FieldError {
  if (failure.kind === "settings.invalidValue") {
    return {
      kind: "invalidValue",
      message: invalidMessage(def),
      issues: issuesOf(failure.details, def),
    };
  }
  if (failure.kind === "settings.unknownKey") {
    return { kind: "unknownKey", message: t("client.settings.field.unknownKey") };
  }
  return { kind: "internal", message: t("client.settings.field.internal"), traceId: null };
}

/**
 * `settings.set`·`settings.reset`의 실패를 필드 문장으로 바꾼다(L4.settings-ui §4.4.4).
 * 분기는 `data.kind`로 하고, 서버 `message`는 화면에 쓰지 않는다. 연결 실패처럼 WireError가 아닌 실패는 `transient`다.
 */
export function toFieldError(
  def: SettingDefWire | undefined,
  error: unknown,
): { readonly error: FieldError; readonly followUp: FollowUp } {
  if (!(error instanceof WireError)) {
    return {
      error: { kind: "transient", message: t("client.settings.field.transient") },
      followUp: "none",
    };
  }
  const data = error.data;
  const details: Readonly<Record<string, unknown>> = isRecord(data.details) ? data.details : {};
  // 종류는 열린 문자열이라 switch의 default로 닫지 않고 차례대로 본다. 모르는 종류는 `internal`이다
  if (data.kind === "settings.invalidValue") {
    return {
      error: {
        kind: "invalidValue",
        message: invalidMessage(def),
        issues: issuesOf(details, def),
      },
      followUp: "none",
    };
  }
  if (data.kind === "settings.scopeNotAllowed") {
    const scope = scopeText(scopeNameOf(details));
    const allowed = allowedScopesOf(details);
    if (details["reason"] === "workspaceRequired") {
      return {
        error: {
          kind: "scopeNotAllowed",
          message: t("client.settings.field.scopeNoWorkspace", { scope }),
          allowed,
        },
        followUp: "none",
      };
    }
    return {
      error: {
        kind: "scopeNotAllowed",
        message: t("client.settings.field.scopeNotAllowed", { scope }),
        allowed,
      },
      followUp: "reloadCatalog",
    };
  }
  if (data.kind === "settings.locked") {
    return {
      error: { kind: "locked", message: t("client.settings.field.locked") },
      followUp: "refreshValue",
    };
  }
  if (data.kind === "settings.secretValue") {
    return { error: secretValueError(), followUp: "none" };
  }
  if (data.kind === "settings.unknownKey") {
    return {
      error: { kind: "unknownKey", message: t("client.settings.field.unknownKey") },
      followUp: "reloadCatalog",
    };
  }
  if (data.kind === "host.shuttingDown" || data.kind === "request.cancelled") {
    return {
      error: { kind: "transient", message: t("client.settings.field.transient") },
      followUp: "none",
    };
  }
  const traceId = data.traceId ?? null;
  return {
    error: {
      kind: "internal",
      message:
        traceId === null
          ? t("client.settings.field.internal")
          : t("client.settings.field.internalTrace", { traceId }),
      traceId,
    },
    followUp: "none",
  };
}
