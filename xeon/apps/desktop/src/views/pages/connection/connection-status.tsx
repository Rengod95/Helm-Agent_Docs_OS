import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Alert, Badge, Button, SectionHeader, Switch } from "@caustic/react";
import { useId, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import type { ServiceCard } from "../../commands.ts";
import {
  canSetRemoteRespond,
  canStartService,
  canStopService,
  type ConnectionState,
  type ServiceAction,
} from "./connection-model.ts";

// 연결 화면의 오른쪽 덩어리 가운데 서비스 쪽(서비스 스위치 묶음, 이 기기 서비스 카드)과 섹션 부품(`ConnectionSection`).
// "호스트" 섹션은 `connection-current-host.tsx`와 `connection-host-section.tsx`가 그린다. 서버 모드 섹션은 `connection-server.tsx`다.
// 설명은 정보 아이콘 뒤에 두고, 경고와 실패는 그대로 보인다.

/** 상태 열이 내는 동작. 화면 핸들러의 일부다 */
interface StatusHandlers {
  readonly restart: () => void;
  /** 진단 정보를 클립보드에 복사한다 */
  readonly copyDiagnostics: () => void;
  readonly backToLocal: () => void;
  readonly setServiceMode: (enabled: boolean) => void;
  /** 이 기기 서비스 카드의 시작과 멈추기 */
  readonly startLocalService: () => void;
  readonly stopLocalService: () => void;
  readonly setRemoteRespond: (enabled: boolean) => void;
  readonly setStopConfirm: (open: boolean) => void;
  readonly openExtensions: () => void;
  /** 연결된 클라이언트 목록만 다시 읽는다(목록 읽기 실패의 다시 시도) */
  readonly retryClients: () => void;
}

/** 연결 화면 오른쪽 덩어리의 동작. 연결 실패의 다시 시도가 더 붙는다 */
export interface DetailHandlers extends StatusHandlers {
  readonly retry: () => void;
}

/**
 * 연결 화면의 섹션 하나. 머리는 caustic `SectionHeader`(제목 16/22 600, 설명, 끝 동작)이고, 본문은 그 아래 `gap-4`로 잇는다.
 * 섹션 사이의 큰 간격은 화면이 준다. 선이나 상자는 더하지 않는다.
 */
export function ConnectionSection(props: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  const { title, description, action, children } = props;
  return (
    <section aria-label={title} className="grid content-start gap-4">
      <SectionHeader title={title} description={description} action={action} />
      {children}
    </section>
  );
}

/** 이 기기 서비스 카드의 상태 줄. 실행 중이면 버전과 pid, 앱이 붙었는지를 잇는다 */
function serviceLineOf(card: ServiceCard): string {
  switch (card.kind) {
    case "running":
      return t("desktop.connection.service.card.running", {
        version: card.version,
        pid: card.pid,
        link: t(
          card.attached
            ? "desktop.connection.service.card.attached"
            : "desktop.connection.service.card.detached",
        ),
      });
    case "stopped":
      return t("desktop.connection.service.card.stopped");
    case "unknown":
      return t("desktop.connection.service.card.unknown");
    default:
      return assertNever(card, "ServiceCard");
  }
}

/** 시작이나 멈추기가 실패했을 때의 한 줄 문장 */
function serviceErrorTextOf(action: ServiceAction): string {
  return action === "start"
    ? t("desktop.connection.service.card.startFailed")
    : t("desktop.connection.service.card.stopFailed");
}

/**
 * 서비스 모드 스위치와 원격 응답 허용 줄(이 기기 대상일 때만 섹션에 넣는다). 설정 쓰기는 연결이 있고 다른 동작이 가고 있지 않을 때만 한다.
 */
export function ServiceModeRows(props: {
  readonly state: ConnectionState;
  readonly handlers: DetailHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const switchId = useId();
  const respondId = useId();
  const snapshot = state.status.kind === "ready" ? state.status.snapshot : null;
  const acting =
    snapshot !== null && !state.busy && state.serviceBusy === null && state.pending === null;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span id={switchId} className="min-w-0 text-ui text-text-primary">
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
      <div className="flex items-center gap-2">
        <span id={respondId} className="min-w-0 text-ui text-text-primary">
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
        <p className="m-0 text-ui text-text-tertiary">
          {t("desktop.connection.status.remoteRespondUnknown")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 이 기기의 서비스 카드(로컬 대상만). 상태 줄, 시작과 멈추기 단추, 실패 한 줄이다. 시작은 서비스를 켜고 엔진을 거기에 붙이며,
 * 멈추기는 서비스를 멈추고 엔진을 앱 안에서 다시 띄운다. 두 동작 모두 엔진을 다시 띄우므로 진행 중에는 단추를 잠근다.
 */
export function LocalServiceCard(props: {
  readonly state: ConnectionState;
  readonly handlers: DetailHandlers;
}): ReactNode {
  const { state, handlers } = props;
  return (
    <div className="grid gap-2">
      <p className="m-0 text-ui text-text-primary">{serviceLineOf(state.service)}</p>
      {state.serviceError === null ? null : (
        <Alert tone="danger" size="sm" variant="outline" className="text-ui">
          {serviceErrorTextOf(state.serviceError)}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="soft"
          loading={state.serviceBusy === "start"}
          disabled={!canStartService(state)}
          onClick={handlers.startLocalService}
        >
          {t("desktop.connection.service.card.start")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger-text"
          loading={state.serviceBusy === "stop"}
          disabled={!canStopService(state)}
          onClick={handlers.stopLocalService}
        >
          {t("desktop.connection.service.card.stop")}
        </Button>
      </div>
    </div>
  );
}
