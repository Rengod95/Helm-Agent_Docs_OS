import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  FormLayoutFooter,
  Input,
  NumberField,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectOption,
  Switch,
  TagInput,
} from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { scopeText, type FieldVM, type WritableScope } from "@fresnel/client/settings";
import { assertNever } from "@fresnel/contracts";
import type { SettingKey } from "@fresnel/contracts/settings";
import { useId, type ReactNode } from "react";
import {
  dedicatedEditorOf,
  fallbackScopeOf,
  fieldControlOf,
  foldableOf,
  hasFooter,
  type DedicatedEditorKind,
  launchChoiceOf,
  numberValueOf,
  optionOf,
  optionTextOf,
  remoteNoticeOf,
  scopeChoiceShown,
  selectControlOf,
  tagsOf,
  textValueOf,
  valueSummaryOf,
  writableOf,
} from "./settings-model.ts";
import { RUNTIME_TONE, SCOPE_TONE, TONE_CLASS } from "./settings-text.ts";

// 설정 항목 한 줄(P-09)의 그림. 위젯 종류마다 caustic 부품 하나를 고른다(L4.settings-ui §4.2.1).
// 표(table), 시크릿(secret)은 전용 편집기(`editors`, 종류마다 그림 하나: P-11 `pages/providers`, P-09 `pages/settings`)로 그린다.
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
  readonly selectScope: (key: SettingKey, scope: WritableScope) => void;
  /** 범위 값을 지운다 */
  readonly reset: (key: SettingKey, scope: WritableScope) => void;
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
  readonly hasThread: boolean;
  /** "저장됨" 표시가 아직 보이는가 */
  readonly saved: boolean;
  readonly editors: DedicatedEditors;
  readonly handlers: FieldHandlers;
}

/** 항목 아래 오류 문장. 저장 오류가 있으면 그것을, 없으면 초안의 첫 검사 문장이다 */
function errorTextOf(field: FieldVM): string | null {
  if (field.error !== null) return field.error.message;
  return field.issues[0]?.message ?? null;
}

/** 숫자 칸의 설명 줄. 단위가 있으면 설명 뒤에 덧붙인다 */
function numberHintOf(hint: string | null, unit: string | null): string | null {
  if (unit === null) return hint;
  return hint === null ? unit : `${hint} · ${unit}`;
}

function choiceTextOf(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function FieldRow(props: FieldRowProps): ReactNode {
  const { field, editable, hasThread, saved, editors, handlers } = props;
  const lockId = useId();
  const disabled = !editable;
  const errorText = errorTextOf(field);
  const control = fieldControlOf(field);
  const unit = field.widget.kind === "number" ? field.widget.unit : null;
  const hint = field.help;
  const writable = writableOf(field.scope.scope);
  return (
    <div
      data-slot="settings-field"
      data-key={field.key}
      aria-disabled={field.lock === null ? undefined : true}
      aria-describedby={field.lock === null ? undefined : lockId}
      className="flex flex-col gap-2 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui-strong text-text-primary">{field.label}</span>
        <Badge className={TONE_CLASS[SCOPE_TONE[field.scope.tone]]}>{field.scope.text}</Badge>
        <Badge className={TONE_CLASS[RUNTIME_TONE[field.runtime.change]]}>
          {field.runtime.text}
        </Badge>
        {saved ? (
          <Badge className={TONE_CLASS.success} role="status">
            {t("desktop.settings.field.saved")}
          </Badge>
        ) : null}
      </div>
      {field.lock === null ? null : (
        <p id={lockId} className="text-ui-sm text-text-tertiary">
          {field.lock.text}
        </p>
      )}
      {field.runtime.pendingText === null ? null : (
        <p className="text-ui-sm text-text-tertiary">{field.runtime.pendingText}</p>
      )}
      {control === "switch" ? (
        <Field group label={field.label} hint={hint} error={errorText} disabled={disabled}>
          <Switch
            aria-label={field.label}
            checked={field.value === true}
            disabled={disabled}
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
          hint={hint}
          handlers={handlers}
        />
      ) : null}
      {control === "number" && field.widget.kind === "number" ? (
        <Field
          label={field.label}
          hint={numberHintOf(hint, unit)}
          error={errorText}
          disabled={disabled}
        >
          <NumberField
            appearance="stepper"
            commitMode="release"
            value={numberValueOf(field.value)}
            min={field.widget.min ?? undefined}
            max={field.widget.max ?? undefined}
            step={field.widget.integer ? 1 : undefined}
            disabled={disabled}
            invalid={errorText !== null}
            onValueChange={(next) => {
              handlers.change(field.key, next);
            }}
          />
        </Field>
      ) : null}
      {control === "text" ? (
        <Field label={field.label} hint={hint} error={errorText} disabled={disabled}>
          <Input
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
              if (event.key === "Enter" && field.dirty) {
                event.preventDefault();
                handlers.commit(field.key);
              }
            }}
          />
        </Field>
      ) : null}
      {control === "tags" ? (
        <Field label={field.label} hint={hint} error={errorText} disabled={disabled}>
          <TagInput
            value={[...tagsOf(field.value)]}
            disabled={disabled}
            invalid={errorText !== null}
            onValueChange={(next) => {
              handlers.edit(field.key, next);
            }}
          />
        </Field>
      ) : null}
      {control === "editor" ? (
        <Field group label={field.label} hint={hint} error={errorText} disabled={disabled}>
          {renderEditor(field, editable, editors, handlers)}
        </Field>
      ) : null}
      {control === "summary" ? (
        <Field
          group
          label={field.label}
          hint={t("desktop.settings.field.fileHint")}
          disabled={disabled}
        >
          <ReadonlyValue field={field} />
        </Field>
      ) : null}
      {field.saving ? (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.settings.field.saving")}
        </p>
      ) : null}
      {remoteNoticeOf(field) ? (
        <Alert tone="warning" variant="ghost" size="sm">
          {t("desktop.settings.field.remoteChanged")}
        </Alert>
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
      {field.shadowed.length === 0 ? null : <ShadowedNote field={field} />}
      {editable && scopeChoiceShown(field) ? (
        <ScopeChoice field={field} handlers={handlers} />
      ) : null}
      <LaunchChoice field={field} hasThread={hasThread} disabled={disabled} handlers={handlers} />
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
      {field.canReset && writable !== null && editable ? (
        <div>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              handlers.reset(field.key, writable);
            }}
          >
            {t("desktop.settings.field.reset")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 고르기 칸. 선택지가 여덟 이하면 라디오 묶음, 넘으면 선택 상자다 */
function ChoiceField(props: {
  readonly field: FieldVM;
  readonly options: readonly (string | number)[];
  readonly disabled: boolean;
  readonly errorText: string | null;
  readonly hint: string | null;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, options, disabled, errorText, hint, handlers } = props;
  const text = choiceTextOf(field.value);
  const choose = (next: string): void => {
    const option = optionOf(options, next);
    if (option !== null) handlers.change(field.key, option);
  };
  return (
    <Field group label={field.label} hint={hint} error={errorText} disabled={disabled}>
      {selectControlOf(options.length) === "radio" ? (
        <RadioGroup
          aria-label={field.label}
          value={text}
          disabled={disabled}
          onValueChange={choose}
          className="gap-1"
        >
          {options.map((option) => (
            <RadioGroupItem key={optionTextOf(option)} value={optionTextOf(option)}>
              {optionTextOf(option)}
            </RadioGroupItem>
          ))}
        </RadioGroup>
      ) : (
        <Select
          aria-label={field.label}
          value={text}
          disabled={disabled}
          invalid={errorText !== null}
          onValueChange={choose}
        >
          {options.map((option) => (
            <SelectOption key={optionTextOf(option)} value={optionTextOf(option)}>
              {optionTextOf(option)}
            </SelectOption>
          ))}
        </Select>
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
    return <p className="text-ui-sm text-text-secondary">{summaryTextOf(field)}</p>;
  }
  return <Editor field={field} editable={editable} handlers={handlers} />;
}

/** 읽기 값. 객체와 배열은 접힌 JSON 보기로, 원시 값은 글로 보인다(L4.settings-ui §4.2.1 readonly) */
function ReadonlyValue(props: { readonly field: FieldVM }): ReactNode {
  const { field } = props;
  if (!foldableOf(field.value)) {
    return <p className="text-ui-sm text-text-secondary">{summaryTextOf(field)}</p>;
  }
  return (
    <Accordion variant="ghost">
      <AccordionItem value="json">
        <AccordionTrigger>{t("desktop.settings.field.json.title")}</AccordionTrigger>
        <AccordionContent>
          <pre className="text-ui-sm break-all whitespace-pre-wrap text-text-secondary">
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

/** 다른 범위에 같은 키 값이 있어 가려져 있을 때의 접힌 안내 */
function ShadowedNote(props: { readonly field: FieldVM }): ReactNode {
  return (
    <Accordion variant="ghost">
      <AccordionItem value="shadowed">
        <AccordionTrigger>
          {t("desktop.settings.shadowed.title", { count: props.field.shadowed.length })}
        </AccordionTrigger>
        <AccordionContent>
          <ul className="text-ui-sm text-text-secondary">
            {props.field.shadowed.map((item) => (
              <li key={`${item.scope}:${item.path ?? ""}`}>
                {t("desktop.settings.shadowed.item", { scope: scopeText(item.scope) })}
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** 쓸 범위 고르기. 범위가 둘 이상일 때만 보인다 */
function ScopeChoice(props: {
  readonly field: FieldVM;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const { field, handlers } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-ui-sm text-text-tertiary">
        {t("desktop.settings.field.scope.label")}
      </span>
      <Select
        aria-label={t("desktop.settings.field.scope.label")}
        size="sm"
        value={field.selectedScope ?? ""}
        onValueChange={(next) => {
          const scope = field.writableScopes.find((candidate) => candidate === next);
          if (scope === undefined) return;
          handlers.selectScope(field.key, scope);
          if (field.dirty) handlers.commit(field.key);
        }}
      >
        {field.writableScopes.map((scope) => (
          <SelectOption key={scope} value={scope}>
            {scopeText(scope)}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}

/** "이번 대화에만 적용". 열린 대화가 있고 대화 범위를 쓸 수 있을 때만 보인다 */
function LaunchChoice(props: {
  readonly field: FieldVM;
  readonly hasThread: boolean;
  readonly disabled: boolean;
  readonly handlers: FieldHandlers;
}): ReactNode {
  const labelId = useId();
  const { field, hasThread, disabled, handlers } = props;
  const choice = launchChoiceOf(field, hasThread);
  if (!choice.shown) return null;
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        aria-labelledby={labelId}
        checked={choice.checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          if (next === true) {
            handlers.selectScope(field.key, "launch");
          } else {
            const fallback = fallbackScopeOf(field);
            if (fallback !== null) handlers.selectScope(field.key, fallback);
          }
          if (field.dirty) handlers.commit(field.key);
        }}
      />
      <span id={labelId} className="text-ui-sm text-text-secondary">
        {t("desktop.settings.field.launchOnly")}
      </span>
    </div>
  );
}
