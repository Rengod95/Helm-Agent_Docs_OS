import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Alert, Button, Dialog, Skeleton, Switch } from "@caustic/react";
import { Globe, Monitor, Moon } from "@caustic/react/icons";
import type { ReactNode } from "react";
import type { RemoteActions } from "../../../app/remote/use-remote-controller.ts";
import {
  accessUrls,
  fingerprintDisplay,
  type ServerMode,
} from "../../../app/remote/remote-model.ts";
import type {
  Loadable,
  RemoteNotice,
  RemoteScreenState,
} from "../../../app/remote/remote-state.ts";
import type { RemoteStatus } from "../../../app/remote/remote-types.ts";
import type { ServiceAutostart } from "../../../transport/ipc.ts";
import type { ServiceCard } from "../../commands.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import { canStopService, type ConnectionState } from "./connection-model.ts";
import { ConnectionSection } from "./connection-status.tsx";
import { serviceFailureIdOf } from "./connection-text.ts";
import { RadioCardGroup, RadioCardItem } from "./radio-card.tsx";

// "실행 방식" 섹션. 세 카드(앱 안에서·백그라운드·백그라운드 + 다른 기기)로 고른다. 고르기는 외부 접근 컨트롤러의 `selectMode`를 부른다.
// 백그라운드 계열이면 서비스 상태 한 줄, 로그인 자동 시작 스위치, 서비스 멈추기 단추를 카드 아래에 잇는다.
// 다른 기기 접속을 켜는 확인 대화 상자와 자동 시작 확인 대화 상자는 이 섹션이 맡는다(섹션이 늘 그려지므로 대화 상자가 떠 있을 수 있다).

const MODES: readonly ServerMode[] = ["off", "service", "service+remote"];

/** 라디오 값을 실행 방식으로 바꾼다. 모르는 값이면 null이다 */
function modeOfValue(value: string): ServerMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

/** 화면이 부르는 동작은 값을 돌려주지 않는다. 실패는 컨트롤러가 알림으로 남기므로 여기서는 기다리지 않는다 */
function run(work: Promise<void>): void {
  detach(work, rethrow);
}

export interface RunModeProps {
  /** 지금 실행 방식(카드가 보이는 값). 부르는 쪽이 `serverModeOf`로 정한다 */
  readonly mode: ServerMode;
  /** 화면 상태. 이 기기 서비스 상태, 다시 시작 대기, 서비스 멈추기 잠금을 읽는다 */
  readonly state: ConnectionState;
  /** 외부 접근 컨트롤러의 상태와 동작 */
  readonly remote: RemoteScreenState;
  readonly actions: RemoteActions;
  /** 마지막으로 고른 실행 방식. 서비스 실패 문장과 다시 시도가 이 값을 쓴다(앱 안에서였으면 멈추기 실패) */
  readonly lastChoice: ServerMode | null;
  /** 카드를 고른다. 고르기의 동작은 `selectMode`다 */
  readonly choose: (mode: ServerMode) => void;
  readonly handlers: {
    readonly restart: () => void;
    readonly setStopConfirm: (open: boolean) => void;
  };
  /** 대화 상자를 제자리에 그린다(시험용). 기본은 포털이다 */
  readonly inline?: boolean;
}

export function RunModeSection(props: RunModeProps): ReactNode {
  const { mode, state, remote, actions, lastChoice, choose, handlers, inline = false } = props;
  const busy = remote.busy !== "none";
  const background = mode !== "off";
  const status = remote.status.kind === "ready" ? remote.status.value : null;
  const notice = remote.notice;
  return (
    <ConnectionSection title={t("desktop.connection.runMode.heading")}>
      <div className="grid content-start gap-4">
        <RadioCardGroup
          label={t("desktop.connection.runMode.heading")}
          value={mode}
          disabled={busy}
          onValueChange={(value) => {
            const next = modeOfValue(value);
            if (next !== null) choose(next);
          }}
        >
          <RadioCardItem
            value="off"
            icon={<Monitor />}
            title={t("desktop.connection.runMode.embedded")}
            description={t("desktop.connection.runMode.embeddedHint")}
          />
          <RadioCardItem
            value="service"
            icon={<Moon />}
            title={t("desktop.connection.runMode.background")}
            description={t("desktop.connection.runMode.backgroundHint")}
          />
          <RadioCardItem
            value="service+remote"
            icon={<Globe />}
            title={t("desktop.connection.runMode.remote")}
            description={t("desktop.connection.runMode.remoteHint")}
          />
        </RadioCardGroup>
        {state.restartNeeded ? (
          <Alert
            tone="warning"
            size="sm"
            variant="outline"
            className="text-ui [&_[data-slot=button]]:text-ui"
            actions={
              busy
                ? undefined
                : [
                    {
                      label: t("desktop.connection.status.restart"),
                      onClick: handlers.restart,
                      primary: true,
                    },
                  ]
            }
          >
            {t("desktop.connection.runMode.restartNeeded")}
          </Alert>
        ) : null}
        {background ? <StatusNotice status={remote.status} busy={busy} actions={actions} /> : null}
        {notice === null ? null : (
          <RunNotice notice={notice} lastChoice={lastChoice} busy={busy} choose={choose} />
        )}
        {background ? (
          <>
            <p className="m-0 text-ui text-text-primary">{serviceLineOf(state.service)}</p>
            <AutostartRow
              autostart={remote.autostart}
              linger={remote.autostartLinger}
              notice={notice}
              busy={busy}
              actions={actions}
            />
            <Button
              size="sm"
              variant="ghost"
              className="justify-self-start text-danger-text"
              disabled={!canStopService(state)}
              onClick={() => {
                handlers.setStopConfirm(true);
              }}
            >
              {t("desktop.connection.status.stopService")}
            </Button>
          </>
        ) : null}
        <EnableDialog
          open={remote.confirmOpen}
          status={status}
          busy={remote.busy === "enabling"}
          inline={inline}
          actions={actions}
        />
        <AutostartDialog open={remote.autostartConfirmOpen} inline={inline} actions={actions} />
      </div>
    </ConnectionSection>
  );
}

/** 이 기기 서비스 상태 한 줄. 실행 중이면 버전과 pid, 앱이 붙었는지를 잇고, 꺼졌으면 이유를 잇는다 */
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
      return t("desktop.connection.service.card.stopped", { reason: card.reason });
    case "unknown":
      return t("desktop.connection.service.card.unknown");
    default:
      return assertNever(card, "ServiceCard");
  }
}

/** 외부 접근 상태를 읽는 자리. 백그라운드일 때만 보인다. 읽는 중이면 글 한 줄, 못 읽었으면 다시 시도를 준다 */
function StatusNotice(props: {
  readonly status: Loadable<RemoteStatus>;
  readonly busy: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { status, busy, actions } = props;
  switch (status.kind) {
    case "loading":
      return (
        <p role="status" className="m-0 text-ui text-text-tertiary">
          {t("desktop.connection.server.status.loading")}
        </p>
      );
    case "failed": {
      const retry = [
        {
          label: t("desktop.connection.retry"),
          onClick: () => {
            run(actions.reloadStatus());
          },
          primary: true,
        },
      ];
      // 지원 안 함은 차분한 글로, 그 밖의 실패는 위험 글로 보인다. 다시 시도는 두 경우 모두 있다
      if (status.error.kind === "unsupported") {
        return (
          <Alert
            tone="neutral"
            size="sm"
            variant="outline"
            className="text-ui [&_[data-slot=button]]:text-ui"
            actions={busy ? undefined : retry}
          >
            {t("desktop.connection.server.status.unsupported")}
          </Alert>
        );
      }
      return (
        <Alert
          tone="danger"
          size="sm"
          variant="outline"
          className="text-ui [&_[data-slot=button]]:text-ui"
          actions={busy ? undefined : retry}
        >
          {t("desktop.connection.server.status.loadFailed")}
        </Alert>
      );
    }
    case "ready":
      return null;
    default:
      return assertNever(status, "Loadable");
  }
}

/** 실행 방식에서 나온 쓰기 실패 문장. 자동 시작과 기기 끊기 실패는 각자 자리에 보이므로 여기서는 `null`이다 */
function runNoticeIdOf(notice: RemoteNotice, lastChoice: ServerMode | null): MessageId | null {
  switch (notice.kind) {
    case "enableFailed":
      return "desktop.connection.server.notice.enableFailed";
    case "disableFailed":
      return "desktop.connection.server.notice.disableFailed";
    case "serviceFailed":
      return serviceFailureIdOf(lastChoice ?? "service");
    case "revokeFailed":
    case "autostartFailed":
      return null;
    default:
      return assertNever(notice.kind, "RemoteNoticeKind");
  }
}

/** 실행 방식의 쓰기 실패 알림. 서비스 실패는 같은 방식으로 다시 시도를 준다 */
function RunNotice(props: {
  readonly notice: RemoteNotice;
  readonly lastChoice: ServerMode | null;
  readonly busy: boolean;
  readonly choose: (mode: ServerMode) => void;
}): ReactNode {
  const { notice, lastChoice, busy, choose } = props;
  const id = runNoticeIdOf(notice, lastChoice);
  if (id === null) return null;
  const retry =
    notice.kind === "serviceFailed" && lastChoice !== null && !busy
      ? [
          {
            label: t("desktop.connection.retry"),
            onClick: () => {
              choose(lastChoice);
            },
            primary: true,
          },
        ]
      : undefined;
  return (
    <Alert
      tone="danger"
      size="sm"
      variant="outline"
      className="text-ui [&_[data-slot=button]]:text-ui"
      actions={retry}
    >
      {t(id)}
    </Alert>
  );
}

// ── 로그인 자동 시작 ─────────────────────────────────────────────────────

/**
 * 로그인할 때 자동으로 시작 스위치. 상태를 못 읽으면 다시 읽기 알림을, 읽는 중이면 자리 표시를 보인다.
 * 이 기기가 지원하지 않으면 스위치를 잠그고 그 글을 보인다. Linux linger 안내는 켠 뒤 한 번 보인다.
 */
function AutostartRow(props: {
  readonly autostart: Loadable<ServiceAutostart>;
  readonly linger: boolean;
  readonly notice: RemoteNotice | null;
  readonly busy: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { autostart, linger, notice, busy, actions } = props;
  switch (autostart.kind) {
    case "loading":
      return <Skeleton width="50%" height={14} />;
    case "failed":
      return (
        <Alert
          tone="danger"
          size="sm"
          variant="outline"
          className="text-ui [&_[data-slot=button]]:text-ui"
          actions={
            busy
              ? undefined
              : [
                  {
                    label: t("desktop.connection.retry"),
                    onClick: () => {
                      run(actions.reloadAutostart());
                    },
                    primary: true,
                  },
                ]
          }
        >
          {t("desktop.connection.runMode.autostart.loadFailed")}
        </Alert>
      );
    case "ready":
      return (
        <AutostartSwitch
          value={autostart.value}
          linger={linger}
          notice={notice}
          busy={busy}
          actions={actions}
        />
      );
    default:
      return assertNever(autostart, "Loadable");
  }
}

function AutostartSwitch(props: {
  readonly value: ServiceAutostart;
  readonly linger: boolean;
  /** 자동 시작 쓰기 실패 알림. 자동 시작 실패가 아니면 아무것도 보이지 않는다 */
  readonly notice: RemoteNotice | null;
  readonly busy: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { value, linger, notice, busy, actions } = props;
  const label = t("desktop.connection.runMode.autostart.label");
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className="text-ui text-text-primary">{label}</span>
          <InfoTip text={t("desktop.connection.runMode.autostart.hint")} />
        </span>
        <Switch
          size="sm"
          aria-label={label}
          checked={value.registered}
          disabled={busy || !value.supported}
          onCheckedChange={(next) => {
            run(actions.requestAutostart(next));
          }}
        />
      </div>
      {value.supported ? null : (
        <span className="text-ui text-text-tertiary">
          {t("desktop.connection.runMode.autostart.unsupported")}
        </span>
      )}
      {linger ? (
        <div className="grid gap-1 text-ui text-text-secondary">
          <span>{t("desktop.connection.runMode.autostart.linger")}</span>
          <code className="font-mono text-text-primary">loginctl enable-linger</code>
        </div>
      ) : null}
      {notice === null || notice.kind !== "autostartFailed" ? null : (
        <Alert tone="danger" size="sm" variant="outline" className="text-ui">
          {t("desktop.connection.runMode.autostart.notice", { code: notice.code ?? "unknown" })}
        </Alert>
      )}
    </div>
  );
}

/** 자동 시작 켜기 확인. 파일을 어디에 쓰는지와 끄면 지운다는 것을 글로 보인다. 확인을 누르면 동작이 돈다 */
function AutostartDialog(props: {
  readonly open: boolean;
  readonly inline: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { open, inline, actions } = props;
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      open={open}
      onOpenChange={(next) => {
        if (!next) actions.cancelAutostartConfirm();
      }}
      title={t("desktop.connection.runMode.autostart.confirm.title")}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              actions.cancelAutostartConfirm();
            }}
          >
            {t("desktop.connection.server.cancel")}
          </Button>
          <Button
            variant="solid"
            size="sm"
            onClick={() => {
              run(actions.confirmAutostart());
            }}
          >
            {t("desktop.connection.runMode.autostart.confirm.enable")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui text-text-secondary">
        {t("desktop.connection.runMode.autostart.confirm.body")}
      </p>
    </Dialog>
  );
}

// ── 다른 기기 접속 켜기 확인 ─────────────────────────────────────────────

/** 다른 기기 접속 켜기 확인. 주소와 지문과 경고를 보이고, 확인을 누르면 외부 접속을 켠다 */
function EnableDialog(props: {
  readonly open: boolean;
  readonly status: RemoteStatus | null;
  readonly busy: boolean;
  readonly inline: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { open, status, busy, inline, actions } = props;
  // 다른 기기가 웹 브라우저로 붙는 주소는 https다. 루프백 주소는 이 기기 안에서만 쓴다
  const urls =
    status === null ? [] : accessUrls(status).filter((url) => url.startsWith("https://"));
  const fingerprint =
    status === null || status.fingerprint === null ? null : fingerprintDisplay(status.fingerprint);
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      open={open}
      onOpenChange={(next) => {
        if (!next) actions.cancelConfirm();
      }}
      title={t("desktop.connection.server.confirm.title")}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              actions.cancelConfirm();
            }}
          >
            {t("desktop.connection.server.cancel")}
          </Button>
          <Button
            variant="solid"
            size="sm"
            loading={busy}
            onClick={() => {
              run(actions.confirmRemote());
            }}
          >
            {t("desktop.connection.server.confirm.enable")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-ui text-text-secondary">
          {t("desktop.connection.server.confirm.opens")}
        </p>
        {urls.length === 0 ? (
          <p className="m-0 text-ui text-text-secondary">
            {t("desktop.connection.server.confirm.noAddress")}
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {urls.map((url) => (
              <li key={url} className="break-all font-mono text-ui-sm text-text-primary">
                {url}
              </li>
            ))}
          </ul>
        )}
        <Alert tone="warning" size="sm" variant="outline" className="text-ui">
          {t("desktop.connection.server.confirm.warning")}
        </Alert>
        <p className="m-0 text-ui text-text-secondary">
          {fingerprint === null
            ? t("desktop.connection.server.confirm.noFingerprint")
            : t("desktop.connection.server.confirm.fingerprint", { fingerprint })}
        </p>
      </div>
    </Dialog>
  );
}
