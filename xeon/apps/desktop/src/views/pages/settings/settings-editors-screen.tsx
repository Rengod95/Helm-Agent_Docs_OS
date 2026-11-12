import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Context,
  type ReactNode,
} from "react";
import { useCommands } from "../../commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "../../folder-pick.ts";
import { ListEditor } from "../shared/list-editor.tsx";
import { PermissionRulesTable } from "./settings-rules-panel.tsx";
import { HookDefsEditor } from "./settings-hook-defs.tsx";
import type { DedicatedEditorProps, DedicatedEditors } from "./settings-field.tsx";
import {
  RecordTableView,
  RowsTableView,
  FixedTableView,
  SecretRefView,
  UnreadableEditorNote,
  type SecretListStatus,
} from "./settings-editors-view.tsx";
import { entryIssueIdOf, nameIssueIdOf } from "./settings-editors-text.ts";
import { addEntry, sandboxListKindOf, textListOf, withoutEntry } from "./settings-sandbox-model.ts";
import { secretNameOf, secretRefOf } from "./settings-secret-model.ts";
import {
  checkRecordName,
  defaultCellOf,
  recordOf,
  rowsOf,
  withCellText,
  withField,
  withRowAdded,
  withoutField,
  withoutRow,
} from "./settings-table-model.ts";

// 설정 전용 편집기의 상태 쪽(P-09 §6.13). 초안 칸(입력 글, 고르기 칸)과 오류 문장을 들고, 검사를 거친 값만 `handlers.edit`으로 보낸다.
// 고르기 칸(시크릿)만 `handlers.change`로 바로 저장한다. 저장과 되돌리기는 항목 아래 줄이 한다(P-09 초안 흐름).

/** 권한 규칙(`l1.tools.rules`). 찾기 결과에서도 구역과 같은 판정 표다(DP-109) */
function PermissionRulesEditor(props: DedicatedEditorProps): ReactNode {
  return (
    <PermissionRulesTable field={props.field} editable={props.editable} handlers={props.handlers} />
  );
}

/**
 * 폴더 고르기 창을 부르는 함수. 설정 화면이 셸의 `pick_folder`를 넣는다. 웹처럼 창이 없으면 `null`이고, 목록 편집기에
 * "폴더 고르기" 단추가 없다
 */
export const FolderPickContext: Context<FolderPickInvoke | null> =
  createContext<FolderPickInvoke | null>(null);

/**
 * 글 목록(쓰기 폴더, 보호 경로, 스킬 경로, 막을 도메인). 공용 목록 편집기(DP-110)로 그리고, 넣고 지우면 바로 저장한다.
 * 경로 목록은 폴더 고르기 창으로도 넣는다. 넣을 때 형식을 검사한다
 */
function SandboxListEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const folderPick = useContext(FolderPickContext);
  const kind = sandboxListKindOf(field.key);
  const items = textListOf(field.value);
  if (kind === null || items === null) {
    return <UnreadableEditorNote message={t("desktop.settings.sandbox.unreadable")} />;
  }
  const put = (text: string): void => {
    const added = addEntry(kind, items, text);
    if (!added.ok) {
      setError(t(entryIssueIdOf(added.error)));
      return;
    }
    setError(null);
    setDraft("");
    handlers.change(field.key, added.value);
  };
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setError(t("desktop.settings.list.pickFailed"));
      return;
    }
    if (picked.value !== undefined) put(picked.value);
  };
  return (
    <ListEditor
      label={field.label}
      items={items}
      emptyText={t(
        kind === "paths"
          ? "desktop.settings.list.empty.paths"
          : "desktop.settings.list.empty.domains",
      )}
      draft={draft}
      placeholder={t(
        kind === "paths"
          ? "desktop.settings.list.placeholder.path"
          : "desktop.settings.list.placeholder.domain",
      )}
      error={error}
      disabled={!editable}
      onDraft={(text) => {
        setError(null);
        setDraft(text);
      }}
      onAdd={() => {
        put(draft);
      }}
      onRemove={(index) => {
        setError(null);
        handlers.change(field.key, withoutEntry(items, index));
      }}
      removeLabel={(item) => t("desktop.settings.list.remove", { item })}
      addLabel={t("desktop.settings.verdict.add")}
      onPick={
        kind === "paths" && folderPick !== null
          ? () => {
              detach(pick(folderPick), rethrow);
            }
          : undefined
      }
      pickLabel={t("desktop.settings.list.pick")}
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
            write(withCellText(rows, widget.columns, index, column, value));
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
