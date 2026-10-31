import type {
  EffectiveSetting,
  RuntimeChange,
  SettingDefWire,
  SettingKey,
  SettingLockReason,
  SettingSource,
} from "@xeon/contracts/settings";
import { t, type MessageId } from "../i18n/index.ts";
import type {
  BadgeScope,
  DeprecatedVM,
  LockInfo,
  RuntimeBadge,
  ScopeBadge,
  WritableScope,
} from "./types.ts";

// 항목 공통 배지와 잠금 문구(L4.settings-ui §4.3, §4.8.3). 글자는 색과 함께 쓴다(§4.8.1).

// 배지 글자는 id로 들고 있다가 쓸 때 현재 로케일로 만든다(모듈이 읽힐 때의 로케일에 묶이지 않게 한다)
const SCOPE_TEXT_ID: Readonly<Record<BadgeScope, MessageId>> = {
  managed: "client.settings.scope.managed",
  user: "client.settings.scope.user",
  project: "client.settings.scope.project",
  local: "client.settings.scope.local",
  session: "client.settings.scope.session",
  default: "client.settings.scope.default",
};

const RUNTIME_TEXT_ID: Readonly<Record<RuntimeChange, MessageId>> = {
  live: "client.settings.runtime.live",
  nextTurn: "client.settings.runtime.nextTurn",
  restart: "client.settings.runtime.restart",
};

const PENDING_TEXT_ID: Readonly<Record<"nextTurn" | "restart", MessageId>> = {
  nextTurn: "client.settings.pending.nextTurn",
  restart: "client.settings.pending.restart",
};

/** 기본 쓰기 범위의 우선순위(§4.3.6 규칙 4) */
const DEFAULT_SCOPE_ORDER: readonly WritableScope[] = ["user", "project", "local", "session"];

export function scopeBadge(source: SettingSource): ScopeBadge {
  return { scope: source.scope, text: t(SCOPE_TEXT_ID[source.scope]), tone: source.scope };
}

export function runtimeBadgeOf(
  change: RuntimeChange,
  pendingUntil: "nextTurn" | "restart" | null,
): RuntimeBadge {
  return {
    change,
    text: t(RUNTIME_TEXT_ID[change]),
    pending: pendingUntil,
    pendingText: pendingUntil === null ? null : t(PENDING_TEXT_ID[pendingUntil]),
  };
}

export function runtimeBadge(setting: EffectiveSetting): RuntimeBadge {
  return runtimeBadgeOf(setting.runtimeChange, setting.pendingUntil);
}

/**
 * 잠금 문구. 사유 값이 없으면 `managed_file`이다. 종류에 없는 사유 문구는 만들지 않는다(§4.8.3).
 * `managed_policy`는 파일 밖 수단이라 경로 자리가 없다.
 */
export function lockInfo(setting: EffectiveSetting): LockInfo | null {
  if (!setting.locked) return null;
  const reason: SettingLockReason = setting.lockReason ?? "managed_file";
  if (reason === "managed_policy") {
    return { reason, path: null, text: t("client.settings.lock.managedPolicy") };
  }
  const path = setting.source.path ?? null;
  return {
    reason,
    path,
    text:
      path === null
        ? t("client.settings.lock.managedFile")
        : t("client.settings.lock.managedFilePath", { path }),
  };
}

/** 폐기 정보. 대체 키의 라벨은 같은 카탈로그에서 찾는다 */
export function deprecatedInfo(
  def: SettingDefWire,
  catalog: ReadonlyMap<SettingKey, SettingDefWire>,
): DeprecatedVM | null {
  const deprecation = def.deprecated;
  if (deprecation === undefined) return null;
  const replacedBy = deprecation.replacedBy ?? null;
  const replacement = replacedBy === null ? undefined : catalog.get(replacedBy);
  return {
    since: deprecation.since,
    replacedBy,
    replacedByLabel: replacement?.ui?.label ?? null,
    note: deprecation.note ?? null,
  };
}

function isWritableScope(scope: string): scope is WritableScope {
  return scope !== "managed";
}

/**
 * 쓰기 범위 후보(§4.3.6). `managed`는 뺀다. 잠겼으면 없다. 대화가 없으면 `session`을 뺀다.
 * 정의의 허용 순서를 유지한다.
 */
export function writableScopes(
  def: SettingDefWire,
  setting: EffectiveSetting | undefined,
  hasThread: boolean,
): readonly WritableScope[] {
  if (setting?.locked === true) return [];
  return def.allowedScopes
    .filter(isWritableScope)
    .filter((scope) => scope !== "session" || hasThread);
}

/** 기본 쓰기 범위: user, 없으면 project, local, session 순의 첫 값. 후보가 없으면 null */
export function defaultWriteScope(scopes: readonly WritableScope[]): WritableScope | null {
  return DEFAULT_SCOPE_ORDER.find((scope) => scopes.includes(scope)) ?? null;
}
