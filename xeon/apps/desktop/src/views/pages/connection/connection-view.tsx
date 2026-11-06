import type { TargetEntry } from "@fresnel/client";
import { t, type Locale } from "@fresnel/client/i18n";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  Input,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
} from "@caustic/react";
import { useId, type ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import {
  canConnect,
  LOCAL_CHOICE,
  sameChoice,
  searchShown,
  valueOfChoice,
  visibleTargets,
  type ConnectionState,
  type FormState,
  type TargetChoice,
} from "./connection-model.ts";
import {
  ConnectionDetailPanel,
  ConnectionSection,
  type DetailHandlers,
} from "./connection-status.tsx";
import { addressMessageOf } from "./connection-text.ts";

// 연결 화면(P-08)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 왼쪽은 대상 목록(라디오 묶음과 상태 배지), 오른쪽은 붙는 중·실패와 지금 대상이다. 넓은 폭에서는 두 열, 좁으면 한 열이다.

/** 화면 동작. 속성 형태로 둬서 시험이 빈 함수를 넣을 수 있다 */
export interface ConnectionScreenHandlers extends DetailHandlers {
  readonly select: (value: string) => void;
  readonly query: (text: string) => void;
  readonly connect: () => void;
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

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

export function ConnectionScreenView(props: ConnectionScreenViewProps): ReactNode {
  const { state, engine, locale, handlers } = props;
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4"
    >
      <header className="flex h-10 flex-none items-center gap-2">
        <h1 id={headingId} className="m-0 text-ui-strong text-text-primary">
          {t("desktop.connection.title")}
        </h1>
      </header>
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
      <div className="grid gap-8 medium:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <TargetsPanel state={state} handlers={handlers} />
        <ConnectionDetailPanel state={state} engine={engine} locale={locale} handlers={handlers} />
      </div>
      <StopDialog state={state} handlers={handlers} />
    </section>
  );
}

/** 대상 줄 끝의 상태 배지. 붙는 중과 실패가 지금 대상보다 앞선다. 연결됐을 때만 "연결됨"이다 */
function badgeOf(state: ConnectionState, choice: TargetChoice): ReactNode {
  if (state.pending !== null && sameChoice(state.pending.target, choice)) {
    return <StatusBadge tone="info">{t("desktop.connection.badge.attaching")}</StatusBadge>;
  }
  if (state.failure !== null && sameChoice(state.failure.target, choice)) {
    return <StatusBadge tone="danger">{t("desktop.connection.badge.failed")}</StatusBadge>;
  }
  if (!sameChoice(state.engineTarget, choice)) return null;
  if (state.pending !== null || state.failure !== null || state.status.kind !== "ready") {
    return <StatusBadge tone="neutral">{t("desktop.connection.badge.current")}</StatusBadge>;
  }
  return <StatusBadge tone="success">{t("desktop.connection.badge.connected")}</StatusBadge>;
}

/** 상태 배지의 색 계열. caustic `Badge`의 `tone`은 쓰지 않고 토큰 클래스와 점으로 입힌다(글자가 뜻을 함께 든다) */
type StatusTone = "info" | "danger" | "neutral" | "success";
const BADGE_CLASS: Readonly<Record<StatusTone, { readonly soft: string; readonly dot: string }>> = {
  info: { soft: "bg-info-soft text-info-text", dot: "bg-info-graphic" },
  danger: { soft: "bg-danger-soft text-danger-text", dot: "bg-danger-graphic" },
  neutral: { soft: "bg-neutral-track text-text-secondary", dot: "bg-neutral-graphic" },
  success: { soft: "bg-success-soft text-success-text", dot: "bg-success-graphic" },
};

function StatusBadge(props: {
  readonly tone: StatusTone;
  readonly children: ReactNode;
}): ReactNode {
  const { tone, children } = props;
  return (
    <Badge size="xs" className={BADGE_CLASS[tone].soft}>
      <span aria-hidden className={`size-1.5 rounded-full ${BADGE_CLASS[tone].dot}`} />
      {children}
    </Badge>
  );
}

function ItemBody(props: { readonly label: string; readonly badge: ReactNode }): ReactNode {
  return (
    <span className="grid min-w-0 flex-1 gap-0.5 py-1">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate text-ui-sm font-medium text-text-primary">{props.label}</span>
        <span className="flex-1" />
        {props.badge}
      </span>
    </span>
  );
}

function TargetsPanel(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const items = visibleTargets(state);
  const idle = state.busy || state.pending !== null;
  const differs = !sameChoice(state.selected, state.engineTarget);
  return (
    <ConnectionSection
      title={t("desktop.connection.targets.heading")}
      end={
        <Button
          size="xs"

          variant="ghost"
          disabled={idle || state.form !== null}
          onClick={handlers.openForm}
        >
          {t("desktop.connection.targets.add")}
        </Button>
      }
    >
      {searchShown(state.items) ? (
        <Input
          type="search"
          size="sm"
          aria-label={t("desktop.connection.targets.search")}
          placeholder={t("desktop.connection.targets.search")}
          value={state.query}
          onValueChange={handlers.query}
        />
      ) : null}
      {state.list.kind === "loading" ? (
        <div role="status" className="grid content-start gap-3">
          <span className="sr-only">{t("desktop.connection.targets.loading")}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} width={`${60 + ((i * 11) % 30)}%`} height={14} />
          ))}
        </div>
      ) : null}
      {state.list.kind === "failed" ? (
        <Alert tone="danger" size="sm">
          {t("desktop.connection.targets.loadFailed")}
        </Alert>
      ) : null}
      {state.list.kind === "ready" && state.items.length === 0 ? (
        <p className="m-0 text-ui-sm font-normal text-text-tertiary">
          {t("desktop.connection.targets.empty")}
        </p>
      ) : null}
      <RadioGroup
        aria-label={t("desktop.connection.targets.heading")}
        size="sm"
        value={valueOfChoice(state.selected)}
        onValueChange={handlers.select}
        disabled={state.pending !== null}
        className="gap-0.5"
      >
        <RadioGroupItem value={valueOfChoice(LOCAL_CHOICE)} className="mt-1 self-start">
          <ItemBody
            label={t("desktop.connection.targets.local")}
            badge={badgeOf(state, LOCAL_CHOICE)}
          />
        </RadioGroupItem>
        {items.map((entry) => (
          <TargetRow
            key={entry.id}
            entry={entry}
            badge={badgeOf(state, { kind: "remote", entry })}
            disabled={idle}
            onRemove={() => {
              handlers.remove(entry.id);
            }}
          />
        ))}
      </RadioGroup>
      {state.items.length > 0 && items.length === 0 ? (
        <p className="m-0 text-ui-sm font-normal text-text-tertiary">
          {t("desktop.connection.targets.noMatch")}
        </p>
      ) : null}
      {state.form === null ? null : (
        <TargetForm form={state.form} busy={state.busy} handlers={handlers} />
      )}
      {state.form === null && differs ? (
        <div className="flex justify-end pt-1">
          <Button
            size="sm"

            variant="solid"
            disabled={!canConnect(state)}
            loading={state.pending !== null}
            onClick={handlers.connect}
          >
            {t("desktop.connection.targets.connect")}
          </Button>
        </div>
      ) : null}
    </ConnectionSection>
  );
}

function TargetRow(props: {
  readonly entry: TargetEntry;
  readonly badge: ReactNode;
  readonly disabled: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const { entry, badge, disabled, onRemove } = props;
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <RadioGroupItem
          value={valueOfChoice({ kind: "remote", entry })}
          className="mt-1 self-start"
        >
          <ItemBody label={entry.label} badge={badge} />
        </RadioGroupItem>
      </div>
      <Button variant="ghost" size="xs" disabled={disabled} onClick={onRemove}>
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
      className="grid gap-2.5 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        handlers.submitForm();
      }}
    >
      <Field label={t("desktop.connection.form.label")} error={labelError} size="sm">
        <Input
          size="sm"
          value={form.label}
          invalid={form.errors.label}
          onValueChange={(value) => {
            handlers.formField("label", value);
          }}
        />
      </Field>
      <Field label={t("desktop.connection.form.address")} error={addressError} size="sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1">
            <Input
              size="sm"
              className="font-mono"
              value={form.address}
              invalid={form.errors.address !== null}
              onValueChange={(value) => {
                handlers.formField("address", value);
              }}
            />
          </span>
          <InfoTip text={t("desktop.connection.form.addressHint")} />
        </span>
      </Field>
      <div className="flex justify-end gap-1.5">
        <Button
          size="sm"

          variant="ghost"
          disabled={busy}
          onClick={handlers.closeForm}
        >
          {t("desktop.connection.form.discard")}
        </Button>
        <Button type="submit" form={formId} size="sm" variant="solid" loading={busy}>
          {t("desktop.connection.form.save")}
        </Button>
      </div>
    </form>
  );
}

function StopDialog(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const host = state.status.kind === "ready" ? state.status.snapshot.host : null;
  const connections = host === null ? 0 : host.connections;
  const liveTurns = host === null ? 0 : host.liveTurns;
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={state.stopConfirm}
      onOpenChange={(open) => {
        if (!open) handlers.setStopConfirm(false);
      }}
      title={t("desktop.connection.stopDialog.title")}
      description={t("desktop.connection.stopDialog.body", { count: connections })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.connection.stopDialog.keep")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.confirmStop}>
            {t("desktop.connection.stopDialog.confirm")}
          </DialogAction>
        </>
      }
    >
      <ListDescription variant="ghost" size="xs" className={ROWS_CLASS}>
        <ListDescriptionRow term={t("desktop.connection.status.liveTurns")}>
          {liveTurns}
        </ListDescriptionRow>
      </ListDescription>
    </Dialog>
  );
}
