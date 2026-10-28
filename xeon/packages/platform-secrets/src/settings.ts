import { Type } from "typebox";
import { SecretProviderIdSchema } from "@xeon/contracts/capabilities";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";
import { DEFAULT_SECRETS_CONFIG } from "./config.ts";

// L0.secrets.spec §6.1. 모두 layer L0, since 0.1.0이다. 비밀 값을 담는 키는 없다(D2, D3).
// project, local, session 범위는 받지 않는다: 저장소 안 파일이 비밀 정책을 넓히지 못하게 한다.
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
    ui: { tab: "secrets", widget: "list", order: 10, label: "비밀 제공자 목록" },
    since: "0.1.0",
  },
  defaultProvider: {
    type: Type.String({ maxLength: 32 }),
    default: DEFAULTS.defaultProvider,
    range: { enum: PROVIDER_IDS },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "select", order: 20, label: "기본 비밀 제공자" },
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
      label: "SOPS 파일",
      help: "환경 이름과 절대 경로의 쌍",
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
      label: "sops 실행 파일",
      help: "비우면 xeon.os가 찾는다",
    },
    since: "0.1.0",
  },
  "ageKey.source": {
    type: Type.String({ maxLength: 16 }),
    default: DEFAULTS.ageKey.source,
    range: { enum: ["auto", "auto-file", "keychain", "file"] },
    runtimeChange: "restart",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "select", order: 40, label: "age 키 위치" },
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
      label: "age 키 파일 경로",
      help: "비우면 설정 디렉터리의 secrets/age/keys.txt",
    },
    since: "0.1.0",
  },
  "approval.default": {
    type: Type.String({ maxLength: 16 }),
    default: DEFAULTS.approval.default,
    range: { enum: ["none", "per-session", "per-use"] },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "permissions", widget: "select", order: 200, label: "비밀 사용 승인 기본값" },
    since: "0.1.0",
  },
  "approval.writeHosts": {
    type: Type.String({ maxLength: 16 }),
    default: DEFAULTS.approval.writeHosts,
    range: { enum: ["per-session", "per-use"] },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "permissions", widget: "select", order: 210, label: "쓰기 호스트 승인" },
    since: "0.1.0",
  },
  "lease.ttlSeconds": {
    type: Type.Integer(),
    default: DEFAULTS.lease.ttlSeconds,
    range: { min: 1, max: 86_400 },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "number", order: 60, label: "비밀 임대 시간", unit: "초" },
    since: "0.1.0",
  },
  "lease.maxUses": {
    type: Type.Integer(),
    default: DEFAULTS.lease.maxUses,
    range: { min: 1, max: 100_000 },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "number", order: 70, label: "임대당 최대 사용 횟수", unit: "회" },
    since: "0.1.0",
  },
  "redaction.enabled": {
    // 끄는 값을 거부한다(spec §6.1): true만 허용하는 리터럴이다. 화면은 읽기 전용으로 "마스킹 켜짐(보조 수단)"을 보인다.
    type: Type.Literal(true),
    default: DEFAULTS.redaction.enabled,
    runtimeChange: "restart",
    allowedScopes: ["managed"],
    ui: { tab: "secrets", widget: "readonly", order: 80, label: "출력 마스킹(보조 수단)" },
    since: "0.1.0",
  },
  "audit.retentionDays": {
    type: Type.Integer(),
    default: DEFAULTS.audit.retentionDays,
    range: { min: 1, max: 3650 },
    runtimeChange: "live",
    allowedScopes: MANAGED_USER,
    ui: { tab: "secrets", widget: "number", order: 90, label: "감사 기록 보관", unit: "일" },
    since: "0.1.0",
  },
});

/** `l0.secrets.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const SECRETS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
