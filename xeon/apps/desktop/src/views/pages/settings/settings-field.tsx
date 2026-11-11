import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Field,
  IconButton,
  Input,
  NumberField,
  type NumberFieldDraft,
  RadioGroup,
  RadioGroupItem,
  Select,
  SegmentedControl,
  SegmentedControlItem,
  SelectOption,
  Switch,
  Tooltip,
} from "@caustic/react";
import { Check, Lock, RotateCcw } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { FieldVM, WidgetVM } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import {
  PLACEHOLDER_OF_KEY,
  PRESET_OF_KEY,
  PresetQuantity,
  SEGMENTED_KEYS,
  SEGMENTED_MAX,
} from "./settings-field-shapes.tsx";
import { useId, useRef, useState, type ReactNode } from "react";
import {
  choiceWarningOf,
  dedicatedEditorOf,
  fieldControlOf,
  foldableOf,
  hasFooter,
  numberDraftActionOf,
  numberValueOf,
  optionHelpOf,
  optionLabelOf,
  optionOf,
  optionTextOf,
  overrideNoticeOf,
  PATH_TEXT_KEYS,
  remoteNoticeOf,
  rowLayoutOf,
  switchClassOf,
  tagsOf,
  textValueOf,
  valueSummaryOf,
  type DedicatedEditorKind,
  type FieldControl,
  type FieldHandlers,
} from "./settings-model.ts";
import { QuantityControl } from "./settings-quantity-field.tsx";
import { numberControlOf, rangeTextOf } from "./settings-quantity.ts";
import { isCommitEnter } from "../../ime-enter.ts";
import { SettingTagList } from "./settings-tag-list.tsx";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote, SettingRow } from "./settings-section.tsx";

// 설정 항목 한 줄(P-09, L4.settings-ui §4.2 [결정: 2026-11-11 사용자]). 모든 쓰기는 사용자(전역) 범위다. 범위 고르기,
// "이번 대화에만 적용", 범위 값 지우기는 없다.
//   한 줄 행(스위치, 고르기, 숫자, 짧은 글): 왼쪽 제목 · 정보 아이콘 · 상태 ……… 되돌리기 · 컨트롤
//   두 줄 행(목록, 표, 설명 붙은 선택지, 전용 편집기): 제목 줄 아래에 컨트롤이 열 폭으로 놓인다.
// 그 아래에 차례로: 오류, 잠금, 덮어쓰는 층 경고(다른 층 값이 이길 때), 다른 곳에서 바뀜, 폐기, 저장 줄.
// 설명은 정보 아이콘 뒤 말풍선이다(DP 규칙). 경고는 보이게 둔다. 상태와 명령은 없고 `handlers`만 받는다.

export type { FieldHandlers } from "./settings-model.ts";

/** 전용 편집기 하나가 받는 값. 초안은 `handlers.edit`로, 저장과 되돌리기는 항목 아래 줄로 바뀐다 */
export interface DedicatedEditorProps {
  readonly field: FieldVM;
  readonly editable: boolean;
  readonly handlers: FieldHandlers;
}

/** 종류마다 전용 편집기 그림 하나. 빠진 종류는 요약으로 그린다 */
export type DedicatedEditors = Readonly<
  Partial<Record<DedicatedEditorKind, (props: DedicatedEditorProps) => ReactNode>>
>;

export interface FieldRowProps {
  readonly field: FieldVM;
  /** 읽기 전용(오프라인)이 아니고 항목이 쓸 수 있을 때 참 */
  readonly editable: boolean;
  /** "저장됨" 표시가 아직 보이는가 */
  readonly saved: boolean;
  readonly editors: DedicatedEditors;
  readonly handlers: FieldHandlers;
  /** 찾기 결과에서만 참이다. 제목 아래에 설정 키를 보인다 */
  readonly showKey?: boolean | undefined;
}

/** 항목 아래 오류 문장. 저장 오류가 있으면 그것을, 없으면 초안의 첫 검사 문장이다 */
function errorTextOf(field: FieldVM): string | null {
  if (field.error !== null) return field.error.message;
  return field.issues[0]?.message ?? null;
}

function choiceTextOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** "저장됨". 저장한 뒤 2초 동안 제목 옆에 보인다(P-09 `SavedMark`) */
export function SavedMark(): ReactNode {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-ui text-success-text">
      <Check aria-hidden className="size-icon-xs" />
      {t("desktop.settings.field.saved")}
    </span>
  );
}

/**
 * 정보 아이콘 뒤 설명 줄. 설명, 다음 턴 적용, 대기 문장, 엔진 연결 안내, 파일 안내, 재시작이 필요한 항목이면 그 사실 한 문장을 둔다.
 * 재시작 필요는 줄마다 배지로 보이지 않는다(DP-79). 바뀐 값이 재시작을 기다리면 설정 화면 아래 띠 하나가 알린다.
 * 경고와 오류, 잠금 문장과 덮어쓰는 층 경고는 줄 아래에 그대로 보인다.
 */
export function explanationOf(field: FieldVM, control: FieldControl): readonly string[] {
  const lines = [
    field.help,
    field.runtime.change === "nextTurn" ? field.runtime.text : null,
    field.runtime.pendingText,
    field.offlineNote,
    control === "summary" ? t("desktop.settings.field.fileHint") : null,
    field.runtime.change === "restart" && field.runtime.pending !== "restart"
      ? t("desktop.settings.field.restartNote")
      : null,
  ];
  return lines.filter((line): line is string => line !== null && line !== "");
}

/** 상태 자리: 저장됨, 저장 중 가운데 하나. 재시작 필요는 여기 두지 않는다(DP-79) */
function StatusMark(props: { readonly field: FieldVM; readonly saved: boolean }): ReactNode {
  if (props.saved) return <SavedMark />;
  if (props.field.saving) {
    return (
      <span role="status" className="text-ui text-text-tertiary">
        {t("desktop.settings.field.saving")}
      </span>
    );
  }
  return null;
}

export function FieldRow(props: FieldRowProps): ReactNode {
  const { field, editable, saved, editors, handlers, showKey = false } = props;
  const titleId = useId();
  const lockId = useId();
  const disabled = !editable;
  const errorText = errorTextOf(field);
  const control = fieldControlOf(field);
  const layout = rowLayoutOf(field, control);
  const explain = explanationOf(field, control);
  const override = overrideNoticeOf(field);
  // 되돌리기는 사용자 값이 있고 쓸 수 있을 때만, 행에 마우스를 올리거나 행 안에 초점이 있을 때 보인다
  const resettable = editable && field.scope.scope === "user" && !field.dirty;
  const notes = (
    <>
      {layout === "inline" && errorText !== null ? (
        <p role="alert" className="m-0 text-ui text-danger-text">
          {errorText}
        </p>
      ) : null}
      {field.lock === null ? null : (
        <p id={lockId} className="m-0 flex min-w-0 items-center gap-1.5 text-ui text-text-tertiary">
          <Lock aria-hidden className="size-icon-xs flex-none" />
          <span>{field.lock.text}</span>
        </p>
      )}
      {override === null ? null : (
        <RowNote slot="settings-override">
          {override.text}
          {override.path === null ? null : (
            <span className="ms-1.5 font-mono text-mono-sm break-all text-text-tertiary">
              {override.path}
            </span>
          )}
        </RowNote>
      )}
      {remoteNoticeOf(field) ? (
        <RowNote
          slot="settings-remote-changed"
          actions={
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  handlers.discard(field.key);
                }}
              >
                {t("desktop.settings.conflict.useNew")}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  handlers.keepDraft(field.key);
                }}
              >
                {t("desktop.settings.conflict.keepMine")}
              </Button>
            </>
          }
        >
          {t("desktop.settings.conflict.label")}: {t("desktop.settings.field.remoteChanged")}
        </RowNote>
      ) : null}
      {field.deprecated === null ? null : <RowNote>{deprecatedTextOf(field)}</RowNote>}
      {field.problem === null ? null : <RowNote>{t("desktop.settings.field.problem")}</RowNote>}
      {editable && field.dirty && hasFooter(field) ? (
        <div className="flex justify-end gap-2 pt-1" data-slot="settings-field-footer">
          <Button
            variant="outline"
            size={FORM_CONTROL_SIZE}
            onClick={() => {
              handlers.discard(field.key);
            }}
          >
            {t("desktop.settings.field.discard")}
          </Button>
          <Button
            size={FORM_CONTROL_SIZE}
            disabled={field.saving || field.issues.length > 0}
            onClick={() => {
              handlers.commit(field.key);
            }}
          >
            {t("desktop.settings.field.save")}
          </Button>
        </div>
      ) : null}
    </>
  );
  return (
    <SettingRow
      slot="settings-field"
      dataKey={field.key}
      layout={layout}
      group
      labelId={titleId}
      label={field.label}
      info={explain.length === 0 ? undefined : explain}
      infoLabel={t("desktop.settings.field.help.label", { label: field.label })}
      badges={<StatusMark field={field} saved={saved} />}
      description={
        showKey ? (
          <span className="block min-w-0 truncate font-mono text-mono-sm">{field.key}</span>
        ) : undefined
      }
      disabled={field.lock !== null}
      describedBy={field.lock === null ? undefined : lockId}
      lead={resettable ? <ResetButton field={field} handlers={handlers} /> : undefined}
      control={
        <FieldControlView
          field={field}
          control={control}
          disabled={disabled}
          errorText={errorText}
          editors={editors}
          editable={editable}
          handlers={handlers}
        />
      }
      notes={notes}
    />
  );
}

/** 기본값으로 되돌리기. 행에 마우스를 올리거나 초점이 행 안에 있을 때만 보인다(자리는 늘 차지하지 않는다) */
function ResetButton(props: {
  readonly field: FieldVM;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const label = t("desktop.settings.field.reset");
  return (
    <Tooltip side="top" content={label}>
      <IconButton
        size={FORM_CONTROL_SIZE}
        variant="ghost"
        label={label}
        data-slot="settings-reset"
        className="opacity-0 group-focus-within/field:opacity-100 group-hover/field:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          props.handlers.reset(props.field.key);
        }}
      >
        <RotateCcw />
      </IconButton>
    </Tooltip>
  );
}

/** 빈 글 칸의 자리표시. 표에 없는 키는 없다 */
function placeholderOf(key: SettingKey): string | undefined {
  const id = PLACEHOLDER_OF_KEY.get(key);
  return id === undefined ? undefined : t(id);
}

/** 컨트롤 하나. 종류마다 caustic 부품 하나를 고른다(L4.settings-ui §4.2.1) */
function FieldControlView(props: {
  readonly field: FieldVM;
  readonly control: FieldControl;
  readonly disabled: boolean;
  readonly editable: boolean;
  readonly errorText: string | null;
  readonly editors: DedicatedEditors;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, control, disabled, errorText, handlers } = props;
  switch (control) {
    case "switch":
      return (
        <Switch
          size={FORM_CONTROL_SIZE}
          aria-label={field.label}
          checked={field.value === true}
          disabled={disabled}
          className={switchClassOf(field.value === true, disabled)}
          onCheckedChange={(next) => {
            handlers.change(field.key, next);
          }}
        />
      );
    case "select":
      return field.widget.kind === "select" ? (
        <ChoiceField
          field={field}
          options={field.widget.options}
          disabled={disabled}
          errorText={errorText}
          handlers={handlers}
        />
      ) : null;
    case "number":
      return field.widget.kind === "number" ? (
        <NumberControl
          field={field}
          widget={field.widget}
          disabled={disabled}
          errorText={errorText}
          handlers={handlers}
        />
      ) : null;
    case "text":
      return (
        <Input
          size={FORM_CONTROL_SIZE}
          aria-label={field.label}
          containerClassName={PATH_TEXT_KEYS.has(field.key) ? FIELD_WIDTH.full : FIELD_WIDTH.medium}
          placeholder={placeholderOf(field.key)}
          value={textValueOf(field.value)}
          disabled={disabled}
          invalid={errorText !== null}
          spellCheck={false}
          onValueChange={(next) => {
            handlers.edit(field.key, next);
          }}
          onBlur={() => {
            if (field.dirty) handlers.commit(field.key);
          }}
          onKeyDown={(event) => {
            if (isCommitEnter(event) && field.dirty) {
              event.preventDefault();
              handlers.commit(field.key);
            }
          }}
        />
      );
    case "tags":
      return (
        <Field disabled={disabled} error={errorText}>
          <SettingTagList
            settingKey={field.key}
            label={field.label}
            value={tagsOf(field.value)}
            options={field.widget.kind === "list" ? field.widget.options : null}
            disabled={disabled}
            invalid={errorText !== null}
            placeholder={placeholderOf(field.key)}
            onChange={(next) => {
              handlers.edit(field.key, [...next]);
            }}
          />
        </Field>
      );
    case "editor":
      return (
        <Field disabled={disabled} error={errorText}>
          {renderEditor(field, props.editable, props.editors, handlers)}
        </Field>
      );
    case "summary":
      return <ReadonlyValue field={field} />;
    default:
      return assertNever(control, "FieldControl");
  }
}

/**
 * 숫자 칸. 모양은 `numberControlOf` 하나가 정한다: 작은 정수는 ± 스테퍼, 그 밖은 단위가 붙은 글 칸(`QuantityControl`).
 * 스테퍼는 `release` 방식이라 범위 밖 글은 값으로 올라오지 않고 칸 안에 초안으로 남는다. 그 사유는 칸 아래에 보인다.
 */
function NumberControl(props: {
  readonly field: FieldVM;
  readonly widget: Extract<WidgetVM, { readonly kind: "number" }>;
  readonly disabled: boolean;
  readonly errorText: string | null;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const shape = numberControlOf(props.field.key, props.widget);
  const presets = PRESET_OF_KEY.get(props.field.key);
  if (shape.kind === "quantity" && presets !== undefined) {
    return (
      <PresetQuantity
        field={props.field}
        widget={props.widget}
        presets={presets}
        unit={shape.unit}
        disabled={props.disabled}
        invalid={props.errorText !== null}
        handlers={props.handlers}
      />
    );
  }
  if (shape.kind === "quantity") {
    return (
      <QuantityControl
        field={props.field}
        widget={props.widget}
        unit={shape.unit}
        zeroIsNone={shape.zeroIsNone}
        disabled={props.disabled}
        invalid={props.errorText !== null}
        handlers={props.handlers}
      />
    );
  }
  return <StepperControl {...props} />;
}

/** ± 스테퍼(작은 정수). 칸 안에서 치는 글은 저장 전까지 칸이 쥐고 컨트롤러에도 초안으로 알린다 */
function StepperControl(props: {
  readonly field: FieldVM;
  readonly widget: Extract<WidgetVM, { readonly kind: "number" }>;
  readonly disabled: boolean;
  readonly errorText: string | null;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, widget, disabled, handlers } = props;
  const [draftError, setDraftError] = useState<NumberFieldDraft["error"]>(null);
  // 저장으로 칸이 비는 알림과 Esc로 되돌리는 알림을 가른다
  const committing = useRef(false);
  const escaped = useRef(false);
  const draftText = numberDraftTextOf(draftError, widget);
  const invalid = props.errorText !== null || draftText !== null;
  return (
    <span className="grid justify-items-end gap-1">
      <NumberField
        appearance="stepper"
        size={FORM_CONTROL_SIZE}
        aria-label={field.label}
        commitMode="release"
        value={numberValueOf(field.value)}
        min={widget.min ?? undefined}
        max={widget.max ?? undefined}
        step={1}
        disabled={disabled}
        invalid={invalid}
        onDraftChange={(draft) => {
          setDraftError(draft.error);
          const action = numberDraftActionOf(draft, {
            fieldDirty: field.dirty,
            committing: committing.current,
            escaped: escaped.current,
          });
          if (action?.kind === "edit") handlers.edit(field.key, action.value);
          else if (action?.kind === "discard") handlers.discard(field.key);
          else if (action?.kind === "commit") handlers.commit(field.key);
          committing.current = false;
          escaped.current = false;
        }}
        onKeyDown={(event) => {
          escaped.current = event.key === "Escape";
        }}
        onValueChange={(next) => {
          setDraftError(null);
          committing.current = true;
          handlers.change(field.key, next);
        }}
      />
      {draftText === null ? null : (
        <span role="alert" className="text-ui text-danger-text">
          {draftText}
        </span>
      )}
    </span>
  );
}

/** 스테퍼 칸 입력이 값으로 받아지지 않을 때 칸 아래에 보일 이유. 범위는 스키마의 min/max에서 만든다 */
function numberDraftTextOf(
  error: NumberFieldDraft["error"],
  widget: Extract<WidgetVM, { readonly kind: "number" }>,
): string | null {
  switch (error) {
    case null:
      return null;
    case "empty":
      return t("desktop.settings.field.number.empty");
    case "syntax":
      return t("desktop.settings.field.number.syntax");
    case "range":
      return rangeTextOf(widget);
    default:
      return assertNever(error, "CommittedValueError");
  }
}

/**
 * 고르기. 선택지에 설명(`optionHelpOf`)이 있으면 두 줄 행의 세로 라디오 묶음이고(설명이 라벨 아래 한 줄), 아니면 오른쪽 선택 상자다.
 * 경고 선택지를 고르면 묶음 아래에 같은 설명을 경고 줄로 보인다(`choiceWarningOf`). 확인 대화는 없다.
 */
function ChoiceField(props: {
  readonly field: FieldVM;
  readonly options: readonly (string | number)[];
  readonly disabled: boolean;
  readonly errorText: string | null;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, options, disabled, errorText, handlers } = props;
  const text = choiceTextOf(field.value);
  const choose = (next: string): void => {
    const option = optionOf(options, next);
    if (option !== null) handlers.change(field.key, option);
  };
  const described = options.some((option) => optionHelpOf(field.key, option) !== null);
  if (!described && SEGMENTED_KEYS.has(field.key) && options.length <= SEGMENTED_MAX) {
    return (
      <SegmentedControl
        size={FORM_CONTROL_SIZE}
        aria-label={field.label}
        value={text}
        disabled={disabled}
        onValueChange={choose}
      >
        {options.map((option) => (
          <SegmentedControlItem key={optionTextOf(option)} value={optionTextOf(option)}>
            {optionLabelOf(field.key, option)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    );
  }
  if (!described) {
    return (
      <Select
        size={FORM_CONTROL_SIZE}
        aria-label={field.label}
        value={text}
        disabled={disabled}
        invalid={errorText !== null}
        className={FIELD_WIDTH.medium}
        onValueChange={choose}
      >
        {options.map((option) => (
          <SelectOption key={optionTextOf(option)} value={optionTextOf(option)}>
            {optionLabelOf(field.key, option)}
          </SelectOption>
        ))}
      </Select>
    );
  }
  const warning = choiceWarningOf(field.key, text);
  return (
    <Field disabled={disabled} error={errorText}>
      <RadioGroup
        aria-label={field.label}
        orientation="vertical"
        value={text}
        disabled={disabled}
        onValueChange={choose}
        className="gap-y-2"
      >
        {options.map((option) => (
          <RadioGroupItem
            key={optionTextOf(option)}
            value={optionTextOf(option)}
            description={optionHelpOf(field.key, option) ?? undefined}
          >
            {optionLabelOf(field.key, option)}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      {warning === null ? null : (
        <RowNote tone="danger" slot="settings-choice-warning">
          {warning}
        </RowNote>
      )}
    </Field>
  );
}

/** 전용 편집기 그림. 종류에 그림이 없으면 요약으로 물러난다. 편집기는 부품으로 그린다(안의 상태 훅이 항목마다 따로 선다) */
function renderEditor(
  field: FieldVM,
  editable: boolean,
  editors: DedicatedEditors,
  handlers: FieldHandlers,
): ReactNode {
  const kind = dedicatedEditorOf(field);
  const Editor = kind === null ? undefined : editors[kind];
  if (Editor === undefined) {
    return <p className="m-0 text-ui text-text-secondary">{summaryTextOf(field)}</p>;
  }
  return <Editor field={field} editable={editable} handlers={handlers} />;
}

/** 읽기 값. 객체와 배열은 접힌 JSON 보기로, 원시 값은 글로 보인다(L4.settings-ui §4.2.1 readonly) */
function ReadonlyValue(props: { readonly field: FieldVM }): ReactNode {
  const { field } = props;
  if (!foldableOf(field.value)) {
    return <p className="m-0 text-ui text-text-secondary">{summaryTextOf(field)}</p>;
  }
  return (
    <Accordion variant="ghost">
      <AccordionItem value="json">
        <AccordionTrigger>{t("desktop.settings.field.json.title")}</AccordionTrigger>
        <AccordionContent>
          <pre className="text-ui break-all whitespace-pre-wrap text-text-secondary">
            {JSON.stringify(field.value, null, 2)}
          </pre>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** 읽기 요약. 표는 항목 수를, 시크릿은 참조 글을, 원시 값은 글을 보인다 */
function summaryTextOf(field: FieldVM): string {
  const summary = valueSummaryOf(field.value);
  switch (summary.kind) {
    case "empty":
      return t("desktop.settings.field.emptyValue");
    case "count":
      return t("desktop.settings.field.itemCount", { count: summary.count });
    case "text":
      return summary.text;
    default:
      return assertNever(summary, "ValueSummary");
  }
}

function deprecatedTextOf(field: FieldVM): string {
  const deprecated = field.deprecated;
  if (deprecated === null) return "";
  const head = t("desktop.settings.field.deprecated", { since: deprecated.since });
  if (deprecated.replacedByLabel === null) return head;
  return `${head} ${t("desktop.settings.field.deprecatedReplaced", { label: deprecated.replacedByLabel })}`;
}
