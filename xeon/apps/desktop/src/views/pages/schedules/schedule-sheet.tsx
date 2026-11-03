import { t } from "@fresnel/client/i18n";
import {
  SCHEDULE_MIN_INTERVAL_SECONDS,
  type ScheduleTriggerKind,
  type TriggerDraft,
} from "@fresnel/client";
import { assertNever } from "@fresnel/contracts";
import {
  Alert,
  Button,
  Field,
  Input,
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
// (OS 폴더 고르기는 새 의존 승인이 없어 쓰지 않는다, shell/README.md).

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

export function ScheduleSheet(props: ScheduleSheetProps): ReactNode {
  const { sheet, onChange, onSubmit, onClose } = props;
  const formId = useId();
  const title = t(
    sheet?.mode === "copy" ? "desktop.schedules.sheet.copyTitle" : "desktop.schedules.new",
  );
  return (
    <Sheet
      open={sheet !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      footer={
        sheet === null ? null : (
          <>
            <Button variant="outline" size="sm" disabled={sheet.sending} onClick={onClose}>
              {t("desktop.schedules.sheet.discard")}
            </Button>
            <Button type="submit" form={formId} size="sm" loading={sheet.sending}>
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
  const enabledId = `${props.id}-enabled`;
  return (
    <form
      id={props.id}
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      {errors.form === null ? null : (
        <Alert tone="danger">{t(errors.form.id, errors.form.args)}</Alert>
      )}
      <Field label={t("desktop.schedules.form.title")} error={fieldError("title")}>
        <Input
          value={draft.title}
          onValueChange={(value) => {
            setDraft({ title: value });
          }}
        />
      </Field>
      <Field label={t("desktop.schedules.form.trigger")} group>
        <SegmentedControl
          size="sm"
          className="w-full [&>[data-slot=segmented-control-item]]:flex-1"
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
      <Field label={t("desktop.schedules.form.prompt")} error={fieldError("prompt")}>
        <Textarea
          rows={4}
          value={draft.prompt}
          onValueChange={(value) => {
            setDraft({ prompt: value });
          }}
        />
      </Field>
      <Field
        label={t("desktop.schedules.form.workspace")}
        hint={t("desktop.schedules.form.workspaceHint")}
        error={fieldError("workspace")}
      >
        <Input
          value={draft.workspace}
          onValueChange={(value) => {
            setDraft({ workspace: value });
          }}
        />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <span id={enabledId} className="text-ui text-text-primary">
          {t("desktop.schedules.form.enabled")}
        </span>
        <Switch
          aria-labelledby={enabledId}
          checked={draft.enabled}
          onCheckedChange={(checked) => {
            setDraft({ enabled: checked });
          }}
        />
      </div>
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
    case "interval":
      return (
        <Field
          label={t("desktop.schedules.form.interval")}
          hint={t("desktop.schedules.form.intervalHint", {
            minSeconds: SCHEDULE_MIN_INTERVAL_SECONDS,
          })}
          error={error("intervalSeconds")}
        >
          <Input
            inputMode="numeric"
            value={draft.intervalSeconds}
            onValueChange={(value) => {
              onChange({ intervalSeconds: value });
            }}
          />
        </Field>
      );
    case "at":
      return (
        <Field label={t("desktop.schedules.form.at")} error={error("atMs")}>
          <Input
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
          <Field
            label={t("desktop.schedules.form.paths")}
            hint={t("desktop.schedules.form.pathsHint")}
            error={error("paths")}
          >
            <TagInput
              value={[...draft.paths]}
              onValueChange={(paths) => {
                onChange({ paths });
              }}
            />
          </Field>
          <Field label={t("desktop.schedules.form.debounce")} error={error("debounceMs")}>
            <Input
              inputMode="numeric"
              value={draft.debounceMs}
              onValueChange={(value) => {
                onChange({ debounceMs: value });
              }}
            />
          </Field>
        </>
      );
    case "remote":
      return <Field hint={t("desktop.schedules.form.remoteHint")} />;
    case "repeat":
      return (
        <>
          <Field label={t("desktop.schedules.form.interval")} error={error("loopIntervalSeconds")}>
            <Input
              inputMode="numeric"
              value={draft.loopIntervalSeconds}
              onValueChange={(value) => {
                onChange({ loopIntervalSeconds: value });
              }}
            />
          </Field>
          <Field label={t("desktop.schedules.form.maxIterations")} error={error("maxIterations")}>
            <Input
              inputMode="numeric"
              value={draft.maxIterations}
              onValueChange={(value) => {
                onChange({ maxIterations: value });
              }}
            />
          </Field>
          <Field label={t("desktop.schedules.form.expiresAt")} error={error("expiresAtMs")}>
            <Input
              type="datetime-local"
              value={expiresInputOf(draft.expiresAtMs)}
              onValueChange={(value) => {
                onChange({ expiresAtMs: expiresTextOf(value) });
              }}
            />
          </Field>
        </>
      );
    default:
      return assertNever(draft.kind, "ScheduleTriggerKind");
  }
}
