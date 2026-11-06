import type { Locale, MessageArgs, MessageId } from "@fresnel/client/i18n";
import type { UsageLimitAction } from "@fresnel/client";
import type { UsageUnit, UsageWindow } from "@fresnel/contracts/wire";
import type { RoleId } from "./providers-model.ts";

// 계정과 제공자 화면(P-11)의 문장 고르기. 문장은 메시지 키로 들고 있다가 그릴 때 `t()`로 만든다.

const ROLE_ID: Readonly<Record<RoleId, MessageId>> = {
  main: "desktop.providers.role.main",
  review: "desktop.providers.role.review",
  summary: "desktop.providers.role.summary",
  subagent: "desktop.providers.role.subagent",
  judge: "desktop.providers.role.judge",
  search: "desktop.providers.role.search",
};

export function roleIdOf(role: RoleId): MessageId {
  return ROLE_ID[role];
}

const ON_LIMIT_ID: Readonly<Record<UsageLimitAction, MessageId>> = {
  wait: "desktop.providers.onLimit.wait",
  switch: "desktop.providers.onLimit.switch",
  fail: "desktop.providers.onLimit.fail",
};

export function onLimitIdOf(action: UsageLimitAction): MessageId {
  return ON_LIMIT_ID[action];
}

/** 입력 칸 이름의 문장 키. 검사에서 떨어진 칸을 가리킨다 */
export type FieldName =
  | "provider"
  | "accountId"
  | "credential"
  | "priority"
  | "reservePct"
  | "minIntervalMs"
  | "onLimit"
  | "maxWaitMs"
  | "model";

const FIELD_ID: Readonly<Record<FieldName, MessageId>> = {
  provider: "desktop.providers.field.provider",
  accountId: "desktop.providers.field.accountId",
  credential: "desktop.providers.field.credential",
  priority: "desktop.providers.field.priority",
  reservePct: "desktop.providers.field.reservePct",
  minIntervalMs: "desktop.providers.field.minIntervalMs",
  onLimit: "desktop.providers.field.onLimit",
  maxWaitMs: "desktop.providers.field.maxWaitMs",
  model: "desktop.providers.field.model",
};

export function fieldIdOf(field: FieldName): MessageId {
  return FIELD_ID[field];
}

const UNIT_ID: Readonly<Record<UsageUnit, MessageId>> = {
  tokens: "desktop.providers.usage.unit.tokens",
  usd: "desktop.providers.usage.unit.usd",
  requests: "desktop.providers.usage.unit.requests",
  cacheRead: "desktop.providers.usage.unit.cacheRead",
  cacheWrite: "desktop.providers.usage.unit.cacheWrite",
};

export function unitIdOf(unit: UsageUnit): MessageId {
  return UNIT_ID[unit];
}

/** 창 이름. `session`(이 대화)은 패널 제목이 이미 말하므로 글을 붙이지 않는다 */
const WINDOW_ID: Readonly<Record<UsageWindow, MessageId | null>> = {
  minute: "desktop.providers.usage.window.minute",
  hour: "desktop.providers.usage.window.hour",
  day: "desktop.providers.usage.window.day",
  week: "desktop.providers.usage.window.week",
  month: "desktop.providers.usage.window.month",
  session: null,
};

export function windowIdOf(window: UsageWindow): MessageId | null {
  return WINDOW_ID[window];
}

/** 메시지 키와 인자. `t(id, args)`로 푼다 */
export interface MessageRef {
  readonly id: MessageId;
  readonly args: MessageArgs;
}

/** 토큰, 요청, 캐시 같은 개수. 1000 미만은 그대로, 그 이상은 상태 줄과 같은 형식으로 줄인다(41,000은 41.0k, 1,200,000은 1.2M) */
function countRefOf(amount: number): MessageRef {
  const count = Math.round(amount);
  if (count < 1000) return { id: "desktop.providers.usage.count.plain", args: { count } };
  if (count < 1_000_000) {
    return {
      id: "desktop.providers.usage.count.thousand",
      args: { count: (count / 1000).toFixed(1) },
    };
  }
  return {
    id: "desktop.providers.usage.count.million",
    args: { count: (count / 1_000_000).toFixed(1) },
  };
}

/** 비용. 0이거나 1센트 이상이면 소수 둘, 그 밑이면 소수 넷이다(센트 밑이 `$0.00`으로 보이지 않게). 0.0001 밑은 "< $0.0001"이다 */
function usdRefOf(amount: number): MessageRef {
  if (amount > 0 && amount < 0.0001) {
    return { id: "desktop.providers.usage.usd.tiny", args: {} };
  }
  const digits = amount === 0 || amount >= 0.01 ? 2 : 4;
  return { id: "desktop.providers.usage.usd", args: { amount: amount.toFixed(digits) } };
}

/** 게이지 값 하나의 키. 비용은 달러, 나머지는 개수다 */
export function amountRefOf(unit: UsageUnit, amount: number): MessageRef {
  return unit === "usd" ? usdRefOf(amount) : countRefOf(amount);
}

/** 재설정 시각의 지역 문장. 엔진이 준 값은 ISO 문자열이다 */
export function resetTextOf(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}
