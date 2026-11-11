import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Field,
  FormLayoutFooter,
  IconButton,
  Input,
  NumberField,
  type NumberFieldDraft,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
  Tooltip,
} from "@caustic/react";
import { Check, CircleHelp, Lock, TriangleAlert } from "@caustic/react/icons";
import { activeLocale, t } from "@fresnel/client/i18n";
import type { FieldVM, RuntimeBadge, WidgetVM } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import { useId, useRef, useState, type ReactNode } from "react";
import {
  dedicatedEditorOf,
  choiceWarningOf,
  fieldControlOf,
  foldableOf,
  hasFooter,
  optionHelpOf,
  overrideWarningOf,
  resetShownOf,
  type DedicatedEditorKind,
  type FieldControl,
  numberDraftActionOf,
  numberValueOf,
  optionOf,
  optionLabelOf,
  optionTextOf,
  remoteNoticeOf,
  selectControlOf,
  switchClassOf,
  tagsOf,
  textValueOf,
  valueSummaryOf,
} from "./settings-model.ts";
import { isCommitEnter } from "../../ime-enter.ts";
import {
  formatQuantity,
  numberStyleOf,
  parseQuantity,
  quantityStepOf,
  quantitySummaryOf,
  quantitySummaryShownOf,
  type DurationWords,
} from "./settings-quantity-model.ts";
import { TONE_CLASS } from "./settings-text.ts";
import { SettingTagList } from "./settings-tag-list.tsx";

// 설정 항목 한 줄(P-09)의 그림. 줄은 제목 하나와 컨트롤 하나로 이루어진다(P-09 `_settings/row.tsx`, c04).
//   머리: 제목(라벨) · 정보 아이콘(설명은 아이콘 뒤 말풍선과 화면 낭독기 설명) ………… 저장됨 또는 저장 중 또는 적용 시점
//         적용 시점은 "즉시"를 적지 않고, 다음 턴은 연한 글, 재시작 필요만 warning 배지다. 범위 고르기는 없다(쓰기는 사용자 범위다).
//   다음 줄: 컨트롤(자기 폭). 오류와 경고는 컨트롤 아래에 보인다. 잠금 문장은 그 아래에 보인다.
//         다른 층이 사용자 값을 덮으면 잠금 문장 아래에 그 경고 줄을 보인다(`OverrideNote`).
// 위젯 종류마다 caustic 부품 하나를 고른다(L4.settings-ui §4.2.1). 표(table), 시크릿(secret)은 전용 편집기(`editors`)로 그린다.
// 읽기 전용(readonly)은 객체와 배열을 접힌 JSON으로 보인다. 검색 순서는 도구와 웹 패널이 맡는다(`panelOwnedOf`).
// 상태와 명령은 없고 `handlers`만 받는다.

export interface FieldHandlers {
  /** 초안만 바꾼다(글 칸과 목록 칸은 저장 버튼이나 떠날 때 저장한다) */
  readonly edit: (key: SettingKey, raw: unknown) => void;
  /** 바꾸고 바로 저장한다(켜기, 고르기, 숫자 칸) */
  readonly change: (key: SettingKey, raw: unknown) => void;
  /** 초안을 저장한다 */
  readonly commit: (key: SettingKey) => void;
  readonly discard: (key: SettingKey) => void;
  /** 다른 곳에서 바뀐 값을 두고 내 초안을 유지한다("내 값 유지") */
  readonly keepDraft: (key: SettingKey) => void;
  /** 사용자 범위의 값을 지운다 */
  readonly reset: (key: SettingKey) => void;
}

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
  /** 찾기 결과에서만 참이다. 라벨 옆에 설정 키를 보인다(시안 `_settings/row.tsx` showKey) */
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

/** "저장됨". 저장한 뒤 2초 동안 적용 시점 자리에 보인다(P-09 `SavedMark`) */
export function SavedMark(): ReactNode {
  return (
    <span role="status" className="inline-flex items-center gap-1 text-ui text-success-text">
      <Check aria-hidden className="size-icon-sm" />
      {t("desktop.settings.field.saved")}
    </span>
  );
}

/** 적용 시점 자리. "즉시"는 적지 않고, 다음 턴은 연한 글, 재시작은 warning 배지다(c04 DP-36) */
function ApplyMark(props: { readonly runtime: RuntimeBadge }): ReactNode {
  const { change, text } = props.runtime;
  switch (change) {
    case "live":
      return null;
    case "nextTurn":
      return <span className="text-ui text-text-tertiary">{text}</span>;
    case "restart":
      return (
        <Badge size="sm" className={TONE_CLASS.warning}>
          {text}
        </Badge>
      );
    default:
      return assertNever(change, "RuntimeChange");
  }
}

/** 저장 중 자리. 저장하는 동안 적용 시점 자리에 짧은 글을 보인다(표시 줄은 칸 옆이 아니라 머리에 둔다) */
function SavingMark(): ReactNode {
  return (
    <span role="status" className="text-ui text-text-tertiary">
      {t("desktop.settings.field.saving")}
    </span>
  );
}

/**
 * 설명 줄 모음. 설명, 재시작 대기 문장, 엔진 연결 안내, 파일 안내는 정보 아이콘 뒤에 둔다.
 * 경고와 오류, 잠금 문장과 바깥 변경 알림은 그대로 보인다.
 */
function explanationOf(field: FieldVM, control: FieldControl): readonly string[] {
  const lines = [
    field.help,
    field.runtime.pendingText,
    field.offlineNote,
    control === "summary" ? t("desktop.settings.field.fileHint") : null,
  ];
  return lines.filter((line): line is string => line !== null && line !== "");
}

/**
 * 정보 아이콘 하나. 설명 줄은 마우스 올림과 초점에서 말풍선으로 뜬다. 화면 낭독기에는 같은 글이 설명(sr-only)으로 간다.
 */
export function InfoTip(props: {
  readonly label: string;
  readonly lines: readonly string[];
}): ReactNode {
  const id = useId();
  return (
    <>
      <Tooltip
        content={
          <span className="grid max-w-72 gap-1 whitespace-normal">
            {props.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        }
      >
        <IconButton
          size="xs"
          variant="ghost"
          label={t("desktop.settings.field.help.label", { label: props.label })}
          aria-describedby={id}
        >
          <CircleHelp />
        </IconButton>
      </Tooltip>
      <span id={id} className="sr-only">
        {props.lines.join(" ")}
      </span>
    </>
  );
}

export function FieldRow(props: FieldRowProps): ReactNode {
  const { field, editable, saved, editors, handlers, showKey = false } = props;
  const titleId = useId();
  const lockId = useId();
  const disabled = !editable;
  const errorText = errorTextOf(field);
  const control = fieldControlOf(field);
  const explain = explanationOf(field, control);
  return (
    <div
      data-slot="settings-field"
      data-key={field.key}
      role="group"
      aria-labelledby={titleId}
      aria-disabled={field.lock === null ? undefined : true}
      aria-describedby={field.lock === null ? undefined : lockId}
      className="grid gap-1.5 py-3"
    >
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
          <span id={titleId} className="shrink-0 text-ui font-medium text-text-primary">
            {field.label}
          </span>
          {explain.length === 0 ? null : <InfoTip label={field.label} lines={explain} />}
          {showKey ? (
            <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
              {field.key}
            </span>
          ) : null}
        </div>
        <div className="flex flex-none items-center gap-2">
          {saved ? (
            <SavedMark />
          ) : field.saving ? (
            <SavingMark />
          ) : (
            <ApplyMark runtime={field.runtime} />
          )}
        </div>
      </div>
      {control === "switch" ? (
        <Field disabled={disabled} error={errorText}>
          <Switch
            size="sm"
            aria-label={field.label}
            checked={field.value === true}
            disabled={disabled}
            className={switchClassOf(field.value === true, disabled)}
            onCheckedChange={(next) => {
              handlers.change(field.key, next);
            }}
          />
        </Field>
      ) : null}
      {control === "select" && field.widget.kind === "select" ? (
        <ChoiceField
          field={field}
          options={field.widget.options}
          disabled={disabled}
          errorText={errorText}
          handlers={handlers}
        />
      ) : null}
      {control === "number" && field.widget.kind === "number" ? (
        <NumberControl
          field={field}
          widget={field.widget}
          disabled={disabled}
          errorText={errorText}
          handlers={handlers}
        />
      ) : null}
      {control === "text" ? (
        <Field disabled={disabled} error={errorText}>
          <Input
            size="sm"
            aria-label={field.label}
            containerClassName="w-[min(20rem,100%)]"
            value={textValueOf(field.value)}
            disabled={disabled}
            invalid={errorText !== null}
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
        </Field>
      ) : null}
      {control === "tags" ? (
        <Field disabled={disabled} error={errorText}>
          <SettingTagList
            settingKey={field.key}
            label={field.label}
            value={tagsOf(field.value)}
            options={field.widget.kind === "list" ? field.widget.options : null}
            disabled={disabled}
            invalid={errorText !== null}
            onChange={(next) => {
              handlers.edit(field.key, [...next]);
            }}
          />
        </Field>
      ) : null}
      {control === "editor" ? (
        <Field disabled={disabled} error={errorText}>
          {renderEditor(field, editable, editors, handlers)}
        </Field>
      ) : null}
      {control === "summary" ? <ReadonlyValue field={field} /> : null}
      {field.lock === null ? null : (
        <p id={lockId} className="m-0 flex min-w-0 items-center gap-1.5 text-ui text-text-tertiary">
          <Lock aria-hidden className="size-icon-xs flex-none" />
          <span>{field.lock.text}</span>
        </p>
      )}
      <OverrideNote field={field} />
      {remoteNoticeOf(field) ? (
        <div className="grid gap-1.5" data-slot="settings-remote-changed">
          <Alert tone="warning" variant="ghost" size="sm">
            {t("desktop.settings.conflict.label")}: {t("desktop.settings.field.remoteChanged")}
          </Alert>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>
      ) : null}
      {field.deprecated === null ? null : (
        <Alert tone="warning" variant="ghost" size="sm">
          {deprecatedTextOf(field)}
        </Alert>
      )}
      {field.problem === null ? null : (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.settings.field.problem")}
        </Alert>
      )}
      {editable && field.dirty && hasFooter(field) ? (
        <FormLayoutFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              handlers.discard(field.key);
            }}
          >
            {t("desktop.settings.field.discard")}
          </Button>
          <Button
            size="sm"
            disabled={field.saving || field.issues.length > 0}
            onClick={() => {
              handlers.commit(field.key);
            }}
          >
            {t("desktop.settings.field.save")}
          </Button>
        </FormLayoutFooter>
      ) : null}
      {editable && resetShownOf(field) ? (
        <div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              handlers.reset(field.key);
            }}
          >
            {t("desktop.settings.field.reset")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 숫자 칸 입력이 값으로 받아지지 않을 때 칸 아래에 보일 이유. 범위는 스키마의 min/max에서 만든다 */
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
      if (widget.min !== null && widget.max !== null) {
        return t("client.settings.field.invalidRange", { min: widget.min, max: widget.max });
      }
      if (widget.min !== null) return t("client.settings.field.invalidMin", { min: widget.min });
      if (widget.max !== null) return t("client.settings.field.invalidMax", { max: widget.max });
      return t("client.settings.field.invalidValue");
    default:
      return assertNever(error, "CommittedValueError");
  }
}

/**
 * 숫자 칸. 칸은 `release` 방식이라 범위 밖 글은 값으로 올라오지 않고 칸 안에 초안으로 남는다.
 * 그 초안의 사유는 `onDraftChange`로만 알 수 있어 여기서 받아 칸 아래 오류 문장으로 보인다.
 */
/** 단위 있는 글 칸의 요약에 쓰는 기간 낱말 */
function durationWordsOf(): DurationWords {
  return {
    seconds: (n) => t("desktop.settings.number.duration.seconds", { n }),
    minutes: (n) => t("desktop.settings.number.duration.minutes", { n }),
    hours: (n) => t("desktop.settings.number.duration.hours", { n }),
    days: (n) => t("desktop.settings.number.duration.days", { n }),
  };
}

/**
 * 숫자 칸. 칸은 `release` 방식이라 범위 밖 글은 값으로 올라오지 않고 칸 안에 초안으로 남는다.
 * 그 초안의 사유는 `onDraftChange`로만 알 수 있어 여기서 받아 칸 아래 오류 문장으로 보인다.
 * `numberStyleOf`가 "stepper"로 고른 작은 정수 칸만 ±가 있다. 나머지("quantity")는 ±가 없는 글 칸이다.
 * 글 칸은 단위 꼬리표를 칸 안에 두고, 요약 한 줄을 칸 아래에 보인다. 칸을 떠나면 천 단위 구분으로 정돈된다.
 */
function NumberControl(props: {
  readonly field: FieldVM;
  readonly widget: Extract<WidgetVM, { readonly kind: "number" }>;
  readonly disabled: boolean;
  readonly errorText: string | null;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, widget, disabled, handlers } = props;
  const [draftError, setDraftError] = useState<NumberFieldDraft["error"]>(null);
  // 요약은 칸이 읽은 초안 값을 따른다. 초안이 없을 때는 저장된 값이다
  const [draftValue, setDraftValue] = useState<number | null>(null);
  // 저장으로 칸이 비는 알림과 Esc로 되돌리는 알림을 가른다
  const committing = useRef(false);
  const escaped = useRef(false);
  const errorText = props.errorText ?? numberDraftTextOf(draftError, widget);
  const quantity = numberStyleOf(widget) === "quantity";
  const locale = activeLocale();
  const shown = field.dirty ? draftValue : numberValueOf(field.value);
  const unitTag = { id: widget.unitId, label: widget.unit };
  const summaryText =
    quantity && errorText === null && shown !== null
      ? quantitySummaryOf(shown, unitTag, { locale, words: durationWordsOf() })
      : null;
  const summary =
    summaryText !== null &&
    shown !== null &&
    quantitySummaryShownOf(shown, summaryText, unitTag, locale)
      ? summaryText
      : null;
  const parseText = (text: string): number | null =>
    parseQuantity(text, widget.unitId, widget.integer);
  const formatText = (value: number): string => formatQuantity(value, locale);
  const input = (
    <NumberField
      appearance={quantity ? "scrub" : "stepper"}
      size={quantity ? "lg" : "sm"}
      variant="outline"
      containerClassName={quantity ? "w-44" : "w-36"}
      placeholder={quantity ? t("desktop.settings.number.placeholder") : undefined}
      aria-label={field.label}
      commitMode="release"
      value={numberValueOf(field.value)}
      min={widget.min ?? undefined}
      max={widget.max ?? undefined}
      step={quantity ? quantityStepOf(shown) : widget.integer ? 1 : undefined}
      unit={quantity && widget.unit !== null ? widget.unit : undefined}
      parse={quantity ? parseText : undefined}
      formatValue={quantity ? formatText : undefined}
      disabled={disabled}
      invalid={errorText !== null}
      onDraftChange={(draft) => {
        setDraftError(draft.error);
        setDraftValue(draft.error === null ? draft.value : null);
        // 칸 안에서 치는 글은 저장 전까지 칸이 쥔다. 컨트롤러에도 초안으로 알려야 그 사이 다른 곳이 바꾼 값을 "다른 곳에서 바뀜"으로 알아챈다(scA-4-2)
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
  );
  return (
    <Field disabled={disabled} error={errorText}>
      {quantity ? (
        <span className="grid min-w-0 justify-items-start gap-1">
          {input}
          {summary === null ? null : (
            <span className="text-ui text-text-tertiary tabular-nums">{summary}</span>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {input}
          {widget.unit === null ? null : (
            <span className="text-ui text-text-tertiary">{widget.unit}</span>
          )}
        </span>
      )}
    </Field>
  );
}

/**
 * 고르기 칸. 선택지가 여덟 이하면 라디오 묶음, 넘으면 선택 상자다. 네 개 이하는 한 줄로 늘어놓는다(c04, P-09).
 * 선택지에 설명(`optionHelpOf`)이 하나라도 있으면 라디오 묶음을 세로로 놓고 설명을 라벨 아래 한 줄로 보인다.
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
  const warning = choiceWarningOf(field.key, text);
  return (
    <Field disabled={disabled} error={errorText}>
      {selectControlOf(options.length) === "radio" ? (
        <RadioGroup
          aria-label={field.label}
          orientation={described ? "vertical" : "horizontal"}
          value={text}
          disabled={disabled}
          onValueChange={choose}
          className={described ? "gap-y-2" : "min-h-7 gap-x-5 gap-y-1"}
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
      ) : (
        <Select
          size="sm"
          aria-label={field.label}
          value={text}
          disabled={disabled}
          invalid={errorText !== null}
          className="w-[min(20rem,100%)]"
          onValueChange={choose}
        >
          {options.map((option) => (
            <SelectOption key={optionTextOf(option)} value={optionTextOf(option)}>
              {optionLabelOf(field.key, option)}
            </SelectOption>
          ))}
        </Select>
      )}
      {warning === null ? null : (
        <p
          role="note"
          data-slot="settings-choice-warning"
          className="m-0 flex min-w-0 items-start gap-1.5 text-ui text-danger-text"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-icon-xs flex-none" />
          <span>{warning}</span>
        </p>
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
    return <p className="text-ui text-text-secondary">{summaryTextOf(field)}</p>;
  }
  return <Editor field={field} editable={editable} handlers={handlers} />;
}

/** 읽기 값. 객체와 배열은 접힌 JSON 보기로, 원시 값은 글로 보인다(L4.settings-ui §4.2.1 readonly) */
function ReadonlyValue(props: { readonly field: FieldVM }): ReactNode {
  const { field } = props;
  if (!foldableOf(field.value)) {
    return <p className="text-ui text-text-secondary">{summaryTextOf(field)}</p>;
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

/**
 * 다른 층이 사용자 값을 덮을 때의 경고 줄. 항목 아래에 늘 보이고 도움말 아이콘 뒤로 숨기지 않는다(`overrideWarningOf`).
 * 경로가 있으면 파일 경로를 붙인다.
 */
function OverrideNote(props: { readonly field: FieldVM }): ReactNode {
  const warning = overrideWarningOf(props.field);
  if (warning === null) return null;
  const text =
    warning.path === null
      ? t("desktop.settings.field.overridden", { scope: warning.scopeName })
      : t("desktop.settings.field.overriddenPath", {
          scope: warning.scopeName,
          path: warning.path,
        });
  return (
    <Alert tone="warning" variant="ghost" size="sm">
      {text}
    </Alert>
  );
}
