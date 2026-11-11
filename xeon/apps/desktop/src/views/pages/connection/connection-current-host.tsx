import { attachErrorKey, attachFixKey } from "@fresnel/client";
import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import {
  Alert,
  Button,
  Card,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Stepper,
  type StepperStep,
} from "@caustic/react";
import type { ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import type { StatusTone } from "./connection-badge.tsx";
import { StatusBadge } from "./connection-badge.tsx";
import { ConnectedClientsRow } from "./connection-clients.tsx";
import type { DetailHandlers } from "./connection-status.tsx";
import {
  sameChoice,
  stepsOf,
  type ConnectionState,
  type TargetChoice,
} from "./connection-model.ts";
import { engineMessageOf, stepMessageOf, timeTextOf } from "./connection-text.ts";

// 호스트 섹션 맨 위의 "현재 호스트" 카드. 이름과 상태 배지, 한 줄 요약, 연결 단계와 실패(Alert), 상태 줄(엔진 상태와 클라이언트),
// 그리고 지금 호스트의 동작 줄이다. 카드 아래 확장 상태 링크는 `CurrentHostCard`가 함께 그린다.
// 연결 단계와 실패는 카드 안의 Alert이고, 다시 시도 같은 동작은 Alert의 `actions`로 준다.

/** 호스트 상태 배지의 종류. 글은 메시지 키다 */
export interface HostStatus {
  readonly tone: StatusTone;
  readonly label: MessageId;
}

const ATTACHING: HostStatus = { tone: "info", label: "desktop.connection.badge.attaching" };
const FAILED: HostStatus = { tone: "danger", label: "desktop.connection.badge.failed" };
const RUNNING: HostStatus = { tone: "success", label: "desktop.connection.badge.running" };
const OFFLINE: HostStatus = { tone: "neutral", label: "desktop.connection.badge.offline" };

/** 엔진이 떠나는 중인가(다시 띄우거나 띄우는 중이면 연결 중이다) */
function transitional(engine: EngineState | null): boolean {
  return engine?.kind === "starting" || engine?.kind === "restarting";
}

/**
 * 호스트 한 줄의 상태 배지. 그 호스트가 붙는 중이면 연결 중, 실패했으면 오류다. 엔진이 가리키는 호스트면 실행 중(상태를 읽었을 때),
 * 끊겼으면 연결 끊김이다. 엔진이 가리키지 않는 호스트는 상태를 모르므로 배지가 없다(null). 상태를 읽는 중에도 배지가 없다.
 */
export function hostStatusOf(
  state: ConnectionState,
  engine: EngineState | null,
  choice: TargetChoice,
): HostStatus | null {
  if (state.pending !== null && sameChoice(state.pending.target, choice)) return ATTACHING;
  if (state.failure !== null && sameChoice(state.failure.target, choice)) return FAILED;
  if (!sameChoice(state.engineTarget, choice)) return null;
  if (state.pending !== null || transitional(engine)) return ATTACHING;
  if (state.status.kind === "ready") return RUNNING;
  if (state.status.kind === "loading") return null;
  return OFFLINE;
}

/** 엔진이 가리키는 호스트의 이름. 이 기기는 메시지 키이고 원격은 저장된 이름이다 */
function choiceNameOf(choice: TargetChoice): string {
  return choice.kind === "local" ? t("desktop.connection.targets.local") : choice.entry.label;
}

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

/** 상태 점의 색. 실행 중은 성공, 바뀌는 중은 경고, 실패는 위험이다. 글자가 따로 있어 색만으로 뜻을 주지 않는다 */
const ENGINE_DOT: Readonly<Record<EngineState["kind"], string>> = {
  starting: "bg-warning-graphic",
  running: "bg-success-graphic",
  restarting: "bg-warning-graphic",
  stopping: "bg-warning-graphic",
  stopped: "bg-neutral-graphic",
  failed: "bg-danger-graphic",
};

function engineDotOf(engine: EngineState | null): string {
  return engine === null ? "bg-neutral-graphic" : ENGINE_DOT[engine.kind];
}

/** 요약 줄. 상태를 읽었으면 앱 안·서비스 실행과 시작 시각을, 원격은 주소와 시작 시각을 잇는다. 상태를 못 읽었으면 원격 주소만 보인다 */
function summaryOf(state: ConnectionState, locale: Locale, choice: TargetChoice): string | null {
  const snapshot = state.status.kind === "ready" ? state.status.snapshot : null;
  if (choice.kind === "remote") {
    if (snapshot === null) return choice.entry.address;
    return t("desktop.connection.current.summary.remote", {
      address: choice.entry.address,
      time: timeTextOf(snapshot.host.startedAt, locale),
    });
  }
  if (snapshot === null) return null;
  const key =
    snapshot.host.mode === "service"
      ? "desktop.connection.current.summary.service"
      : "desktop.connection.current.summary.inProcess";
  return t(key, { time: timeTextOf(snapshot.host.startedAt, locale) });
}

/** 연결 단계 세 개. 단계마다 상태를 붙인다 */
function ConnectSteps(props: {
  readonly pending: NonNullable<ConnectionState["pending"]>;
}): ReactNode {
  const { pending } = props;
  const steps: StepperStep[] = stepsOf(pending.stage).map((step) => ({
    id: step.id,
    label: t(stepMessageOf(step.id)),
    status: step.status,
    description:
      step.id === "start" && pending.stage === "restarting"
        ? t("desktop.connection.step.retry", { attempt: pending.attempt })
        : undefined,
  }));
  return (
    <Stepper
      aria-label={t("desktop.connection.progress.label")}
      size="md"
      className="text-ui [&_[data-slot=stepper-indicator]]:text-ui [&_[data-slot=stepper-label]]:text-ui [&_[data-slot=stepper-description]]:text-ui"
      steps={steps}
      statusLabels={{
        done: t("desktop.connection.step.done"),
        now: t("desktop.connection.step.now"),
        todo: t("desktop.connection.step.todo"),
      }}
    />
  );
}

/**
 * 연결 실패 Alert. 실패 종류의 원인과 해결 두 줄이고, 다시 시도를 준다. 원격 대상의 엔진이 떠 있거나 멈춘 경우만 이 기기로 돌아가기를 준다
 * (셸이 거절한 경우 엔진은 이전 대상 그대로라 돌아갈 곳이 없다). 진행 중에는 동작을 내보이지 않는다(Alert 동작은 잠글 수 없다).
 */
function FailureAlert(props: {
  readonly state: ConnectionState;
  readonly handlers: DetailHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const failure = state.failure;
  if (failure === null) return null;
  const idle = state.busy || state.pending !== null;
  const offerLocal = failure.target.kind === "remote" && failure.retry === "restart";
  const actions = idle
    ? undefined
    : [
        { label: t("desktop.connection.retry"), onClick: handlers.retry, primary: true },
        ...(offerLocal
          ? [{ label: t("desktop.connection.backToLocal"), onClick: handlers.backToLocal }]
          : []),
      ];
  return (
    <Alert
      tone="danger"
      size="sm"
      variant="outline"
      className="text-ui [&_[data-slot=button]]:text-ui"
      actions={actions}
    >
      <b>{t("desktop.connection.attach.failed", { name: choiceNameOf(failure.target) })}</b>
      <span className="block">{t(attachErrorKey(failure.kind))}</span>
      <span className="block text-text-secondary">{t(attachFixKey(failure.kind))}</span>
    </Alert>
  );
}

/** 상태를 읽는 동안의 자리. 키-값 줄 모양의 뼈대다 */
function DetailSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label={t("desktop.connection.status.loading")}
      className="grid content-start gap-2"
    >
      <Skeleton width="40%" height={14} />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton width="22%" height={12} />
          <Skeleton width={`${30 + ((i * 13) % 35)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

/**
 * 지금 호스트 카드. 이름, 상태 배지, 요약 한 줄을 맨 위에 두고, 연결 단계·실패·안내를 Alert로 잇고, 상태 줄과 동작 줄로 끝낸다.
 * 카드 아래에 확장 상태 링크를 둔다.
 */
export function CurrentHostCard(props: {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: DetailHandlers;
}): ReactNode {
  const { state, engine, locale, handlers } = props;
  const choice = state.engineTarget;
  const status = hostStatusOf(state, engine, choice);
  const summary = summaryOf(state, locale, choice);
  const snapshot = state.status.kind === "ready" ? state.status.snapshot : null;
  const host = snapshot === null ? null : snapshot.host;
  const remote = choice.kind === "remote";
  const idle = state.busy || state.pending !== null;
  // 서비스 멈추기는 연결이 있고 다른 동작이 가고 있지 않을 때만 한다
  const acting = snapshot !== null && !state.busy && state.pending === null;
  const restarting = engine?.kind === "restarting";

  return (
    <div className="grid gap-2">
      <Card variant="surface" size="md" className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="m-0 min-w-0 flex-1 truncate text-title-1 text-text-primary">
              {choiceNameOf(choice)}
            </h3>
            {status === null ? null : (
              <StatusBadge tone={status.tone}>{t(status.label)}</StatusBadge>
            )}
          </div>
          {summary === null ? null : (
            <p className="m-0 text-ui break-all text-text-secondary">{summary}</p>
          )}
        </div>
        {state.pending === null ? null : (
          <Alert tone="info" size="sm" variant="outline" className="text-ui">
            <span className="block">
              {t("desktop.connection.attach.connecting", {
                name: choiceNameOf(state.pending.target),
              })}
            </span>
            <ConnectSteps pending={state.pending} />
          </Alert>
        )}
        {state.failure === null ? null : <FailureAlert state={state} handlers={handlers} />}
        {restarting ? (
          <Alert tone="warning" size="sm" variant="outline" className="text-ui">
            {t("desktop.connection.restarting")}
          </Alert>
        ) : null}
        {host === null || host.idleShutdownAt === null ? null : (
          <Alert tone="neutral" size="sm" variant="outline" className="text-ui">
            {t("desktop.connection.status.idleNotice", {
              time: timeTextOf(host.idleShutdownAt, locale),
            })}
          </Alert>
        )}
        {state.status.kind === "offline" ? (
          <Alert tone="warning" size="sm" variant="outline" className="text-ui">
            {/* 원격 서비스가 없으면 "엔진을 다시 시작"이 아니라 서비스가 켜졌는지 보라고 한다 */}
            {remote ? t("desktop.status.serviceLost") : t("desktop.connection.status.offline")}
          </Alert>
        ) : null}
        {state.status.kind === "failed" ? (
          <Alert tone="danger" size="sm" variant="outline" className="text-ui">
            {t("desktop.connection.status.loadFailed")}
          </Alert>
        ) : null}
        {state.status.kind === "loading" ? (
          <DetailSkeleton />
        ) : (
          <>
            <ListDescription
              variant="ghost"
              size="sm"
              aria-label={t("desktop.connection.status.heading")}
              className={ROWS_CLASS}
            >
              <ListDescriptionRow term={t("desktop.connection.status.state")}>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className={`size-1.5 rounded-full ${engineDotOf(engine)}`} />
                  {t(engineMessageOf(engine))}
                </span>
              </ListDescriptionRow>
              <ConnectedClientsRow state={state.clients} onRetry={handlers.retryClients} />
            </ListDescription>
            <div className="flex flex-wrap items-center gap-2">
              {host !== null && host.mode === "service" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger-text"
                  disabled={!acting}
                  onClick={() => {
                    handlers.setStopConfirm(true);
                  }}
                >
                  {t("desktop.connection.status.stopService")}
                </Button>
              ) : null}
              {remote ? (
                <Button size="sm" variant="ghost" disabled={idle} onClick={handlers.backToLocal}>
                  {t("desktop.connection.backToLocal")}
                </Button>
              ) : null}
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={handlers.copyDiagnostics}>
                {t("desktop.connection.status.copyDiagnostics")}
              </Button>
              <Button
                size="sm"
                variant="soft"
                loading={restarting}
                disabled={state.busy}
                onClick={handlers.restart}
              >
                {t("desktop.connection.status.restart")}
              </Button>
            </div>
          </>
        )}
      </Card>
      <Button
        size="sm"
        variant="ghost"
        className="justify-self-start"
        onClick={handlers.openExtensions}
      >
        {t("desktop.connection.status.extensions")}
      </Button>
    </div>
  );
}
