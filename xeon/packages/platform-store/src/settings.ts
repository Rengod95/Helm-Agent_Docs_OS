import { isAbsolute } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { StoreSettings } from "./types.ts";

/** l0.store.* 기본값(L0.store.spec §6) */
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  heartbeatMs: 5000,
  leaseTtlMs: 30_000,
  busyTimeoutMs: 5000,
  blobGraceMs: 86_400_000,
  requireFts5: false,
  macFullFsync: true,
  customSqlitePath: null,
};

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
 * 범위와 `leaseTtlMs >= 3 * heartbeatMs` 관계를 검사한다. defineSettings 선언은 typebox 의존이 이 패키지에 없어
 * 아직 두지 않았다(openIssues).
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
  const flag = (name: "requireFts5" | "macFullFsync", fallback: boolean): boolean => {
    const value = input[name];
    if (value === undefined) return fallback;
    if (typeof value === "boolean") return value;
    issues.push({ name, message: "must be a boolean" });
    return fallback;
  };
  const requireFts5 = flag("requireFts5", DEFAULT_STORE_SETTINGS.requireFts5);
  const macFullFsync = flag("macFullFsync", DEFAULT_STORE_SETTINGS.macFullFsync);
  const path = input["customSqlitePath"];
  let customSqlitePath: string | null = DEFAULT_STORE_SETTINGS.customSqlitePath;
  if (path !== undefined && path !== null) {
    if (typeof path === "string" && isAbsolute(path)) customSqlitePath = path;
    else issues.push({ name: "customSqlitePath", message: "must be an absolute path or null" });
  }
  if (issues.length > 0) return err(issues);
  return ok({ ...integers, requireFts5, macFullFsync, customSqlitePath });
}
