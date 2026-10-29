import { isAbsolute } from "node:path";
import { Type } from "typebox";
import { err, ok, type Result } from "@xeon/contracts";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";
import type { StoreSettings } from "./types.ts";

/** l0.store.* 기본값(L0.store.spec §6) */
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  heartbeatMs: 5000,
  leaseTtlMs: 30_000,
  busyTimeoutMs: 5000,
  blobGraceMs: 86_400_000,
  blobGcEnabled: false,
  requireFts5: false,
  macFullFsync: true,
  customSqlitePath: null,
};

// L0.store.spec §6. 모두 layer L0, since 0.1.0이고 project·local·session 범위는 받지 않는다(DB는 사용자 단위 자원).
// leaseTtlMs >= 3 * heartbeatMs 관계는 키 하나의 범위로 적을 수 없어 resolveStoreSettings가 검사한다.
const group = defineSettings("l0.store", {
  heartbeatMs: {
    type: Type.Integer(),
    default: DEFAULT_STORE_SETTINGS.heartbeatMs,
    range: { min: 1000, max: 60_000 },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "number", order: 300, label: "임대 하트비트 주기", unit: "ms" },
    since: "0.1.0",
  },
  leaseTtlMs: {
    type: Type.Integer(),
    default: DEFAULT_STORE_SETTINGS.leaseTtlMs,
    range: { min: 3000, max: 600_000 },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "advanced",
      widget: "number",
      order: 310,
      label: "임대 만료 시간",
      help: "하트비트 주기의 3배 이상이어야 한다",
      unit: "ms",
    },
    since: "0.1.0",
  },
  busyTimeoutMs: {
    type: Type.Integer(),
    default: DEFAULT_STORE_SETTINGS.busyTimeoutMs,
    range: { min: 0, max: 60_000 },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    since: "0.1.0",
  },
  blobGraceMs: {
    type: Type.Integer(),
    default: DEFAULT_STORE_SETTINGS.blobGraceMs,
    range: { min: 600_000, max: 2_592_000_000 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "sessions",
      widget: "number",
      order: 300,
      label: "미참조 블롭 보존 시간",
      unit: "ms",
    },
    since: "0.1.0",
  },
  // 기본 끔. 블롭 소비자 가운데 아직 pinBlob을 쓰지 않는 곳이 있어(L0.store.spec §6 [미결]) 켜면 참조 없는 블롭을 지울 수 있다
  blobGcEnabled: {
    type: Type.Boolean(),
    default: DEFAULT_STORE_SETTINGS.blobGcEnabled,
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "sessions",
      widget: "toggle",
      order: 305,
      label: "미참조 블롭 정리 켜기",
      help: "모든 블롭 소비자가 블롭을 고정한 뒤에만 켠다",
    },
    since: "0.1.0",
  },
  requireFts5: {
    type: Type.Boolean(),
    default: DEFAULT_STORE_SETTINGS.requireFts5,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "toggle", order: 320, label: "FTS5 필수" },
    since: "0.1.0",
  },
  macFullFsync: {
    type: Type.Boolean(),
    default: DEFAULT_STORE_SETTINGS.macFullFsync,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "advanced",
      widget: "toggle",
      order: 330,
      label: "macOS 전체 fsync",
      help: "macOS에서만 의미가 있다",
    },
    since: "0.1.0",
  },
  customSqlitePath: {
    type: Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()]),
    default: DEFAULT_STORE_SETTINGS.customSqlitePath,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    since: "0.1.0",
  },
});

/** `l0.store.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const STORE_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

export interface StoreSettingIssue {
  /** l0.store. 뒤의 이름 */
  readonly name: string;
  readonly message: string;
}

interface IntegerRule {
  readonly name: "heartbeatMs" | "leaseTtlMs" | "busyTimeoutMs" | "blobGraceMs";
  readonly min: number;
  readonly max: number;
}

const INTEGER_RULES: readonly IntegerRule[] = [
  { name: "heartbeatMs", min: 1000, max: 60_000 },
  { name: "leaseTtlMs", min: 3000, max: 600_000 },
  { name: "busyTimeoutMs", min: 0, max: 60_000 },
  { name: "blobGraceMs", min: 600_000, max: 2_592_000_000 },
];

/**
 * 설정 계층이 합친 값(`l0.store.` 뒤 이름을 키로 한 객체)을 StoreSettings로 검증한다. 없는 키는 기본값이다.
 * 범위와 `leaseTtlMs >= 3 * heartbeatMs` 관계를 검사한다. 키 선언은 위 STORE_SETTING_DEFS다.
 */
export function resolveStoreSettings(
  input: Readonly<Record<string, unknown>>,
): Result<StoreSettings, readonly StoreSettingIssue[]> {
  const issues: StoreSettingIssue[] = [];
  const integers: Record<IntegerRule["name"], number> = {
    heartbeatMs: DEFAULT_STORE_SETTINGS.heartbeatMs,
    leaseTtlMs: DEFAULT_STORE_SETTINGS.leaseTtlMs,
    busyTimeoutMs: DEFAULT_STORE_SETTINGS.busyTimeoutMs,
    blobGraceMs: DEFAULT_STORE_SETTINGS.blobGraceMs,
  };
  for (const rule of INTEGER_RULES) {
    const value = input[rule.name];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      issues.push({ name: rule.name, message: "must be an integer" });
    } else if (value < rule.min || value > rule.max) {
      issues.push({ name: rule.name, message: `must be between ${rule.min} and ${rule.max}` });
    } else {
      integers[rule.name] = value;
    }
  }
  if (integers.leaseTtlMs < integers.heartbeatMs * 3) {
    issues.push({ name: "leaseTtlMs", message: "must be at least three times heartbeatMs" });
  }
  const flag = (
    name: "requireFts5" | "macFullFsync" | "blobGcEnabled",
    fallback: boolean,
  ): boolean => {
    const value = input[name];
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    issues.push({ name, message: "must be a boolean" });
    return fallback;
  };
  const blobGcEnabled = flag("blobGcEnabled", DEFAULT_STORE_SETTINGS.blobGcEnabled);
  const requireFts5 = flag("requireFts5", DEFAULT_STORE_SETTINGS.requireFts5);
  const macFullFsync = flag("macFullFsync", DEFAULT_STORE_SETTINGS.macFullFsync);
  const path = input["customSqlitePath"];
  let customSqlitePath: string | null = DEFAULT_STORE_SETTINGS.customSqlitePath;
  if (path !== undefined && path !== null) {
    if (typeof path === "string" && isAbsolute(path)) customSqlitePath = path;
    else issues.push({ name: "customSqlitePath", message: "must be an absolute path or null" });
  }
  if (issues.length > 0) return err(issues);
  return ok({ ...integers, blobGcEnabled, requireFts5, macFullFsync, customSqlitePath });
}
