import { attachErrorKey, type TargetEntry } from "@fresnel/client";
import { t, type Locale } from "@fresnel/client/i18n";
import {
  Alert,
  Button,
  Card,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  Input,
  RadioGroup,
  RadioGroupItem,
  Stepper,
  type StepperStep,
} from "@caustic/react";
import { Plus, Trash2, TriangleAlert } from "@caustic/react/icons";
import { useId, type ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import {
  canConnect,
  searchShown,
  stepsOf,
  valueOfChoice,
  visibleTargets,
  type ConnectionState,
  type FormState,
} from "./connection-model.ts";
import { ConnectionStatusCard, type StatusHandlers } from "./connection-status.tsx";
import { addressMessageOf, stepMessageOf } from "./connection-text.ts";

// 연결 화면(P-08)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 대상 목록은 라디오 묶음이고 연결 단계는 `Stepper`다. 상태 카드는 `connection-status.tsx`가 그린다.

/** 화면 동작. 속성 형태로 둬서 시험이 빈 함수를 넣을 수 있다 */
export interface ConnectionScreenHandlers extends StatusHandlers {
  readonly select: (value: string) => void;
  readonly query: (text: string) => void;
  readonly connect: () => void;
  readonly retry: () => void;
  readonly backToLocal: () => void;
  readonly remove: (id: string) => void;
  readonly openForm: () => void;
  readonly closeForm: () => void;
  readonly formField: (field: "label" | "address", value: string) => void;
  readonly submitForm: () => void;
  readonly dismissNotice: () => void;
  readonly confirmStop: () => void;
}

export interface ConnectionScreenViewProps {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: ConnectionScreenHandlers;
}

export function ConnectionScreenView(props: ConnectionScreenViewProps): ReactNode {
  const { state, engine, locale, handlers } = props;
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
    >
      <h1 id={headingId} className="text-ui-strong text-text-primary">
        {t("desktop.connection.title")}
      </h1>
      {state.notice === null ? null : (
        <Alert
          tone={state.notice.tone === "danger" ? "danger" : "success"}
          dismissible
          dismissLabel={t("desktop.connection.dismiss")}
          onDismiss={handlers.dismissNotice}
        >
          {t(state.notice.id)}
        </Alert>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TargetsPanel state={state} handlers={handlers} />
        <ConnectionStatusCard state={state} engine={engine} locale={locale} handlers={handlers} />
      </div>
      <StopDialog state={state} handlers={handlers} />
    </section>
  );
}

function TargetsPanel(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const headingId = useId();
  const items = visibleTargets(state);
  const idle = state.busy || state.pending !== null;
  return (
    <Card role="region" aria-labelledby={headingId} size="sm" className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-ui-strong text-text-primary">
          {t("desktop.connection.targets.heading")}
        </h2>
        <Button
          size="sm"
          variant="outline"
          iconStart={<Plus />}
          disabled={idle || state.form !== null}
          onClick={handlers.openForm}
        >
          {t("desktop.connection.targets.add")}
        </Button>
      </div>
      {state.form === null ? null : (
        <TargetForm form={state.form} busy={state.busy} handlers={handlers} />
      )}
      {searchShown(state.items) ? (
        <Input
          type="search"
          aria-label={t("desktop.connection.targets.search")}
          placeholder={t("desktop.connection.targets.search")}
          value={state.query}
          onValueChange={handlers.query}
        />
      ) : null}
      {state.list.kind === "loading" ? (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.connection.targets.loading")}
        </p>
      ) : null}
      {state.list.kind === "failed" ? (
        <Alert tone="danger">{t("desktop.connection.targets.loadFailed")}</Alert>
      ) : null}
      {state.list.kind === "ready" && state.items.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.connection.targets.empty")}</p>
      ) : null}
      <RadioGroup
        aria-label={t("desktop.connection.targets.heading")}
        value={valueOfChoice(state.selected)}
        onValueChange={handlers.select}
        disabled={state.pending !== null}
        className="gap-1"
      >
        <RadioGroupItem value={valueOfChoice({ kind: "local" })}>
          {t("desktop.connection.targets.local")}
        </RadioGroupItem>
        {items.map((entry) => (
          <TargetRow
            key={entry.id}
            entry={entry}
            disabled={idle}
            onRemove={() => {
              handlers.remove(entry.id);
            }}
          />
        ))}
      </RadioGroup>
      {state.items.length > 0 && items.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.connection.targets.noMatch")}</p>
      ) : null}
      {state.failure === null ? null : <FailureAlert state={state} handlers={handlers} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!canConnect(state)}
          loading={state.pending !== null}
          onClick={handlers.connect}
        >
          {t("desktop.connection.targets.connect")}
        </Button>
      </div>
      {state.pending === null ? null : <ConnectSteps state={state} />}
    </Card>
  );
}

function TargetRow(props: {
  readonly entry: TargetEntry;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const { entry, disabled, onRemove } = props;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <RadioGroupItem
          value={valueOfChoice({ kind: "remote", entry })}
          description={`${t("desktop.connection.targets.remote")} · ${entry.address}`}
        >
          {entry.label}
        </RadioGroupItem>
      </div>
      <Button
        variant="ghost"
        size="xs"
        iconStart={<Trash2 />}
        disabled={disabled}
        onClick={onRemove}
      >
        {t("desktop.connection.targets.remove")}
      </Button>
    </div>
  );
}

function TargetForm(props: {
  readonly form: FormState;
  readonly busy: boolean;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { form, busy, handlers } = props;
  const formId = useId();
  const labelError = form.errors.label ? t("desktop.connection.form.labelEmpty") : undefined;
  const addressError =
    form.errors.address === null ? undefined : t(addressMessageOf(form.errors.address));
  return (
    <form
      id={formId}
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        handlers.submitForm();
      }}
    >
      <h3 className="text-ui-strong text-text-primary">{t("desktop.connection.form.title")}</h3>
      <Field label={t("desktop.connection.form.label")} error={labelError}>
        <Input
          value={form.label}
          invalid={form.errors.label}
          onValueChange={(value) => {
            handlers.formField("label", value);
          }}
        />
      </Field>
      <Field
        label={t("desktop.connection.form.address")}
        hint={t("desktop.connection.form.addressHint")}
        error={addressError}
      >
        <Input
          value={form.address}
          invalid={form.errors.address !== null}
          onValueChange={(value) => {
            handlers.formField("address", value);
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={handlers.closeForm}>
          {t("desktop.connection.form.discard")}
        </Button>
        <Button type="submit" form={formId} size="sm" loading={busy}>
          {t("desktop.connection.form.save")}
        </Button>
      </div>
    </form>
  );
}

function ConnectSteps(props: { readonly state: ConnectionState }): ReactNode {
  const pending = props.state.pending;
  if (pending === null) return null;
  const steps: StepperStep[] = stepsOf(pending.stage).map((step) => ({
    id: step.id,
    label: t(stepMessageOf(step.id)),
    status: step.status,
    description:
      step.id === "start" && pending.stage === "restarting"
        ? t("desktop.connection.step.retry", { attempt: pending.attempt })
        : undefined,
  }));
  return <Stepper title={t("desktop.connection.progress.label")} steps={steps} />;
}

/**
 * 연결 실패 줄. 실패 종류의 문장과 다시 시도다. 원격 대상의 엔진이 떠 있거나 멈춘 경우만 이 기기로 돌아가기를 보인다
 * (셸이 거절한 경우 엔진은 이전 대상 그대로라 돌아갈 곳이 없다).
 */
function FailureAlert(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const failure = state.failure;
  if (failure === null) return null;
  const offerLocal = failure.target.kind === "remote" && failure.retry === "restart";
  return (
    <Alert
      tone="danger"
      action={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={state.busy || state.pending !== null}
            onClick={handlers.retry}
          >
            {t("desktop.connection.retry")}
          </Button>
          {offerLocal ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={state.busy || state.pending !== null}
              onClick={handlers.backToLocal}
            >
              {t("desktop.connection.backToLocal")}
            </Button>
          ) : null}
        </span>
      }
    >
      {t(attachErrorKey(failure.kind))}
    </Alert>
  );
}

function StopDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const connections = state.status.kind === "ready" ? state.status.snapshot.host.connections : 0;
  return (
    <Dialog
      kind="alert"
      open={state.stopConfirm}
      onOpenChange={(open) => {
        if (!open) handlers.setStopConfirm(false);
      }}
      icon={<TriangleAlert />}
      title={t("desktop.connection.stopDialog.title")}
      description={t("desktop.connection.stopDialog.body", { count: connections })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.connection.stopDialog.keep")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.confirmStop}>
            {t("desktop.connection.stopDialog.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}
