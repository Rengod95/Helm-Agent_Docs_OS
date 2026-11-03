import type { MessageId } from "@fresnel/client/i18n";
import type { UsageLimitAction } from "@fresnel/client";
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
