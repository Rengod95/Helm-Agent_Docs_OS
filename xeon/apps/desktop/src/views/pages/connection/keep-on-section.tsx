import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Button, Dialog, Skeleton, Switch } from "@caustic/react";
import type { ReactNode } from "react";
import type { RemoteScreen } from "../../../app/remote/use-remote-controller.ts";
import type { ServiceCard } from "../../commands.ts";
import {
  FORM_CONTROL_SIZE,
  RowNote,
  SettingRow,
  SettingSection,
} from "../settings/settings-section.tsx";
import { CommandLine } from "../shared/copyable.tsx";
import { attachedCountOf } from "./connection-hero.tsx";
import { canStopService, type ConnectionState } from "./connection-model.ts";
import type { SectionContext } from "./connection-sections.ts";
import { timeTextOf } from "./connection-text.ts";

// "이 컴퓨터를 계속 켜 두기"(시안 dzRW §4). SettingSection 줄 셋이다.
//   줄 1 앱을 닫아도 계속 실행: 스위치. 켜기는 컨트롤러 `keepOn`(서비스 시작 + 미등록이면 로그인 자동 시작), 끄기는 StopDialog 확인을 거친다.
//   줄 2 로그인하면 자동으로 시작(서비스가 돌 때만): 스위치. 켜기는 이 구역이 그리는 확인 대화 상자를 거친다. Linux linger 안내와 명령 한 줄.
//   줄 3 서비스(앱 안이면 "엔진"): [다시 시작] outline · [멈추기] ghost 위험 글. 엔진 다시 시작은 화면에서 이 한 곳이다.
// 다른 컴퓨터에 붙어 있으면 한 줄 안내로 접고, 브라우저로 들어온 화면이면 스위치 대신 "그 컴퓨터의 앱에서 해요" 줄을 둔다.

const LINGER_COMMAND = "loginctl enable-linger $USER";

/** 화면이 부르는 동작은 값을 돌려주지 않는다. 실패는 컨트롤러가 알림으로 남긴다 */
function run(work: Promise<void>): void {
  detach(work, rethrow);
}

type FailureTexts = { readonly cause: MessageId; readonly fix: MessageId };

/** 셸의 서비스 시작 실패 코드(`ServiceStartFailureCode`)마다 "원인 + 고치는 법" 문구 */
const FAILURE_TEXTS: ReadonlyMap<string, FailureTexts> = new Map<string, FailureTexts>([
  [
    "launch_mode_unrunnable",
    {
      cause: "desktop.connection.keepOn.failure.launchModeUnrunnable.cause",
      fix: "desktop.connection.keepOn.failure.launchModeUnrunnable.fix",
    },
  ],
  [
    "launch_mode_failed",
    {
      cause: "desktop.connection.keepOn.failure.launchModeFailed.cause",
      fix: "desktop.connection.keepOn.failure.launchModeFailed.fix",
    },
  ],
  [
    "launch_mode_unreadable",
    {
      cause: "desktop.connection.keepOn.failure.launchModeUnreadable.cause",
      fix: "desktop.connection.keepOn.failure.launchModeUnreadable.fix",
    },
  ],
  [
    "ensure_unrunnable",
    {
      cause: "desktop.connection.keepOn.failure.ensureUnrunnable.cause",
      fix: "desktop.connection.keepOn.failure.ensureUnrunnable.fix",
    },
  ],
  [
    "ensure_failed",
    {
      cause: "desktop.connection.keepOn.failure.ensureFailed.cause",
      fix: "desktop.connection.keepOn.failure.ensureFailed.fix",
    },
  ],
  [
    "ensure_unusable",
    {
      cause: "desktop.connection.keepOn.failure.ensureUnusable.cause",
      fix: "desktop.connection.keepOn.failure.ensureUnusable.fix",
    },
  ],
  [
    "bridge_failed",
    {
      cause: "desktop.connection.keepOn.failure.bridgeFailed.cause",
      fix: "desktop.connection.keepOn.failure.bridgeFailed.fix",
    },
  ],
]);

const UNKNOWN_FAILURE: FailureTexts = {
  cause: "desktop.connection.keepOn.failure.unknown.cause",
  fix: "desktop.connection.keepOn.failure.unknown.fix",
};

/** 서비스 시작 실패 코드의 "원인 + 고치는 법" 문구. 모르는 코드는 일반 문구다 */
export function failureTextsOf(code: string): FailureTexts {
  return FAILURE_TEXTS.get(code) ?? UNKNOWN_FAILURE;
}

/** 줄 1의 상태 글. 켜짐은 상태 점 + "언제부터 실행 중 (기기 n대)", 꺼짐은 "앱을 닫으면 엔진도 멈춰요." */
function RunStatus(props: {
  readonly service: ServiceCard;
  readonly count: number | null;
  readonly locale: Locale;
}): ReactNode {
  const { service, count, locale } = props;
  switch (service.kind) {
    case "running": {
      const time = timeTextOf(new Date(service.startedAt).toISOString(), locale);
      return (
        <span data-slot="keep-on-status" className="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden className="size-2 flex-none rounded-full bg-success-graphic" />
          <span className="min-w-0 text-text-secondary">
            {count === null
              ? t("desktop.connection.keepOn.run.onShort", { time })
              : t("desktop.connection.keepOn.run.on", { time, count })}
          </span>
        </span>
      );
    }
    case "stopped":
      return <span data-slot="keep-on-status">{t("desktop.connection.keepOn.run.off")}</span>;
    case "unknown":
      return <span data-slot="keep-on-status">{t("desktop.connection.keepOn.run.unknown")}</span>;
    default:
      return assertNever(service, "ServiceCard");
  }
}

/** 스위치 자리의 뼈대(Switch sm과 같은 32×18) */
function SwitchSkeleton(): ReactNode {
  return <Skeleton width={32} height={18} />;
}

/** 줄 1 아래의 시작 실패: 원인과 고치는 법, 다시 시도, 기술 원인은 접는 "자세히" */
function StartFailureNote(props: {
  readonly failure: { readonly code: string; readonly detail: string };
  readonly locked: boolean;
  readonly retry: () => void;
}): ReactNode {
  const { failure, locked, retry } = props;
  const texts = failureTextsOf(failure.code);
  return (
    <RowNote
      tone="danger"
      slot="keep-on-start-failure"
      actions={
        <>
          <Button size="xs" variant="outline" disabled={locked} onClick={retry}>
            {t("desktop.connection.retry")}
          </Button>
          {failure.detail === "" ? null : (
            <details className="min-w-0 basis-full">
              <summary className="cursor-pointer text-ui-sm text-text-tertiary">
                {t("desktop.connection.keepOn.failure.detail")}
              </summary>
              <code className="block break-all pt-1 font-mono text-mono-sm text-text-secondary">
                {failure.detail}
              </code>
            </details>
          )}
        </>
      }
    >
      {t("desktop.connection.keepOn.failure.lead")} {t(texts.cause)} {t(texts.fix)}
    </RowNote>
  );
}

/** 줄 2: 로그인하면 자동으로 시작. 읽는 중이면 뼈대, 못 읽었으면 다시 읽기, 지원하지 않으면 잠그고 이유를 보인다 */
function AutostartRow(props: {
  readonly remote: RemoteScreen;
  readonly locked: boolean;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { remote, locked, copy } = props;
  const { state, actions } = remote;
  const label = t("desktop.connection.keepOn.autostart.label");
  const autostart = state.autostart;
  const notice = state.notice?.kind === "autostartFailed" ? state.notice : null;
  const control = ((): ReactNode => {
    switch (autostart.kind) {
      case "loading":
        return <SwitchSkeleton />;
      case "failed":
        return undefined;
      case "ready":
        return (
          <Switch
            size={FORM_CONTROL_SIZE}
            aria-label={label}
            checked={autostart.value.registered}
            disabled={locked || !autostart.value.supported}
            onCheckedChange={(next) => {
              run(actions.requestAutostart(next));
            }}
          />
        );
      default:
        return assertNever(autostart, "Loadable");
    }
  })();
  const unsupported = autostart.kind === "ready" && !autostart.value.supported;
  const notes = (
    <>
      {autostart.kind === "failed" ? (
        <RowNote
          tone="danger"
          slot="keep-on-autostart-load-failed"
          actions={
            <Button
              size="xs"
              variant="outline"
              disabled={locked}
              onClick={() => {
                run(actions.reloadAutostart());
              }}
            >
              {t("desktop.connection.retry")}
            </Button>
          }
        >
          {t("desktop.connection.keepOn.autostart.loadFailed")}
        </RowNote>
      ) : null}
      {state.autostartLinger ? (
        <>
          <RowNote slot="keep-on-linger">{t("desktop.connection.keepOn.autostart.linger")}</RowNote>
          <CommandLine text={LINGER_COMMAND} onCopy={copy} slot="keep-on-linger-command" />
        </>
      ) : null}
      {notice === null ? null : (
        <RowNote tone="danger" slot="keep-on-autostart-failed">
          {t("desktop.connection.keepOn.autostart.failed", { code: notice.code ?? "unknown" })}
        </RowNote>
      )}
    </>
  );
  return (
    <SettingRow
      slot="keep-on-autostart"
      label={label}
      info={t("desktop.connection.keepOn.autostart.info")}
      description={unsupported ? t("desktop.connection.keepOn.autostart.unsupported") : undefined}
      control={control}
      disabled={unsupported}
      notes={notes}
    />
  );
}

/** 자동 시작 켜기 확인. 어디에 파일을 쓰는지와 끄면 지운다는 것을 보인다 */
function AutostartDialog(props: {
  readonly remote: RemoteScreen;
  readonly inline: boolean;
}): ReactNode {
  const { remote, inline } = props;
  const { actions } = remote;
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      open={remote.state.autostartConfirmOpen}
      onOpenChange={(next) => {
        if (!next) actions.cancelAutostartConfirm();
      }}
      title={t("desktop.connection.keepOn.autostart.confirm.title")}
      footer={
        <>
          <Button
            variant="outline"
            size={FORM_CONTROL_SIZE}
            onClick={() => {
              actions.cancelAutostartConfirm();
            }}
          >
            {t("desktop.connection.keepOn.autostart.confirm.cancel")}
          </Button>
          <Button
            variant="solid"
            size={FORM_CONTROL_SIZE}
            loading={remote.state.busy === "autostart"}
            onClick={() => {
              run(actions.confirmAutostart());
            }}
          >
            {t("desktop.connection.keepOn.autostart.confirm.enable")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui text-text-secondary">
        {t("desktop.connection.keepOn.autostart.confirm.body")}
      </p>
    </Dialog>
  );
}

/** 읽는 중: 줄 1과 줄 3 모양을 그대로 두고 조작부 자리만 뼈대다(카드 높이 유지) */
function LoadingRows(): ReactNode {
  return (
    <>
      <SettingRow
        slot="keep-on-run"
        label={t("desktop.connection.keepOn.run.label")}
        info={t("desktop.connection.keepOn.run.info")}
        description={<Skeleton width={160} height={14} />}
        control={<SwitchSkeleton />}
      />
      <SettingRow
        slot="keep-on-service"
        label={t("desktop.connection.keepOn.service.label")}
        control={<Skeleton width={160} height={28} />}
      />
    </>
  );
}

export function KeepOnSection(
  props: SectionContext & {
    /** 대화 상자를 제자리에 그린다(시험용). 기본은 포털이다 */
    readonly inline?: boolean;
  },
): ReactNode {
  const { state, engine, locale, handlers, remote, web, copy } = props;
  const title = t("desktop.connection.keepOn.title");

  // 다른 컴퓨터에 붙어 있다: 그 컴퓨터의 서비스는 이 화면이 바꾸지 않는다
  if (state.engineTarget.kind === "remote") {
    return (
      <SettingSection title={title} body="plain">
        <p data-slot="keep-on-remote-target" className="m-0 text-ui text-text-tertiary">
          {t("desktop.connection.keepOn.remoteTarget")}
        </p>
      </SettingSection>
    );
  }

  const count = attachedCountOf(state);
  const runLabel = t("desktop.connection.keepOn.run.label");
  const runInfo = t("desktop.connection.keepOn.run.info");

  if (web) {
    return (
      <SettingSection title={title}>
        <SettingRow
          slot="keep-on-run"
          label={runLabel}
          info={runInfo}
          description={<RunStatus service={state.service} count={count} locale={locale} />}
        />
        <p data-slot="keep-on-web" className="m-0 text-ui text-text-tertiary">
          {t("desktop.connection.keepOn.web")}
        </p>
      </SettingSection>
    );
  }

  if (remote === null || state.status.kind === "loading") {
    return (
      <SettingSection title={title}>
        <LoadingRows />
      </SettingSection>
    );
  }

  const running = state.service.kind === "running";
  const locked = remote.state.busy !== "none" || state.busy || state.pending !== null;
  const startFailure = state.service.kind === "unknown" ? undefined : state.service.startFailure;
  const serviceNotice = remote.state.notice?.kind === "serviceFailed";
  const restarting = engine?.kind === "restarting";

  /** 켜기: 서비스 시작(+ 미등록이면 자동 시작). 끝나면 화면 상태를 다시 읽어 줄 1과 멈추기 잠금이 따라간다 */
  const turnOnThenRefresh = async (): Promise<void> => {
    await remote.actions.keepOn(true, running);
    handlers.refresh();
  };
  const turnOn = (): void => {
    run(turnOnThenRefresh());
  };
  const askStop = (): void => {
    handlers.setStopConfirm(true);
  };

  const runNotes = (
    <>
      {startFailure === undefined ? null : (
        <StartFailureNote
          failure={startFailure}
          locked={locked}
          retry={running ? handlers.restart : turnOn}
        />
      )}
      {startFailure === undefined && serviceNotice ? (
        <RowNote
          tone="danger"
          slot="keep-on-service-failed"
          actions={
            <Button
              size="xs"
              variant="outline"
              disabled={locked}
              onClick={running ? askStop : turnOn}
            >
              {t("desktop.connection.retry")}
            </Button>
          }
        >
          {t(
            running
              ? "desktop.connection.keepOn.notice.stopFailed"
              : "desktop.connection.keepOn.notice.startFailed",
          )}
        </RowNote>
      ) : null}
    </>
  );

  return (
    <>
      <SettingSection title={title}>
        {state.restartNeeded ? (
          <RowNote
            slot="keep-on-restart-needed"
            actions={
              <Button size="xs" variant="outline" disabled={state.busy} onClick={handlers.restart}>
                {t("desktop.connection.keepOn.service.restart")}
              </Button>
            }
          >
            {t("desktop.connection.keepOn.restartNeeded")}
          </RowNote>
        ) : null}
        <SettingRow
          slot="keep-on-run"
          label={runLabel}
          info={runInfo}
          description={<RunStatus service={state.service} count={count} locale={locale} />}
          control={
            <Switch
              size={FORM_CONTROL_SIZE}
              aria-label={runLabel}
              checked={running}
              disabled={locked || (running && !canStopService(state))}
              onCheckedChange={(next) => {
                if (next) turnOn();
                else askStop();
              }}
            />
          }
          notes={runNotes}
        />
        {running ? <AutostartRow remote={remote} locked={locked} copy={copy} /> : null}
        <ServiceRow
          state={state}
          running={running}
          restarting={restarting}
          restart={handlers.restart}
          askStop={askStop}
        />
      </SettingSection>
      <AutostartDialog remote={remote} inline={props.inline ?? false} />
    </>
  );
}

/** 줄 3: 서비스(앱 안이면 엔진). 다시 시작은 늘, 멈추기는 서비스가 돌 때만 */
function ServiceRow(props: {
  readonly state: ConnectionState;
  readonly running: boolean;
  readonly restarting: boolean;
  readonly restart: () => void;
  readonly askStop: () => void;
}): ReactNode {
  const { state, running, restarting, restart, askStop } = props;
  return (
    <SettingRow
      slot="keep-on-service"
      label={t(
        running
          ? "desktop.connection.keepOn.service.label"
          : "desktop.connection.keepOn.engine.label",
      )}
      control={
        <>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="outline"
            loading={restarting}
            disabled={state.busy || state.pending !== null}
            onClick={restart}
          >
            {t("desktop.connection.keepOn.service.restart")}
          </Button>
          {running ? (
            <Button
              size={FORM_CONTROL_SIZE}
              variant="ghost"
              className="text-danger-text"
              disabled={!canStopService(state)}
              onClick={askStop}
            >
              {t("desktop.connection.keepOn.service.stop")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
