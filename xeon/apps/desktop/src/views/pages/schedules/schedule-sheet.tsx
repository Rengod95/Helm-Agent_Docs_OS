import { t } from "@fresnel/client/i18n";
import type { ScheduleTriggerKind, TriggerDraft } from "@fresnel/client";
import { assertNever } from "@fresnel/contracts";
import {
  Alert,
  Button,
  Field,
  Input,
  NumberField,
  SegmentedControl,
  SegmentedControlItem,
  Sheet,
  Switch,
  TagInput,
  Textarea,
} from "@caustic/react";
import { useId, type ReactNode } from "react";
import {
  expiresInputOf,
  expiresTextOf,
  localInputOf,
  msOfLocalInput,
  type ScheduleDraft,
  type SheetField,
} from "./schedule-draft.ts";
import type { SheetState } from "./schedule-model.ts";
import { triggerKindId, TRIGGER_KINDS, type MessageRef } from "./schedule-text.ts";

// 새 예약 시트(O-08). 입력은 `ScheduleDraft`로 올리고 검사와 저장은 화면이 한다. 작업 폴더는 경로 글자 칸이다
// (OS 폴더 고르기는 새 의존 승인이 없어 쓰지 않는다, shell/README.md). 숫자 칸은 `NumberField`(단위 글자 포함)로 그리고,
// 글 상태(`ScheduleDraft`)와는 `numberOf`와 `String`으로 오간다.

export interface ScheduleSheetProps {
  readonly sheet: SheetState | null;
  readonly onChange: (draft: ScheduleDraft) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
}

function textOf(ref: MessageRef | undefined): ReactNode {
  return ref === undefined ? undefined : t(ref.id, ref.args);
}

function kindOf(value: string): ScheduleTriggerKind | null {
  return TRIGGER_KINDS.find((kind) => kind === value) ?? null;
}

/** 숫자 칸에 보일 값. 빈 글이나 숫자가 아니면 null이다(칸은 비어 보인다) */
function numberOf(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function ScheduleSheet(props: ScheduleSheetProps): ReactNode {
  const { sheet, onChange, onSubmit, onClose } = props;
  const formId = useId();
  const title = t(
    sheet?.mode === "copy"
      ? "desktop.schedules.sheet.copyTitle"
      : sheet?.mode === "edit"
        ? "desktop.schedules.sheet.editTitle"
        : "desktop.schedules.new",
  );
  return (
    <Sheet
      open={sheet !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      size="sm"
      footer={
        sheet === null ? null : (
          <>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" disabled={sheet.sending} onClick={onClose}>
              {t("desktop.schedules.sheet.discard")}
            </Button>
            <Button type="submit" form={formId} variant="solid" size="sm" loading={sheet.sending}>
              {t("desktop.schedules.sheet.save")}
            </Button>
          </>
        )
      }
    >
      {sheet === null ? null : (
        <SheetForm id={formId} sheet={sheet} onChange={onChange} onSubmit={onSubmit} />
      )}
    </Sheet>
  );
}

function SheetForm(props: {
  readonly id: string;
  readonly sheet: SheetState;
  readonly onChange: (draft: ScheduleDraft) => void;
  readonly onSubmit: () => void;
}): ReactNode {
  const { sheet, onChange } = props;
  const draft = sheet.draft;
  const errors = sheet.errors;
  const fieldError = (field: SheetField): ReactNode => textOf(errors.fields[field]);
  const setDraft = (patch: Partial<ScheduleDraft>): void => {
    onChange({ ...draft, ...patch });
  };
  const setTrigger = (patch: Partial<TriggerDraft>): void => {
    onChange({ ...draft, trigger: { ...draft.trigger, ...patch } });
  };
  return (
    <form
      id={props.id}
      noValidate
      className="grid gap-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {errors.form === null ? null : (
        <Alert size="sm" tone="danger">
          {t(errors.form.id, errors.form.args)}
        </Alert>
      )}
      <Field label={t("desktop.schedules.form.title")} size="sm" error={fieldError("title")}>
        <Input
          size="sm"
          value={draft.title}
          onValueChange={(value) => {
            setDraft({ title: value });
          }}
        />
      </Field>
      {sheet.mode === "edit" ? (
        <Alert size="sm" tone="info">
          {t("desktop.schedules.form.editHint")}
        </Alert>
      ) : null}
      {sheet.mode === "edit" ? null : (
        <>
          <Field label={t("desktop.schedules.form.trigger")} size="sm" group>
            <SegmentedControl
              size="xs"
              aria-label={t("desktop.schedules.form.trigger")}
              value={draft.trigger.kind}
              onValueChange={(value) => {
                const kind = kindOf(value);
                if (kind !== null) setTrigger({ kind });
              }}
            >
              {TRIGGER_KINDS.map((kind) => (
                <SegmentedControlItem key={kind} value={kind}>
                  {t(triggerKindId(kind))}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </Field>
          <TriggerInputs draft={draft.trigger} error={fieldError} onChange={setTrigger} />
        </>
      )}
      <Field label={t("desktop.schedules.form.prompt")} size="sm" error={fieldError("prompt")}>
        <Textarea
          size="sm"
          rows={3}
          value={draft.prompt}
          onValueChange={(value) => {
            setDraft({ prompt: value });
          }}
        />
      </Field>
      {sheet.mode === "edit" ? null : (
        <>
          <Field
            label={t("desktop.schedules.form.workspace")}
            size="sm"
            error={fieldError("workspace")}
          >
            <Input
              size="sm"
              value={draft.workspace}
              onValueChange={(value) => {
                setDraft({ workspace: value });
              }}
            />
          </Field>
          <label className="flex items-center gap-2.5 text-ui-sm text-text-primary">
            <span className="flex-1">{t("desktop.schedules.form.enabled")}</span>
            <Switch
              size="sm"
              aria-label={t("desktop.schedules.form.enabled")}
              checked={draft.enabled}
              onCheckedChange={(checked) => {
                setDraft({ enabled: checked });
              }}
            />
          </label>
        </>
      )}
    </form>
  );
}

/** 트리거 종류별 입력. 고른 종류의 칸만 보이고, 검사는 `triggerOfDraft`가 한다 */
function TriggerInputs(props: {
  readonly draft: TriggerDraft;
  readonly error: (field: SheetField) => ReactNode;
  readonly onChange: (patch: Partial<TriggerDraft>) => void;
}): ReactNode {
  const { draft, error, onChange } = props;
  switch (draft.kind) {
    case "interval": {
      const invalid = error("intervalSeconds") !== undefined;
      return (
        <Field
          label={t("desktop.schedules.form.interval")}
          size="sm"
          error={error("intervalSeconds")}
        >
          <NumberField
            size="sm"
            aria-label={t("desktop.schedules.form.interval")}
            unit={t("desktop.schedules.form.unit.seconds")}
            min={1}
            max={31536000}
            value={numberOf(draft.intervalSeconds)}
            invalid={invalid}
            onValueChange={(value) => {
              onChange({ intervalSeconds: String(value) });
            }}
          />
        </Field>
      );
    }
    case "at":
      return (
        <Field label={t("desktop.schedules.form.at")} size="sm" error={error("atMs")}>
          <Input
            size="sm"
            type="datetime-local"
            value={localInputOf(draft.atMs)}
            onValueChange={(value) => {
              onChange({ atMs: msOfLocalInput(value) });
            }}
          />
        </Field>
      );
    case "file_watch":
      return (
        <>
          <Field label={t("desktop.schedules.form.paths")} size="sm" error={error("paths")}>
            <TagInput
              size="sm"
              value={[...draft.paths]}
              placeholder={t("desktop.schedules.form.pathsPlaceholder")}
              onValueChange={(paths) => {
                onChange({ paths });
              }}
            />
          </Field>
          <Field label={t("desktop.schedules.form.debounce")} size="sm" error={error("debounceMs")}>
            <NumberField
              size="sm"
              aria-label={t("desktop.schedules.form.debounce")}
              unit={t("desktop.schedules.form.unit.ms")}
              value={numberOf(draft.debounceMs)}
              invalid={error("debounceMs") !== undefined}
              onValueChange={(value) => {
                onChange({ debounceMs: String(value) });
              }}
            />
          </Field>
        </>
      );
    case "remote":
      return (
        <p className="m-0 text-ui-sm font-normal text-text-secondary">
          {t("desktop.schedules.form.remoteHint")}
        </p>
      );
    case "repeat": {
      const intervalInvalid = error("loopIntervalSeconds") !== undefined;
      const maxInvalid = error("maxIterations") !== undefined;
      return (
        <>
          <div className="flex gap-2">
            <Field
              label={t("desktop.schedules.form.interval")}
              size="sm"
              className="min-w-0 flex-1"
              error={error("loopIntervalSeconds")}
            >
              <NumberField
                size="sm"
                aria-label={t("desktop.schedules.form.interval")}
                unit={t("desktop.schedules.form.unit.seconds")}
                value={numberOf(draft.loopIntervalSeconds)}
                invalid={intervalInvalid}
                onValueChange={(value) => {
                  onChange({ loopIntervalSeconds: String(value) });
                }}
              />
            </Field>
            <Field
              label={t("desktop.schedules.form.maxIterations")}
              size="sm"
              className="min-w-0 flex-1"
              error={error("maxIterations")}
            >
              <NumberField
                size="sm"
                appearance="stepper"
                aria-label={t("desktop.schedules.form.maxIterations")}
                min={1}
                value={numberOf(draft.maxIterations)}
                invalid={maxInvalid}
                onValueChange={(value) => {
                  onChange({ maxIterations: String(value) });
                }}
              />
            </Field>
          </div>
          <Field
            label={t("desktop.schedules.form.expiresAt")}
            size="sm"
            error={error("expiresAtMs")}
          >
            <Input
              size="sm"
              type="datetime-local"
              value={expiresInputOf(draft.expiresAtMs)}
              onValueChange={(value) => {
                onChange({ expiresAtMs: expiresTextOf(value) });
              }}
            />
          </Field>
        </>
      );
    }
    default:
      return assertNever(draft.kind, "ScheduleTriggerKind");
  }
}
