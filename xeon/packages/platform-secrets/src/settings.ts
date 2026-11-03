import { Type } from "typebox";
import { SecretProviderIdSchema } from "@fresnel/contracts/capabilities";
import { defineSettings, type SettingDef } from "@fresnel/contracts/settings";
import { DEFAULT_SECRETS_CONFIG } from "./config.ts";

// L0.secrets.spec §6.1. 모두 layer L0, since 0.1.0이다. 시크릿 값을 담는 키는 없다(D2, D3).
// project, local, session 범위는 받지 않는다: 저장소 안 파일이 시크릿 정책을 넓히지 못하게 한다.
// 기본값은 config.ts의 DEFAULT_SECRETS_CONFIG 한 곳에서 가져온다(BP-06).

const PROVIDER_IDS = ["sops", "op", "bws", "keychain"];
const MANAGED_USER = ["managed", "user"] as const;
const DEFAULTS = DEFAULT_SECRETS_CONFIG;

const group = defineSettings("l0.secrets", {
  providers: {
    type: Type.Array(SecretProviderIdSchema, { minItems: 1, maxItems: 8, uniqueItems: true }),
    default: [...DEFAULTS.providers],
    runtimeChange: "restart",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "list", order: 10, label: "Secret provider list" },
    since: "0.1.0",
  },
  defaultProvider: {
    type: Type.String({ maxLength: 32 }),
    default: DEFAULTS.defaultProvider,
    range: { enum: PROVIDER_IDS },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "select", order: 20, label: "Default secret provider" },
    since: "0.1.0",
  },
  "sops.files": {
    type: Type.Array(
      Type.Object(
        {
          env: Type.String({ minLength: 1, maxLength: 64 }),
          path: Type.String({ minLength: 1, maxLength: 4096 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    default: [],
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: {
      tab: "secrets",
      widget: "table",
      order: 30,
      label: "SOPS files",
      help: "Pairs of environment name and absolute path",
    },
    since: "0.1.0",
  },
  "sops.binary": {
    type: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
    default: DEFAULTS.sops.binary,
    runtimeChange: "restart",
    allowedScopes: MANAGED_USER,
    ui: {
      tab: "advanced",
      widget: "text",
      order: 340,
      label: "sops executable",
      help: "Leave empty to let fresnel.os find it",
    },
    since: "0.1.0",
  },
  "ageKey.source": {
    type: Type.String({ maxLength: 16 }),
    default: DEFAULTS.ageKey.source,
    range: { enum: ["auto", "auto-file", "keychain", "file"] },
    runtimeChange: "restart",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "select", order: 40, label: "age key location" },
    since: "0.1.0",
  },
  "ageKey.filePath": {
    type: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
    default: DEFAULTS.ageKey.filePath,
    runtimeChange: "restart",
    allowedScopes: MANAGED_USER,
    ui: {
      tab: "secrets",
      widget: "text",
      order: 50,
      label: "age key file path",
      help: "Leave empty to use secrets/age/keys.txt in the config directory",
    },
    since: "0.1.0",
  },
  "approval.default": {
    type: Type.String({ maxLength: 16 }),
    default: DEFAULTS.approval.default,
    range: { enum: ["none", "per-session", "per-use"] },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: {
      tab: "permissions",
      widget: "select",
      order: 200,
      label: "Default approval for secret use",
    },
    since: "0.1.0",
  },
  "approval.writeHosts": {
    type: Type.String({ maxLength: 16 }),
    default: DEFAULTS.approval.writeHosts,
    range: { enum: ["per-session", "per-use"] },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "permissions", widget: "select", order: 210, label: "Write host approval" },
    since: "0.1.0",
  },
  "lease.ttlSeconds": {
    type: Type.Integer(),
    default: DEFAULTS.lease.ttlSeconds,
    range: { min: 1, max: 86_400 },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "number", order: 60, label: "Secret lease duration", unit: "s" },
    since: "0.1.0",
  },
  "lease.maxUses": {
    type: Type.Integer(),
    default: DEFAULTS.lease.maxUses,
    range: { min: 1, max: 100_000 },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "number", order: 70, label: "Max uses per lease", unit: "uses" },
    since: "0.1.0",
  },
  "redaction.enabled": {
    // 끄는 값을 거부한다(spec §6.1): true만 허용하는 리터럴이다. 화면은 읽기 전용으로 "마스킹 켜짐(보조 수단)"을 보인다.
    type: Type.Literal(true),
    default: DEFAULTS.redaction.enabled,
    runtimeChange: "restart",
    allowedScopes: ["managed"],
    ui: { tab: "secrets", widget: "readonly", order: 80, label: "Output masking (supplementary)" },
    since: "0.1.0",
  },
  "audit.retentionDays": {
    type: Type.Integer(),
    default: DEFAULTS.audit.retentionDays,
    range: { min: 1, max: 3650 },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "number", order: 90, label: "Audit log retention", unit: "days" },
    since: "0.1.0",
  },
});

/** `l0.secrets.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const SECRETS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
