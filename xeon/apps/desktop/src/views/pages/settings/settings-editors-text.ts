import type { MessageId } from "@fresnel/client/i18n";
import type { PolicyEffect } from "@fresnel/contracts/services";
import type { EntryIssue } from "./settings-sandbox-model.ts";
import type { NameIssue } from "./settings-table-model.ts";
import type { IdIssue, ToolIssue } from "./settings-rules-model.ts";

// 설정 전용 편집기(P-09 §6.13)의 문장 고르기. 문장은 메시지 키로 들고 있다가 그릴 때 `t()`로 만든다.

const EFFECT_ID: Readonly<Record<PolicyEffect, MessageId>> = {
  allow: "desktop.settings.rules.effect.allow",
  ask: "desktop.settings.rules.effect.ask",
  deny: "desktop.settings.rules.effect.deny",
};

export function effectIdOf(effect: PolicyEffect): MessageId {
  return EFFECT_ID[effect];
}

const RULE_ISSUE_ID: Readonly<Record<IdIssue | ToolIssue, MessageId>> = {
  empty: "desktop.settings.rules.issue.empty",
  long: "desktop.settings.rules.issue.long",
  duplicate: "desktop.settings.rules.issue.duplicate",
  toolLong: "desktop.settings.rules.issue.toolLong",
};

export function ruleIssueIdOf(issue: IdIssue | ToolIssue): MessageId {
  return RULE_ISSUE_ID[issue];
}

const ENTRY_ISSUE_ID: Readonly<Record<EntryIssue, MessageId>> = {
  empty: "desktop.settings.sandbox.issue.empty",
  control: "desktop.settings.sandbox.issue.control",
  relative: "desktop.settings.sandbox.issue.relative",
  traversal: "desktop.settings.sandbox.issue.traversal",
  format: "desktop.settings.sandbox.issue.domain",
  duplicate: "desktop.settings.sandbox.issue.duplicate",
};

export function entryIssueIdOf(issue: EntryIssue): MessageId {
  return ENTRY_ISSUE_ID[issue];
}

const NAME_ISSUE_ID: Readonly<Record<NameIssue, MessageId>> = {
  empty: "desktop.settings.table.issue.nameEmpty",
  duplicate: "desktop.settings.table.issue.nameDuplicate",
};

export function nameIssueIdOf(issue: NameIssue): MessageId {
  return NAME_ISSUE_ID[issue];
}
