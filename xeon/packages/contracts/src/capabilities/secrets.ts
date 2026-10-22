import {
  Type,
  type Static,
  type TAddOptional,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import { Bug, err, ok, parse, type Brand, type Result } from "../base/index.ts";

// ── 참조 형식 (F.capabilities.spec §3.10) ───────────────────────────────

/** 비밀 이름. 소문자로 시작, 소문자·숫자·하이픈 2~64자 */
export const SECRET_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,63}$";
/** 비밀 참조. "secret://<이름>" */
export const SECRET_REF_PATTERN: string = "^secret://[a-z][a-z0-9-]{1,63}$";

/** 검사를 통과한 비밀 이름 */
export type SecretName = Brand<string, "SecretName">;
export type SecretRef = `secret://${string}`;
/** 검사를 통과한 비밀 참조. 런타임 모양은 SecretRef("secret://<name>")와 같다 */
export type SecretHandle = Brand<string, "SecretHandle">;

/**
 * 문자열을 SecretName으로 바꾸는 길은 parseSecretRef와 이 스키마의 parse 둘뿐이다.
 * 스펙은 TString이라 적었지만, 검사 없는 string 대입이 타입 오류가 되도록 브랜드 타입을 싣는다(U-08, 수용 기준 17).
 */
export const SecretNameSchema: TUnsafe<SecretName> = Type.Unsafe<SecretName>(
  Type.String({ pattern: SECRET_NAME_PATTERN, maxLength: 64 }),
);
/** 비밀 참조 문자열 스키마. 설정 키의 값 형식이다(F.wire-settings.spec §3.8.1). */
export const SecretRef: TString = Type.String({ pattern: SECRET_REF_PATTERN, maxLength: 75 });
/** 검사를 통과한 비밀 참조를 SecretHandle로 들이는 스키마 */
export const SecretHandleSchema: TUnsafe<SecretHandle> = Type.Unsafe<SecretHandle>(
  Type.String({ pattern: SECRET_REF_PATTERN, maxLength: 75 }),
);

/** 참조 구문 오류. 거부 규칙 표는 L0.secrets.spec §3.1이다 */
export type SecretRefError =
  | { readonly kind: "invalid_ref"; readonly reason: "scheme" | "name_pattern" | "trailing" }
  | {
      readonly kind: "unsupported_ref_syntax";
      readonly syntax: "env_var" | "template" | "percent" | "provider_uri";
    };

const SECRET_PREFIX = "secret://";
const NAME_REGEX = new RegExp(SECRET_NAME_PATTERN);

type ForeignSyntax = "env_var" | "template" | "percent" | "provider_uri";

/** 문자열 전체가 다른 비밀 구문인가 */
function wholeForeignSyntax(input: string): ForeignSyntax | undefined {
  if (/^\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/.test(input)) return "env_var";
  if (/^\{\{.*\}\}$/s.test(input)) return "template";
  if (/^%[^%\s]+%$/.test(input)) return "percent";
  if (/^(?:op|bws|sops|keychain|vault):/.test(input)) return "provider_uri";
  if (/^(?:http|https|file):\/\//.test(input)) return "provider_uri";
  return undefined;
}

/**
 * 순수 함수. 문자열 하나가 비밀 참조이면 핸들과 이름을 돌려준다.
 * 같은 입력에 같은 결과를 낸다. SecretName/SecretHandle은 검증(parse)을 거쳐서만 만든다.
 */
export function parseSecretRef(
  input: string,
): Result<{ readonly handle: SecretHandle; readonly name: SecretName }, SecretRefError> {
  const foreign = wholeForeignSyntax(input);
  if (foreign !== undefined) return err({ kind: "unsupported_ref_syntax", syntax: foreign });
  if (!input.startsWith(SECRET_PREFIX)) return err({ kind: "invalid_ref", reason: "scheme" });

  const rest = input.slice(SECRET_PREFIX.length);
  const cut = rest.search(/[/?#]/);
  const candidate = cut === -1 ? rest : rest.slice(0, cut);
  if (!NAME_REGEX.test(candidate)) return err({ kind: "invalid_ref", reason: "name_pattern" });
  if (cut !== -1) return err({ kind: "invalid_ref", reason: "trailing" });

  const name = parse(SecretNameSchema, candidate);
  const handle = parse(SecretHandleSchema, input);
  if (!name.ok || !handle.ok) {
    throw new Bug("parseSecretRef: a validated reference failed branding");
  }
  return ok({ handle: handle.value, name: name.value });
}

/** 순수 함수. secretRef("exa-key") → "secret://exa-key". 이름 규칙 위반은 호출 결함이므로 Bug를 던진다 */
export function secretRef(name: string): SecretHandle {
  const parsed = parseSecretRef(`${SECRET_PREFIX}${name}`);
  if (!parsed.ok) throw new Bug(`secretRef: "${name}" is not a valid secret name`);
  return parsed.value.handle;
}

const FOREIGN_SCANNERS: readonly (readonly [ForeignSyntax, RegExp])[] = [
  ["env_var", /\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/],
  ["template", /\{\{[^{}]*\}\}/],
  ["percent", /%[A-Za-z0-9_-]+%/],
  ["provider_uri", /\b(?:op|bws|keychain|vault):\/\/\S|\bsops:[\w./-]+/],
];

/**
 * 순수 함수. 입력 단계 검사. 문자열 안의 다른 비밀 구문($VAR, {{…}}, %…%, op:// 등)을 찾아 거부 사유를 돌려준다.
 * 종류마다 한 번만, env_var → template → percent → provider_uri 순으로 낸다.
 */
export function findForeignSecretSyntax(text: string): readonly SecretRefError[] {
  const found: SecretRefError[] = [];
  for (const [syntax, scanner] of FOREIGN_SCANNERS) {
    if (scanner.test(text)) found.push({ kind: "unsupported_ref_syntax", syntax });
  }
  return found;
}

// ── 메타 (L0.secrets.spec §3.2) ─────────────────────────────────────────

export const SecretUseModeSchema: TUnion<
  [TLiteral<"env">, TLiteral<"sentinel">, TLiteral<"runtime-http">, TLiteral<"browser-input">]
> = Type.Union([
  // 주석의 "사용 모드 Mn"은 모드 번호이고 "마일스톤 Mn"은 구현 시기다(F.capabilities.spec §3.10, L0.secrets.spec §4.3)
  Type.Literal("env"), // 사용 모드 M1. 마일스톤 M1: bash 도구 env 주입, 실행마다 승인(review.decisions-2 U-19)
  Type.Literal("sentinel"), // 사용 모드 M2. 구현은 후속
  // 사용 모드 M3. 마일스톤 M1: 모델 provider 키를 core-models의 프로세스 안 HTTP 클라이언트에 lease(review.decisions-2 B-05)
  Type.Literal("runtime-http"),
  Type.Literal("browser-input"), // 사용 모드 M4. 마일스톤 M2
]);
export type SecretUseMode = Static<typeof SecretUseModeSchema>;

/** 1차 내장은 sops. op·bws·keychain은 2차 플러그인 */
export const SecretProviderIdSchema: TUnion<
  [TLiteral<"sops">, TLiteral<"op">, TLiteral<"bws">, TLiteral<"keychain">]
> = Type.Union([
  Type.Literal("sops"),
  Type.Literal("op"),
  Type.Literal("bws"),
  Type.Literal("keychain"),
]);
export type SecretProviderId = Static<typeof SecretProviderIdSchema>;

export const SecretApprovalSchema: TUnion<
  [TLiteral<"none">, TLiteral<"per-session">, TLiteral<"per-use">]
> = Type.Union([Type.Literal("none"), Type.Literal("per-session"), Type.Literal("per-use")]);
export type SecretApproval = Static<typeof SecretApprovalSchema>;

export type SecretScope = "user" | `project:${string}`;
export const SecretScopeSchema: TUnsafe<SecretScope> = Type.Unsafe<SecretScope>(
  Type.String({ pattern: "^(?:user|project:.+)$", maxLength: 256 }),
);

export const SecretUsePolicySchema: TObject<{
  modes: TArray<typeof SecretUseModeSchema>;
  tools: TArray<TString>;
  hosts: TArray<TString>;
  origins: TAddOptional<TArray<TString>>;
  commands: TAddOptional<TArray<TString>>;
}> = Type.Object(
  {
    /** 빈 배열 = 사용 불가 */
    modes: Type.Array(SecretUseModeSchema, { uniqueItems: true, maxItems: 4 }),
    /** "http.request", "bash:gh", "web.search" */
    tools: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 256 }),
    /** runtime-http, sentinel. "api.github.com", "*.example.com" */
    hosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 256 }),
    /** browser-input */
    origins: Type.Optional(
      Type.Array(Type.String({ pattern: "^https://[^/]+$", maxLength: 300 }), { maxItems: 256 }),
    ),
    /** env에서만. "gh api *" */
    commands: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 256 }),
    ),
  },
  { additionalProperties: false },
);
export interface SecretUsePolicy {
  readonly modes: readonly SecretUseMode[];
  readonly tools: readonly string[];
  readonly hosts: readonly string[];
  readonly origins?: readonly string[];
  readonly commands?: readonly string[];
}

export const SecretMetaSchema: TObject<{
  name: typeof SecretNameSchema;
  desc: TString;
  provider: typeof SecretProviderIdSchema;
  ref: TString;
  scope: typeof SecretScopeSchema;
  expiresAt: TUnion<[TString, TNull]>;
  use: typeof SecretUsePolicySchema;
  approval: typeof SecretApprovalSchema;
  ttlSeconds: TInteger;
  maxUses: TInteger;
}> = Type.Object(
  {
    name: SecretNameSchema,
    desc: Type.String({ minLength: 1, maxLength: 500 }),
    provider: SecretProviderIdSchema,
    /** 제공자 안의 위치. sops는 "<env>/<KEY>" */
    ref: Type.String({ minLength: 1, maxLength: 512 }),
    scope: SecretScopeSchema,
    expiresAt: Type.Union([Type.String({ format: "date", maxLength: 10 }), Type.Null()]),
    use: SecretUsePolicySchema,
    approval: SecretApprovalSchema,
    ttlSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
    maxUses: Type.Integer({ minimum: 1, maximum: 100_000 }),
  },
  { additionalProperties: false },
);
export interface SecretMeta {
  readonly name: SecretName;
  readonly desc: string;
  readonly provider: SecretProviderId;
  readonly ref: string;
  readonly scope: SecretScope;
  readonly expiresAt: string | null;
  readonly use: SecretUsePolicy;
  readonly approval: SecretApproval;
  readonly ttlSeconds: number;
  readonly maxUses: number;
}

// ── 마스킹 결과와 감사 레코드 (L0.secrets.spec §3.5, §3.9) ───────────────

export interface RedactionHit {
  /** "known:<name>" | 접두 패턴 kind("github_pat", "jwt", …) | "kv" */
  readonly kind: string;
  readonly count: number;
}
export type RedactionLayer =
  | "human-input"
  | "tool-result"
  | "outbound"
  | "model-projection"
  | "ops-log";
export type SecretDenyReason =
  | "host_mismatch"
  | "origin_mismatch"
  | "command_mismatch"
  | "approval_missing"
  | "expired"
  | "lease_expired"
  | "lease_exhausted"
  | "mode_not_allowed"
  | "tool_not_allowed"
  | "scope_mismatch";
/** 사람 재확인 방법. tty-confirm은 OS 인증 재확인을 쓸 수 없는 터미널(CLI reveal 전용) */
export type ReauthMethod = "os-auth" | "passphrase" | "tty-confirm";

/** 값, 값의 일부, 값의 해시를 싣지 않는다. commandHash는 명령줄 문자열의 SHA-256 hex 앞 16자 */
export type SecretAuditRecord =
  | {
      readonly type: "secret.used";
      readonly handle: SecretHandle;
      readonly mode: SecretUseMode;
      readonly toolCallId: string | null;
      readonly threadId: string | null;
      readonly host: string | null;
      readonly commandHash: string | null;
      readonly decision: "allow";
      readonly leaseId: string;
      readonly at: number;
    }
  | {
      readonly type: "secret.denied";
      readonly handle: SecretHandle;
      readonly mode: SecretUseMode;
      readonly reason: SecretDenyReason;
      readonly purpose: string;
      readonly toolCallId: string | null;
      readonly threadId: string | null;
      readonly at: number;
    }
  | {
      readonly type: "secret.approved";
      readonly handle: SecretHandle;
      readonly scope: "per-session" | "per-use";
      readonly approvalId: string;
      readonly expiresAt: number | null;
      readonly threadId: string | null;
      readonly at: number;
    }
  | {
      readonly type: "secret.created" | "secret.updated" | "secret.deleted" | "secret.rotated";
      readonly handle: SecretHandle;
      readonly fields: readonly string[];
      readonly actor: "human";
      readonly at: number;
    }
  | {
      readonly type: "secret.revealed";
      readonly handle: SecretHandle;
      readonly reauth: ReauthMethod;
      readonly actor: "human";
      readonly at: number;
    }
  | {
      readonly type: "secret.masked";
      readonly hits: readonly RedactionHit[];
      readonly layer: RedactionLayer;
      readonly threadId: string | null;
      readonly at: number;
    };
