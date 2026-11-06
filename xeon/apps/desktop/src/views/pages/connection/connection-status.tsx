import { attachErrorKey } from "@fresnel/client";
import { updateLineKey } from "@fresnel/client/settings";
import { t, type Locale } from "@fresnel/client/i18n";
import {
  Alert,
  Badge,
  Button,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Stepper,
  Switch,
  type StepperStep,
} from "@caustic/react";
import { useId, type ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import {
  canSetRemoteRespond,
  stepsOf,
  type ConnectionState,
  type TargetChoice,
} from "./connection-model.ts";
import { ConnectedClientsRow } from "./connection-clients.tsx";
import { engineMessageOf, stepMessageOf, timeTextOf } from "./connection-text.ts";

// 연결 화면의 오른쪽 열(P-08). 붙는 중과 실패, 지금 대상의 상태 목록, 서비스 설정, 동작 줄을 그린다.
// 설명은 정보 아이콘 뒤에 두고, 경고와 실패는 그대로 보인다. 목록의 항목 이름과 클라이언트 줄은 각각 `connection-view.tsx`와 `connection-clients.tsx`가 맡는다.

/** 상태 열이 내는 동작. 화면 핸들러의 일부다 */
interface StatusHandlers {
  readonly restart: () => void;
  readonly backToLocal: () => void;
  readonly setServiceMode: (enabled: boolean) => void;
  readonly setRemoteRespond: (enabled: boolean) => void;
  readonly setStopConfirm: (open: boolean) => void;
  readonly openExtensions: () => void;
  /** 연결된 클라이언트 목록만 다시 읽는다(목록 읽기 실패의 다시 시도) */
  readonly retryClients: () => void;
}

/** 오른쪽 열의 동작. 연결 실패의 다시 시도가 더 붙는다 */
export interface DetailHandlers extends StatusHandlers {
  readonly retry: () => void;
}

interface ConnectionDetailProps {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: DetailHandlers;
}

/** 엔진이 붙은 대상의 이름. 이 기기는 메시지 키이고 원격은 저장된 이름이다 */
function choiceNameOf(choice: TargetChoice): string {
  return choice.kind === "local" ? t("desktop.connection.targets.local") : choice.entry.label;
}

/** 섹션 머리와 본문. 머리는 제목 한 줄이고 끝에 동작을 둘 수 있다 */
export function ConnectionSection(props: {
  readonly title: string;
  readonly end?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const { title, end, children } = props;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid content-start gap-1.5">
      <div className="flex min-h-7 items-center gap-1.5">
        <h2 id={headingId} className="m-0 flex-1 text-ui-sm font-semibold text-text-primary">
          {title}
        </h2>
        {end}
      </div>
      {children}
    </section>
  );
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
      size="xs"
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
 * 연결 실패 줄. 실패 종류의 문장과 다시 시도다. 원격 대상의 엔진이 떠 있거나 멈춘 경우만 이 기기로 돌아가기를 보인다
 * (셸이 거절한 경우 엔진은 이전 대상 그대로라 돌아갈 곳이 없다).
 */
function FailureAlert(props: {
  readonly state: ConnectionState;
  readonly handlers: DetailHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const failure = state.failure;
  if (failure === null) return null;
  const offerLocal = failure.target.kind === "remote" && failure.retry === "restart";
  return (
    <Alert
      tone="danger"
      size="sm"
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

/** 상태를 읽는 동안의 자리. 키-값 줄 모양의 뼈대다 */
function DetailSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label={t("desktop.connection.status.loading")}
      className="grid content-start gap-3"
    >
      <Skeleton width="40%" height={14} />
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex gap-6">
          <Skeleton width="22%" height={12} />
          <Skeleton width={`${30 + ((i * 13) % 35)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

export function ConnectionDetailPanel(props: ConnectionDetailProps): ReactNode {
  const { state, engine, locale, handlers } = props;
  const switchId = useId();
  const respondId = useId();
  const snapshot = state.status.kind === "ready" ? state.status.snapshot : null;
  const host = snapshot === null ? null : snapshot.host;
  // 설정 쓰기와 서비스 멈추기는 연결이 있고 다른 동작이 가고 있지 않을 때만 한다
  const acting = snapshot !== null && !state.busy && state.pending === null;
  const idle = state.busy || state.pending !== null;
  const remote = state.engineTarget.kind === "remote";
  const address = state.engineTarget.kind === "remote" ? state.engineTarget.entry.address : null;
  const restarting = engine?.kind === "restarting";

  return (
    <div className="grid content-start gap-5">
      {state.pending === null ? null : (
        <ConnectionSection
          title={t("desktop.connection.attach.connecting", {
            name: choiceNameOf(state.pending.target),
          })}
        >
          <ConnectSteps pending={state.pending} />
        </ConnectionSection>
      )}
      {state.failure === null ? null : (
        <ConnectionSection
          title={t("desktop.connection.attach.failed", {
            name: choiceNameOf(state.failure.target),
          })}
        >
          <FailureAlert state={state} handlers={handlers} />
        </ConnectionSection>
      )}
      {restarting ? (
        <Alert tone="warning" size="sm">
          {t("desktop.connection.restarting")}
        </Alert>
      ) : null}
      {state.status.kind === "loading" ? (
        <DetailSkeleton />
      ) : (
        <>
          {host === null || host.idleShutdownAt === null ? null : (
            <Alert tone="neutral" size="sm">
              {t("desktop.connection.status.idleNotice", {
                time: timeTextOf(host.idleShutdownAt, locale),
              })}
            </Alert>
          )}
          {state.status.kind === "offline" ? (
            <Alert tone="warning" size="sm">
              {t("desktop.connection.status.offline")}
            </Alert>
          ) : null}
          {state.status.kind === "failed" ? (
            <Alert tone="danger" size="sm">
              {t("desktop.connection.status.loadFailed")}
            </Alert>
          ) : null}
          <ConnectionSection title={t("desktop.connection.status.current")}>
            <ListDescription
              variant="ghost"
              size="xs"
              aria-label={t("desktop.connection.status.heading")}
              className={ROWS_CLASS}
            >
              <ListDescriptionRow term={t("desktop.connection.status.state")}>
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={`size-1.5 rounded-full ${engineDotOf(engine)}`} />
                  {t(engineMessageOf(engine))}
                </span>
              </ListDescriptionRow>
              {address === null ? null : (
                <ListDescriptionRow term={t("desktop.connection.form.address")} mono>
                  <span className="break-all">{address}</span>
                </ListDescriptionRow>
              )}
              {host === null ? null : (
                <ListDescriptionRow term={t("desktop.connection.status.startedAt")}>
                  {timeTextOf(host.startedAt, locale)}
                </ListDescriptionRow>
              )}
              <ConnectedClientsRow state={state.clients} onRetry={handlers.retryClients} />
            </ListDescription>
            <Button
              variant="ghost"
              size="xs"
              className="justify-self-start"
              onClick={handlers.openExtensions}
            >
              {t("desktop.connection.status.extensions")}
            </Button>
          </ConnectionSection>
          {remote ? null : (
            <ConnectionSection title={t("desktop.connection.service.heading")}>
              <div className="grid gap-2.5">
                <div className="flex items-center gap-2.5">
                  <span id={switchId} className="min-w-0 text-ui-sm text-text-primary">
                    {t("desktop.connection.status.serviceMode")}
                  </span>
                  {state.restartNeeded ? (
                    <Badge size="xs" className="bg-warning-soft text-warning-text">
                      {t("desktop.connection.status.restartNeeded")}
                    </Badge>
                  ) : null}
                  <InfoTip text={t("desktop.connection.status.serviceModeHint")} />
                  <span className="flex-1" />
                  <Switch
                    size="sm"
                    aria-labelledby={switchId}
                    checked={state.serviceEnabled === true}
                    disabled={!acting || state.serviceEnabled === null}
                    onCheckedChange={handlers.setServiceMode}
                  />
                </div>
                <div className="flex items-center gap-2.5">
                  <span id={respondId} className="min-w-0 text-ui-sm text-text-primary">
                    {t("desktop.connection.status.remoteRespond")}
                  </span>
                  <InfoTip text={t("desktop.connection.status.remoteRespondHint")} />
                  <span className="flex-1" />
                  <Switch
                    size="sm"
                    aria-labelledby={respondId}
                    checked={state.remoteAllowRespond === true}
                    disabled={!canSetRemoteRespond(state)}
                    onCheckedChange={handlers.setRemoteRespond}
                  />
                </div>
                {state.status.kind === "ready" && state.remoteAllowRespond === null ? (
                  <p className="m-0 text-ui-sm text-text-tertiary">
                    {t("desktop.connection.status.remoteRespondUnknown")}
                  </p>
                ) : null}
              </div>
            </ConnectionSection>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
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
              <Button
                size="sm"

                variant="ghost"
                disabled={idle}
                onClick={handlers.backToLocal}
              >
                {t("desktop.connection.backToLocal")}
              </Button>
            ) : null}
            <span className="flex-1" />
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
      <p className="m-0 text-ui-sm text-text-tertiary">
        {t(updateLineKey({ state: "unchecked" }))}
      </p>
    </div>
  );
}
