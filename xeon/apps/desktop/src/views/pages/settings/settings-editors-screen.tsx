import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { PolicyRule } from "@fresnel/contracts/services";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";
import { HookDefsEditor } from "./settings-hook-defs.tsx";
import type { DedicatedEditorProps, DedicatedEditors } from "./settings-field.tsx";
import {
  checkId,
  checkTool,
  conflictsOf,
  EMPTY_RULE_DRAFT,
  ruleListOf,
  ruleOfDraft,
  toolTextOf,
  withEffect,
  withId,
  withoutRule,
  withPriority,
  withTool,
  type RuleDraft,
} from "./settings-rules-model.ts";
import {
  RecordTableView,
  RowsTableView,
  FixedTableView,
  RulesView,
  SandboxListView,
  SecretRefView,
  UnreadableEditorNote,
  type SecretListStatus,
} from "./settings-editors-view.tsx";
import { entryIssueIdOf, nameIssueIdOf, ruleIssueIdOf } from "./settings-editors-text.ts";
import { addEntry, sandboxListKindOf, textListOf, withoutEntry } from "./settings-sandbox-model.ts";
import { secretNameOf, secretRefOf } from "./settings-secret-model.ts";
import {
  checkRecordName,
  defaultCellOf,
  recordOf,
  rowsOf,
  withCell,
  withField,
  withRowAdded,
  withoutField,
  withoutRow,
} from "./settings-table-model.ts";

// 설정 전용 편집기의 상태 쪽(P-09 §6.13). 초안 칸(입력 글, 고르기 칸)과 오류 문장을 들고, 검사를 거친 값만 `handlers.edit`으로 보낸다.
// 고르기 칸(시크릿)만 `handlers.change`로 바로 저장한다. 저장과 되돌리기는 항목 아래 줄이 한다(P-09 초안 흐름).

/** 권한 규칙(`l1.tools.rules`). 행마다 이름, 도구, 동작, 우선순위를 고치고 새 규칙을 더한다 */
function PermissionRulesEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_RULE_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const rules = ruleListOf(field.value);
  if (rules === null) {
    return <UnreadableEditorNote message={t("desktop.settings.rules.unreadable")} />;
  }
  const write = (next: readonly PolicyRule[]): void => {
    setError(null);
    handlers.edit(field.key, next);
  };
  return (
    <RulesView
      rules={rules}
      conflicts={conflictsOf(rules)}
      editable={editable}
      draft={draft}
      error={error}
      onDraft={setDraft}
      onAdd={() => {
        const checked = ruleOfDraft(draft, rules);
        if (!checked.ok) {
          setError(t(ruleIssueIdOf(checked.error)));
          return;
        }
        write([...rules, checked.value]);
        setDraft(EMPTY_RULE_DRAFT);
      }}
      onId={(index, text) => {
        const checked = checkId(text, rules, index);
        if (!checked.ok) {
          setError(t(ruleIssueIdOf(checked.error)));
          return;
        }
        if (checked.value === rules[index]?.id) return;
        write(withId(rules, index, checked.value));
      }}
      onTool={(index, text) => {
        const checked = checkTool(text);
        if (!checked.ok) {
          setError(t(ruleIssueIdOf(checked.error)));
          return;
        }
        const rule = rules[index];
        if (rule === undefined || checked.value === toolTextOf(rule)) return;
        write(withTool(rules, index, checked.value));
      }}
      onEffect={(index, effect) => {
        write(withEffect(rules, index, effect));
      }}
      onPriority={(index, priority) => {
        write(withPriority(rules, index, priority));
      }}
      onRemove={(index) => {
        write(withoutRule(rules, index));
      }}
    />
  );
}

/** 샌드박스 글 목록(`l0.sandbox.writeRoots.extra`, `l0.sandbox.network.blockedDomains`). 넣을 때 형식을 검사한다 */
function SandboxListEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const kind = sandboxListKindOf(field.key);
  const items = textListOf(field.value);
  if (kind === null || items === null) {
    return <UnreadableEditorNote message={t("desktop.settings.sandbox.unreadable")} />;
  }
  const write = (next: readonly string[]): void => {
    setError(null);
    handlers.edit(field.key, next);
  };
  return (
    <SandboxListView
      kind={kind}
      items={items}
      editable={editable}
      draft={draft}
      error={error}
      onDraft={setDraft}
      onAdd={() => {
        const added = addEntry(kind, items, draft);
        if (!added.ok) {
          setError(t(entryIssueIdOf(added.error)));
          return;
        }
        write(added.value);
        setDraft("");
      }}
      onRemove={(index) => {
        write(withoutEntry(items, index));
      }}
    />
  );
}

/** 시크릿 이름 목록을 한 번 읽는다. 실패하면 실패 상태만 보인다(목록 없이도 지금 값은 보인다) */
function useSecretNames(): {
  readonly status: SecretListStatus;
  readonly names: readonly string[];
} {
  const commands = useCommands();
  const [loaded, setLoaded] = useState<{
    readonly status: SecretListStatus;
    readonly names: readonly string[];
  }>({ status: "loading", names: [] });
  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      const listed = await commands.secrets.list();
      if (!active) return;
      setLoaded(
        listed.ok
          ? { status: "ready", names: listed.value.map((entry) => entry.name) }
          : { status: "failed", names: [] },
      );
    };
    detach(load(), rethrow);
    return () => {
      active = false;
    };
  }, [commands]);
  return loaded;
}

/** 시크릿 참조(`secret` 위젯). 목록에서 이름을 고르면 `secret://<이름>`을 바로 저장한다 */
function SecretRefEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const listed = useSecretNames();
  const current = secretNameOf(field.value);
  return (
    <SecretRefView
      status={listed.status}
      names={listed.names}
      current={current}
      editable={editable}
      onChoose={(name) => {
        handlers.change(field.key, secretRefOf(name));
      }}
    />
  );
}

/** 일반 표(`table` 위젯). rows, record, fixed 모양마다 그림이 다르고 쓰기는 항목 값 전체다 */
function TableEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const widget = field.widget;
  const unreadable = <UnreadableEditorNote message={t("desktop.settings.table.unreadable")} />;
  if (widget.kind !== "table") return unreadable;
  const write = (next: unknown): void => {
    setError(null);
    handlers.edit(field.key, next);
  };
  switch (widget.shape) {
    case "rows": {
      const rows = rowsOf(field.value);
      if (rows === null) return unreadable;
      return (
        <RowsTableView
          settingKey={field.key}
          columns={widget.columns}
          rows={rows}
          maxItems={widget.maxItems}
          editable={editable}
          error={error}
          onCell={(index, column, value) => {
            write(withCell(rows, index, column, value));
          }}
          onAdd={() => {
            write(withRowAdded(rows, widget.columns, widget.maxItems));
          }}
          onRemove={(index) => {
            write(withoutRow(rows, index));
          }}
        />
      );
    }
    case "record": {
      const record = recordOf(field.value);
      const valueColumn = widget.columns[1];
      if (record === null || valueColumn === undefined) return unreadable;
      return (
        <RecordTableView
          valueColumn={valueColumn}
          entries={Object.entries(record)}
          editable={editable}
          draftName={name}
          error={error}
          onDraftName={setName}
          onAdd={() => {
            const checked = checkRecordName(name, record);
            if (!checked.ok) {
              setError(t(nameIssueIdOf(checked.error)));
              return;
            }
            write(withField(record, checked.value, defaultCellOf(valueColumn) ?? null));
            setName("");
          }}
          onValue={(entry, value) => {
            write(withField(record, entry, value));
          }}
          onRemove={(entry) => {
            write(withoutField(record, entry));
          }}
        />
      );
    }
    case "fixed": {
      const values = recordOf(field.value);
      if (values === null) return unreadable;
      return (
        <FixedTableView
          settingKey={field.key}
          columns={widget.columns}
          values={values}
          editable={editable}
          error={error}
          onCell={(entry, value) => {
            write(withField(values, entry, value));
          }}
        />
      );
    }
    default:
      return assertNever(widget.shape, "TableShape");
  }
}

/** 이 화면이 맡는 전용 편집기. 설정 화면이 `PROVIDER_EDITORS`와 합쳐 `editors`로 넘긴다 */
export const SETTINGS_EDITORS: DedicatedEditors = {
  permissionRules: PermissionRulesEditor,
  sandboxLists: SandboxListEditor,
  secretRef: SecretRefEditor,
  hookDefs: HookDefsEditor,
  table: TableEditor,
};
