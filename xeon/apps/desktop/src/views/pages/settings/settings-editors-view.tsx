import { Alert, Button, Input, NumberField, Select, SelectOption, Switch } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { TableColumn } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { PolicyEffect, PolicyRule } from "@fresnel/contracts/services";
import type { ReactNode } from "react";
import {
  columnLabelOf,
  numberValueOf,
  optionOf,
  optionTextOf,
  textValueOf,
} from "./settings-model.ts";
import {
  PRIORITY_DEFAULT,
  RULE_EFFECTS,
  partnersOf,
  toolTextOf,
  type RuleConflict,
  type RuleDraft,
} from "./settings-rules-model.ts";
import { effectIdOf } from "./settings-editors-text.ts";
import type { SandboxListKind } from "./settings-sandbox-model.ts";
import { secretChoicesOf } from "./settings-secret-model.ts";
import { keyedRowsOf, type Row } from "./settings-table-model.ts";

// 설정 전용 편집기의 그림(P-09 §6.13). 상태는 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 값은 `settings-editors-screen.tsx`가 검사해서 넘기고, 이 그림은 보여 주고 콜백을 부를 뿐이다.
// 글 칸은 떠날 때(또는 Enter) 보내고, 고르기와 숫자 칸은 바로 보낸다. 모든 쓰기는 초안이고 저장은 항목 아래 줄이 한다.

function ErrorNote(props: { readonly message: string | null }): ReactNode {
  if (props.message === null) return null;
  return (
    <Alert tone="warning" variant="ghost" size="sm">
      {props.message}
    </Alert>
  );
}

/** 읽을 수 없는 값의 안내. 그 항목은 고칠 수 없고 파일로 본다 */
export function UnreadableEditorNote(props: { readonly message: string }): ReactNode {
  return (
    <Alert tone="warning" variant="ghost" size="sm">
      {props.message}
    </Alert>
  );
}

/** 떠날 때 보내는 글 칸. 값이 바뀌면 줄을 새로 만든다(key) */
function CommitInput(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly onCommit: (text: string) => void;
}): ReactNode {
  return (
    <Input
      aria-label={props.label}
      placeholder={props.placeholder}
      defaultValue={props.value}
      disabled={props.disabled}
      onBlur={(event) => {
        props.onCommit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") props.onCommit(event.currentTarget.value);
      }}
    />
  );
}

// ── 권한 규칙 ───────────────────────────────────────────────────────────

export interface RulesViewProps {
  readonly rules: readonly PolicyRule[];
  readonly conflicts: readonly RuleConflict[];
  readonly editable: boolean;
  readonly draft: RuleDraft;
  readonly error: string | null;
  readonly onDraft: (next: RuleDraft) => void;
  readonly onAdd: () => void;
  readonly onId: (index: number, text: string) => void;
  readonly onTool: (index: number, text: string) => void;
  readonly onEffect: (index: number, effect: PolicyEffect) => void;
  readonly onPriority: (index: number, priority: number) => void;
  readonly onRemove: (index: number) => void;
}

/** 규칙 표. 동작 열은 허용, 질문, 거부 중 하나다. 허용과 거부가 겹치는 행에는 충돌 문장을 단다 */
export function RulesView(props: RulesViewProps): ReactNode {
  const { rules, editable } = props;
  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.rules.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule, index) => (
            <RuleRowView
              key={`${rule.id}:${toolTextOf(rule)}:${rule.effect}`}
              rules={rules}
              index={index}
              conflicts={props.conflicts}
              editable={editable}
              onId={props.onId}
              onTool={props.onTool}
              onEffect={props.onEffect}
              onPriority={props.onPriority}
              onRemove={props.onRemove}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("desktop.settings.rules.column.id")}
          placeholder={t("desktop.settings.rules.column.id")}
          value={props.draft.id}
          disabled={!editable}
          onValueChange={(next) => {
            props.onDraft({ ...props.draft, id: next });
          }}
        />
        <Input
          aria-label={t("desktop.settings.rules.column.tool")}
          placeholder={t("desktop.settings.rules.tool.all")}
          value={props.draft.tool}
          disabled={!editable}
          onValueChange={(next) => {
            props.onDraft({ ...props.draft, tool: next });
          }}
        />
        <Select
          aria-label={t("desktop.settings.rules.column.effect")}
          value={props.draft.effect}
          disabled={!editable}
          onValueChange={(next) => {
            const effect = RULE_EFFECTS.find((candidate) => candidate === next);
            if (effect !== undefined) props.onDraft({ ...props.draft, effect });
          }}
        >
          {RULE_EFFECTS.map((effect) => (
            <SelectOption key={effect} value={effect}>
              {t(effectIdOf(effect))}
            </SelectOption>
          ))}
        </Select>
        <Button size="sm" variant="outline" disabled={!editable} onClick={props.onAdd}>
          {t("desktop.settings.rules.add.button")}
        </Button>
      </div>
      <ErrorNote message={props.error} />
    </div>
  );
}

function RuleRowView(props: {
  readonly rules: readonly PolicyRule[];
  readonly index: number;
  readonly conflicts: readonly RuleConflict[];
  readonly editable: boolean;
  readonly onId: (index: number, text: string) => void;
  readonly onTool: (index: number, text: string) => void;
  readonly onEffect: (index: number, effect: PolicyEffect) => void;
  readonly onPriority: (index: number, priority: number) => void;
  readonly onRemove: (index: number) => void;
}): ReactNode {
  const { rules, index, editable } = props;
  const rule = rules[index];
  if (rule === undefined) return null;
  const partners = partnersOf(props.conflicts, index).map((at) => rules[at]?.id ?? "");
  return (
    <li data-slot="rule-row" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <CommitInput
          label={t("desktop.settings.rules.column.id")}
          value={rule.id}
          disabled={!editable}
          onCommit={(text) => {
            props.onId(index, text);
          }}
        />
        <CommitInput
          label={t("desktop.settings.rules.column.tool")}
          value={toolTextOf(rule)}
          placeholder={t("desktop.settings.rules.tool.all")}
          disabled={!editable}
          onCommit={(text) => {
            props.onTool(index, text);
          }}
        />
        <Select
          aria-label={t("desktop.settings.rules.column.effect")}
          value={rule.effect}
          disabled={!editable}
          onValueChange={(next) => {
            const effect = RULE_EFFECTS.find((candidate) => candidate === next);
            if (effect !== undefined) props.onEffect(index, effect);
          }}
        >
          {RULE_EFFECTS.map((effect) => (
            <SelectOption key={effect} value={effect}>
              {t(effectIdOf(effect))}
            </SelectOption>
          ))}
        </Select>
        <NumberField
          appearance="stepper"
          commitMode="release"
          aria-label={t("desktop.settings.rules.column.priority")}
          value={rule.priority ?? PRIORITY_DEFAULT}
          min={0}
          max={999}
          step={1}
          disabled={!editable}
          onValueChange={(next) => {
            props.onPriority(index, next);
          }}
        />
        <Button
          size="xs"
          variant="outline"
          disabled={!editable}
          onClick={() => {
            props.onRemove(index);
          }}
        >
          {t("desktop.settings.rules.remove.button")}
        </Button>
      </div>
      {partners.length === 0 ? null : (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.settings.rules.conflict", { rules: partners.join(", ") })}
        </Alert>
      )}
    </li>
  );
}

// ── 샌드박스 목록 ───────────────────────────────────────────────────────

export interface SandboxListViewProps {
  readonly kind: SandboxListKind;
  readonly items: readonly string[];
  readonly editable: boolean;
  readonly draft: string;
  readonly error: string | null;
  readonly onDraft: (next: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
}

/** 글 목록 하나(쓰기 경로 또는 차단 도메인). "차단 우선" 문장을 먼저 보인다 */
export function SandboxListView(props: SandboxListViewProps): ReactNode {
  const { kind, items, editable } = props;
  const note =
    kind === "paths"
      ? t("desktop.settings.sandbox.paths.note")
      : t("desktop.settings.sandbox.domains.note");
  const addLabel =
    kind === "paths"
      ? t("desktop.settings.sandbox.paths.add.label")
      : t("desktop.settings.sandbox.domains.add.label");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ui-sm text-text-secondary">{note}</p>
      {items.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.sandbox.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={item} className="flex items-center gap-2">
              <span className="text-ui-sm break-all text-text-primary">{item}</span>
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  props.onRemove(index);
                }}
              >
                {t("desktop.settings.sandbox.remove.button")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={addLabel}
          placeholder={addLabel}
          value={props.draft}
          disabled={!editable}
          onValueChange={props.onDraft}
        />
        <Button size="sm" variant="outline" disabled={!editable} onClick={props.onAdd}>
          {t("desktop.settings.sandbox.add.button")}
        </Button>
      </div>
      <ErrorNote message={props.error} />
    </div>
  );
}

// ── 표(rows, record, fixed) ──────────────────────────────────────────────

function choiceTextOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** 열 하나의 칸. 글은 글 칸, 숫자는 숫자 칸, 참거짓은 스위치, 열거형은 선택 상자다. 중첩 값은 글로만 보인다 */
function CellControl(props: {
  readonly column: TableColumn;
  readonly value: unknown;
  readonly label: string;
  readonly disabled: boolean;
  readonly onChange: (value: unknown) => void;
}): ReactNode {
  const { column, value, label, disabled, onChange } = props;
  switch (column.kind) {
    case "string":
      return (
        <CommitInput
          key={textValueOf(value)}
          label={label}
          value={textValueOf(value)}
          disabled={disabled}
          onCommit={(next) => {
            if (next !== textValueOf(value)) onChange(next);
          }}
        />
      );
    case "number":
    case "integer":
      return (
        <NumberField
          appearance="stepper"
          commitMode="release"
          aria-label={label}
          value={numberValueOf(value)}
          step={column.kind === "integer" ? 1 : undefined}
          disabled={disabled}
          onValueChange={(next) => {
            onChange(next);
          }}
        />
      );
    case "boolean":
      return (
        <Switch
          aria-label={label}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(next) => {
            onChange(next);
          }}
        />
      );
    case "enum": {
      const options = column.options ?? [];
      return (
        <Select
          aria-label={label}
          value={choiceTextOf(value)}
          disabled={disabled}
          onValueChange={(next) => {
            const option = optionOf(options, next);
            if (option !== null) onChange(option);
          }}
        >
          {options.map((option) => (
            <SelectOption key={optionTextOf(option)} value={optionTextOf(option)}>
              {optionTextOf(option)}
            </SelectOption>
          ))}
        </Select>
      );
    }
    case "json":
      return (
        <span className="text-ui-sm break-all text-text-secondary">{JSON.stringify(value)}</span>
      );
    default:
      return assertNever(column.kind, "TableColumn");
  }
}

export interface RowsTableViewProps {
  /** 표가 속한 설정 키. 열 머리 글을 카탈로그에서 찾는다(`columnLabelOf`) */
  readonly settingKey: SettingKey;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly Row[];
  readonly maxItems: number | null;
  readonly editable: boolean;
  readonly error: string | null;
  readonly onCell: (index: number, name: string, value: unknown) => void;
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
}

/** rows 모양. 행마다 열이 한 칸씩이다. 최대 개수에 닿으면 행 추가가 잠긴다 */
export function RowsTableView(props: RowsTableViewProps): ReactNode {
  const { columns, rows, editable } = props;
  const full = props.maxItems !== null && rows.length >= props.maxItems;
  const labelOf = (name: string): string => columnLabelOf(props.settingKey, name);
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.table.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {keyedRowsOf(rows).map((item) => (
            <li key={item.key} data-slot="table-row" className="flex flex-wrap items-center gap-2">
              {columns.map((column) => (
                <label key={column.name} className="flex items-center gap-1">
                  <span className="text-ui-sm text-text-secondary">{labelOf(column.name)}</span>
                  <CellControl
                    column={column}
                    value={item.row[column.name]}
                    label={labelOf(column.name)}
                    disabled={!editable || column.kind === "json"}
                    onChange={(value) => {
                      props.onCell(item.index, column.name, value);
                    }}
                  />
                </label>
              ))}
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  props.onRemove(item.index);
                }}
              >
                {t("desktop.settings.table.remove.button")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button size="sm" variant="outline" disabled={!editable || full} onClick={props.onAdd}>
          {t("desktop.settings.table.add.button")}
        </Button>
      </div>
      <ErrorNote message={props.error} />
    </div>
  );
}

export interface RecordTableViewProps {
  readonly valueColumn: TableColumn;
  readonly entries: readonly (readonly [string, unknown])[];
  readonly editable: boolean;
  readonly draftName: string;
  readonly error: string | null;
  readonly onDraftName: (next: string) => void;
  readonly onAdd: () => void;
  readonly onValue: (name: string, value: unknown) => void;
  readonly onRemove: (name: string) => void;
}

/** record 모양. 이름마다 한 줄이고, 이름은 새로 만들 때만 정한다 */
export function RecordTableView(props: RecordTableViewProps): ReactNode {
  const { valueColumn, entries, editable } = props;
  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.table.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([name, value]) => (
            <li key={name} data-slot="table-row" className="flex flex-wrap items-center gap-2">
              <span className="text-ui-strong text-text-primary">{name}</span>
              <CellControl
                column={valueColumn}
                value={value}
                label={name}
                disabled={!editable || valueColumn.kind === "json"}
                onChange={(next) => {
                  props.onValue(name, next);
                }}
              />
              <Button
                size="xs"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  props.onRemove(name);
                }}
              >
                {t("desktop.settings.table.remove.button")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("desktop.settings.table.name.placeholder")}
          placeholder={t("desktop.settings.table.name.placeholder")}
          value={props.draftName}
          disabled={!editable}
          onValueChange={props.onDraftName}
        />
        <Button size="sm" variant="outline" disabled={!editable} onClick={props.onAdd}>
          {t("desktop.settings.table.record.add.button")}
        </Button>
      </div>
      <ErrorNote message={props.error} />
    </div>
  );
}

export interface FixedTableViewProps {
  /** 표가 속한 설정 키. 열 머리 글을 카탈로그에서 찾는다(`columnLabelOf`) */
  readonly settingKey: SettingKey;
  readonly columns: readonly TableColumn[];
  readonly values: Row;
  readonly editable: boolean;
  readonly error: string | null;
  readonly onCell: (name: string, value: unknown) => void;
}

/** fixed 모양. 속성마다 한 줄이고, 줄을 더하거나 지우지 않는다 */
export function FixedTableView(props: FixedTableViewProps): ReactNode {
  const labelOf = (name: string): string => columnLabelOf(props.settingKey, name);
  return (
    <div className="flex flex-col gap-2">
      {props.columns.map((column) => (
        <label key={column.name} className="flex flex-wrap items-center gap-2">
          <span className="w-40 text-ui-sm text-text-secondary">{labelOf(column.name)}</span>
          <CellControl
            column={column}
            value={props.values[column.name]}
            label={labelOf(column.name)}
            disabled={!props.editable || column.kind === "json"}
            onChange={(value) => {
              props.onCell(column.name, value);
            }}
          />
        </label>
      ))}
      <ErrorNote message={props.error} />
    </div>
  );
}

// ── 시크릿 참조 ─────────────────────────────────────────────────────────

export type SecretListStatus = "loading" | "failed" | "ready";

export interface SecretRefViewProps {
  readonly status: SecretListStatus;
  readonly names: readonly string[];
  /** 지금 값의 시크릿 이름. 참조 글이 아니거나 없으면 `null`이다 */
  readonly current: string | null;
  readonly editable: boolean;
  readonly onChoose: (name: string) => void;
}

/** 시크릿 고르기. 이름은 시크릿 목록에서 고르고, 값은 여기서 다루지 않는다 */
export function SecretRefView(props: SecretRefViewProps): ReactNode {
  const choices = secretChoicesOf(props.names, props.current);
  return (
    <div className="flex flex-col gap-2">
      {props.status === "loading" ? (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.settings.secretRef.loading")}
        </p>
      ) : null}
      {props.status === "failed" ? (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.settings.secretRef.failed")}
        </Alert>
      ) : null}
      {props.status === "ready" && choices.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.secretRef.empty")}</p>
      ) : (
        <Select
          aria-label={t("desktop.settings.secretRef.label")}
          value={props.current ?? ""}
          disabled={!props.editable}
          onValueChange={props.onChoose}
        >
          {choices.map((name) => (
            <SelectOption key={name} value={name}>
              {name}
            </SelectOption>
          ))}
        </Select>
      )}
    </div>
  );
}
