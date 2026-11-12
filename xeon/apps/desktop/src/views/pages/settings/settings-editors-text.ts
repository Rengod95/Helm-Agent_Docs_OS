import type { MessageId } from "@fresnel/client/i18n";
import type { EntryIssue } from "./settings-sandbox-model.ts";
import type { NameIssue } from "./settings-table-model.ts";

// 설정 전용 편집기(P-09 §6.13)의 문장 고르기. 문장은 메시지 키로 들고 있다가 그릴 때 `t()`로 만든다.

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
