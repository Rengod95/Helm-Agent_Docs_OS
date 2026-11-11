import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  Select,
  SelectOption,
  Textarea,
} from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import type { DedicatedEditorProps } from "./settings-field.tsx";
import {
  commandLineOf,
  draftOfHook,
  EMPTY_HOOK_DRAFT,
  hookOfDraft,
  hooksOf,
  withHook,
  withoutHook,
  type HookDraft,
  type HookDraftIssue,
  type HookRow,
} from "./settings-hook-model.ts";

// 외부 훅 정의 편집기(`x.operations.hookDefs`, X.operations §4.7). 훅은 이 컴퓨터에서 명령을 실행하므로 경고를 늘 보인다(DP-58).
// 새 훅과 고친 훅은 명령을 보여 주는 확인을 거쳐야 초안에 들어간다. 지우기는 확인 없이 초안에 들어간다. 저장은 항목 아래 줄이 한다.

const ISSUE_TEXT: Readonly<Record<HookDraftIssue, MessageId>> = {
  id: "desktop.settings.hookDefs.issue.id",
  idDuplicate: "desktop.settings.hookDefs.issue.idDuplicate",
  point: "desktop.settings.hookDefs.issue.point",
  command: "desktop.settings.hookDefs.issue.command",
  tools: "desktop.settings.hookDefs.issue.tools",
  timeout: "desktop.settings.hookDefs.issue.timeout",
  env: "desktop.settings.hookDefs.issue.env",
};

interface Editing {
  /** 고치는 훅의 자리. 새 훅이면 null */
  readonly index: number | null;
  readonly draft: HookDraft;
  /** 확인 단계에 올라간 훅 */
  readonly confirm: HookRow | null;
  readonly issue: HookDraftIssue | null;
}

function pointsOf(props: DedicatedEditorProps): readonly string[] {
  const widget = props.field.widget;
  if (widget.kind !== "table") return [];
  const column = widget.columns.find((item) => item.name === "point");
  return (column?.options ?? []).filter((option): option is string => typeof option === "string");
}

function HookForm(props: {
  readonly draft: HookDraft;
  readonly points: readonly string[];
  readonly onChange: (next: HookDraft) => void;
}): ReactNode {
  const { draft, points, onChange } = props;
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("desktop.settings.hookDefs.field.id")}>
        <Input
          value={draft.id}
          spellCheck={false}
          onChange={(event) => {
            onChange({ ...draft, id: event.currentTarget.value });
          }}
        />
      </Field>
      <Field label={t("desktop.settings.hookDefs.field.point")}>
        <Select
          value={draft.point}
          onValueChange={(next) => {
            onChange({ ...draft, point: next });
          }}
        >
          {points.map((point) => (
            <SelectOption key={point} value={point}>
              {point}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <Field label={t("desktop.settings.hookDefs.field.command")}>
        <Textarea
          rows={4}
          value={draft.command}
          spellCheck={false}
          className="font-mono text-mono-sm"
          onValueChange={(next) => {
            onChange({ ...draft, command: next });
          }}
        />
      </Field>
      <Field label={t("desktop.settings.hookDefs.field.tools")}>
        <Input
          value={draft.tools}
          spellCheck={false}
          onChange={(event) => {
            onChange({ ...draft, tools: event.currentTarget.value });
          }}
        />
      </Field>
      <Field label={t("desktop.settings.hookDefs.field.cwd")}>
        <Select
          value={draft.cwd}
          onValueChange={(next) => {
            onChange({ ...draft, cwd: next === "home" ? "home" : "project" });
          }}
        >
          <SelectOption value="project">{t("desktop.settings.hookDefs.cwd.project")}</SelectOption>
          <SelectOption value="home">{t("desktop.settings.hookDefs.cwd.home")}</SelectOption>
        </Select>
      </Field>
      <Field label={t("desktop.settings.hookDefs.field.timeout")}>
        <Input
          value={draft.timeoutMs}
          inputMode="numeric"
          onChange={(event) => {
            onChange({ ...draft, timeoutMs: event.currentTarget.value });
          }}
        />
      </Field>
      <Field label={t("desktop.settings.hookDefs.field.env")}>
        <Input
          value={draft.env}
          spellCheck={false}
          onChange={(event) => {
            onChange({ ...draft, env: event.currentTarget.value });
          }}
        />
      </Field>
    </div>
  );
}

/** 외부 훅 표. 경고, 훅 목록, 추가·고치기 대화와 실행 확인을 가진다 */
export function HookDefsEditor(props: DedicatedEditorProps): ReactNode {
  const { field, editable, handlers } = props;
  const [editing, setEditing] = useState<Editing | null>(null);
  const rows = hooksOf(field.value);
  const points = pointsOf(props);
  const warning = (
    <Alert tone="warning" size="sm">
      {t("desktop.settings.hookDefs.warning")}
    </Alert>
  );
  if (rows === null) {
    return (
      <div className="flex flex-col gap-3">
        {warning}
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.settings.table.unreadable")}
        </Alert>
      </div>
    );
  }
  const others = (index: number | null): readonly string[] =>
    rows.filter((_, at) => at !== index).map((row) => row.id);
  const close = (): void => {
    setEditing(null);
  };
  const review = (state: Editing): void => {
    const checked = hookOfDraft(state.draft, points, others(state.index));
    if (!checked.ok) {
      setEditing({ ...state, issue: checked.issue });
      return;
    }
    setEditing({ ...state, confirm: checked.row, issue: null });
  };
  const turnOn = (state: Editing): void => {
    if (state.confirm === null) return;
    handlers.edit(field.key, withHook(rows, state.index, state.confirm));
    close();
  };
  return (
    <div className="flex flex-col gap-3">
      {warning}
      {rows.length === 0 ? (
        <p className="text-ui text-text-tertiary">{t("desktop.settings.hookDefs.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={row.id} data-slot="hook-row" className="flex flex-wrap items-center gap-2">
              <span className="text-ui-strong">{row.id}</span>
              <span className="text-ui text-text-secondary">{row.point}</span>
              <code className="text-mono-sm text-text-tertiary">{commandLineOf(row.command)}</code>
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  setEditing({ index, draft: draftOfHook(row), confirm: null, issue: null });
                }}
              >
                {t("desktop.settings.hookDefs.edit.button")}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  handlers.edit(field.key, withoutHook(rows, index));
                }}
              >
                {t("desktop.settings.table.remove.button")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!editable}
          onClick={() => {
            setEditing({ index: null, draft: EMPTY_HOOK_DRAFT, confirm: null, issue: null });
          }}
        >
          {t("desktop.settings.hookDefs.add.button")}
        </Button>
      </div>
      {editing !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={
            editing.confirm === null
              ? t("desktop.settings.hookDefs.dialog.title")
              : t("desktop.settings.hookDefs.confirm.title")
          }
          footer={
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={
                  editing.confirm === null
                    ? close
                    : () => {
                        setEditing({ ...editing, confirm: null });
                      }
                }
              >
                {editing.confirm === null
                  ? t("desktop.workbench.cancel")
                  : t("desktop.settings.hookDefs.confirm.back")}
              </Button>
              {editing.confirm === null ? (
                <Button
                  size="sm"
                  variant="solid"
                  onClick={() => {
                    review(editing);
                  }}
                >
                  {t("desktop.settings.hookDefs.review.button")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="solid"
                  onClick={() => {
                    turnOn(editing);
                  }}
                >
                  {t("desktop.settings.hookDefs.confirm.allow")}
                </Button>
              )}
            </>
          }
        >
          {editing.confirm === null ? (
            <div className="flex flex-col gap-3">
              <HookForm
                draft={editing.draft}
                points={points}
                onChange={(draft) => {
                  setEditing({ ...editing, draft, issue: null });
                }}
              />
              {editing.issue !== null && (
                <Alert tone="warning" variant="ghost" size="sm">
                  {t(ISSUE_TEXT[editing.issue])}
                </Alert>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-body">
                {t("desktop.settings.hookDefs.confirm.body", {
                  id: editing.confirm.id,
                  point: editing.confirm.point,
                })}
              </p>
              <code className="block break-all rounded-sm bg-bg-inset p-2 text-mono-sm">
                {commandLineOf(editing.confirm.command)}
              </code>
              {warning}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
