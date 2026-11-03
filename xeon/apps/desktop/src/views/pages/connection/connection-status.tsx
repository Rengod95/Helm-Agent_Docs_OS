import { updateLineKey } from "@fresnel/client/settings";
import { t, type Locale } from "@fresnel/client/i18n";
import {
  Alert,
  Badge,
  Button,
  Card,
  ListDescription,
  ListDescriptionRow,
  Switch,
} from "@caustic/react";
import { ArrowRight, RotateCw } from "@caustic/react/icons";
import { useId, type ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import {
  canSetRemoteRespond,
  type ConnectionState,
  type TargetChoice,
} from "./connection-model.ts";
import { engineMessageOf, modeMessageOf, timeTextOf } from "./connection-text.ts";

// 연결 화면의 상태 카드(P-08 오른쪽). 현재 대상과 host.status 값을 키-값 목록으로, 서비스 모드 설정, 엔진 다시 시작,
// 서비스 멈추기(서비스로 붙어 있을 때만), 확장 상태 링크 한 줄, 맨 아래 업데이트 확인 줄을 둔다.
// 업데이트 확인은 데이터 원천이 없어 항상 "확인 전" 줄이다(결정 A2: 내려받기와 교체는 하지 않는다).

/** 상태 카드가 내는 동작. 화면 핸들러의 일부다 */
export interface StatusHandlers {
  readonly restart: () => void;
  readonly setServiceMode: (enabled: boolean) => void;
  readonly setRemoteRespond: (enabled: boolean) => void;
  readonly setStopConfirm: (open: boolean) => void;
  readonly openExtensions: () => void;
}

export interface ConnectionStatusCardProps {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: StatusHandlers;
}

/** 엔진이 붙은 대상의 이름. 이 기기는 메시지 키이고 원격은 저장된 이름이다 */
function choiceNameOf(choice: TargetChoice): string {
  return choice.kind === "local" ? t("desktop.connection.targets.local") : choice.entry.label;
}

/** 경고 배지 색. 글자와 함께 쓴다(접근성: 색만으로 뜻을 주지 않는다). 배지 `tone`은 쓰지 않는다(schedule-table과 같다) */
const WARNING_BADGE = "bg-warning-soft text-warning-text";

export function ConnectionStatusCard(props: ConnectionStatusCardProps): ReactNode {
  const { state, engine, locale, handlers } = props;
  const headingId = useId();
  const switchId = useId();
  const respondId = useId();
  const snapshot = state.status.kind === "ready" ? state.status.snapshot : null;
  const host = snapshot === null ? null : snapshot.host;
  // 설정 쓰기와 서비스 멈추기는 연결이 있고 다른 동작이 가고 있지 않을 때만 한다
  const acting = snapshot !== null && !state.busy && state.pending === null;
  return (
    <Card role="region" aria-labelledby={headingId} size="sm" className="grid min-w-0 gap-3">
      <h2 id={headingId} className="text-ui-strong text-text-primary">
        {t("desktop.connection.status.heading")}
      </h2>
      {state.status.kind === "loading" ? (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.connection.status.loading")}
        </p>
      ) : null}
      {state.status.kind === "failed" ? (
        <Alert tone="danger">{t("desktop.connection.status.loadFailed")}</Alert>
      ) : null}
      {state.status.kind === "offline" ? (
        <Alert tone="warning">{t("desktop.connection.status.offline")}</Alert>
      ) : null}
      <ListDescription aria-label={t("desktop.connection.status.heading")}>
        <ListDescriptionRow term={t("desktop.connection.status.current")}>
          {choiceNameOf(state.engineTarget)}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.connection.status.engine")}>
          {t(engineMessageOf(engine))}
        </ListDescriptionRow>
        {host === null ? null : (
          <>
            <ListDescriptionRow term={t("desktop.connection.status.mode")}>
              {t(modeMessageOf(host.mode))}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.connection.status.pid")} mono>
              {host.pid}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.connection.status.startedAt")}>
              {timeTextOf(host.startedAt, locale)}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.connection.status.connections")}>
              {host.connections}
            </ListDescriptionRow>
            <ListDescriptionRow term={t("desktop.connection.status.liveTurns")}>
              {host.liveTurns}
            </ListDescriptionRow>
            {host.idleShutdownAt === null ? null : (
              <ListDescriptionRow term={t("desktop.connection.status.idleShutdownAt")}>
                {timeTextOf(host.idleShutdownAt, locale)}
              </ListDescriptionRow>
            )}
            <ListDescriptionRow term={t("desktop.connection.status.safeMode")}>
              {t(host.safeMode === true ? "desktop.connection.on" : "desktop.connection.off")}
            </ListDescriptionRow>
          </>
        )}
      </ListDescription>
      <Button
        variant="ghost"
        size="xs"
        iconEnd={<ArrowRight />}
        className="justify-self-start"
        onClick={handlers.openExtensions}
      >
        {t("desktop.connection.status.extensions")}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={switchId} className="text-ui text-text-primary">
          {t("desktop.connection.status.serviceMode")}
        </span>
        <span className="inline-flex items-center gap-2">
          {state.restartNeeded ? (
            <Badge className={WARNING_BADGE}>{t("desktop.connection.status.restartNeeded")}</Badge>
          ) : null}
          <Switch
            aria-labelledby={switchId}
            checked={state.serviceEnabled === true}
            disabled={!acting || state.serviceEnabled === null}
            onCheckedChange={handlers.setServiceMode}
          />
        </span>
      </div>
      <p className="text-ui-sm text-text-tertiary">
        {t("desktop.connection.status.serviceModeHint")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={respondId} className="text-ui text-text-primary">
          {t("desktop.connection.status.remoteRespond")}
        </span>
        <Switch
          aria-labelledby={respondId}
          checked={state.remoteAllowRespond === true}
          disabled={!canSetRemoteRespond(state)}
          onCheckedChange={handlers.setRemoteRespond}
        />
      </div>
      <p className="text-ui-sm text-text-tertiary">
        {t("desktop.connection.status.remoteRespondHint")}
      </p>
      {state.status.kind === "ready" && state.remoteAllowRespond === null ? (
        <p className="text-ui-sm text-text-tertiary">
          {t("desktop.connection.status.remoteRespondUnknown")}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          iconStart={<RotateCw />}
          disabled={state.busy}
          onClick={handlers.restart}
        >
          {t("desktop.connection.status.restart")}
        </Button>
        {host !== null && host.mode === "service" ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-text"
            disabled={!acting}
            onClick={() => {
              handlers.setStopConfirm(true);
            }}
          >
            {t("desktop.connection.status.stopService")}
          </Button>
        ) : null}
      </div>
      <p className="text-ui-sm text-text-tertiary">{t(updateLineKey({ state: "unchecked" }))}</p>
    </Card>
  );
}
