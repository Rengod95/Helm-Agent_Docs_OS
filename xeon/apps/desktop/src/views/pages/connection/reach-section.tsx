import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  Button,
  Dialog,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  Switch,
} from "@caustic/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { accessUrls, fingerprintDisplay, serverModeOf } from "../../../app/remote/remote-model.ts";
import type { RemoteStatus, TailscaleInfo } from "../../../app/remote/remote-types.ts";
import type { RemoteScreen } from "../../../app/remote/use-remote-controller.ts";
import { CheckSteps, type CheckStep } from "../shared/check-steps.tsx";
import { CodeBlock, CommandLine } from "../shared/copyable.tsx";
import { StatusBand } from "../shared/status-band.tsx";
import {
  FIELD_WIDTH,
  FORM_CONTROL_SIZE,
  RowNote,
  SettingRow,
  SettingSection,
} from "../settings/settings-section.tsx";
import { canSetRemoteRespond } from "./connection-model.ts";
import type { SectionContext } from "./connection-sections.ts";
import { appliedDomainOf, useReachSetup, type ReachSetupActions } from "./reach-container.tsx";
import {
  AUTO_FIX_LABEL,
  configIssueTextOf,
  defaultReachMode,
  DOMAIN_ISSUE_TEXT,
  domainIssueOf,
  LINE_LABEL,
  panelAddressesOf,
  PROXY_KINDS,
  REACH_MODES,
  reachLinesOf,
  remoteErrorTextOf,
  serveCommandOf,
  serveFailureTextOf,
  serveIsOn,
  tailscaleBandOf,
  type PanelAddress,
  type ReachLine,
  type ReachMode,
  type ReachSetupState,
} from "./reach-model.ts";
import { PairPanel } from "./reach-pair-panel.tsx";

// "휴대폰·브라우저에서 쓰기"(시안 §6.1~6.4). 한 카드(SettingSection rows)에 위에서부터:
//   다른 기기 접속 스위치 줄 → (켜졌을 때) "어떻게 닿나요?" 세그먼트 → 방식별 패널 → 다른 기기에서 승인하기 줄.
// 방식별 패널: 같은 Wi‑Fi = 사전 점검 4줄 + 연결 패널 + 인증서·알림 안내, Tailscale = 상태 띠 + 신뢰되는 HTTPS 스위치 + 연결 패널,
// 공개 서버 = 도메인 칸 + 프록시 설정 + 닿는지 점검 + 연결 패널. 새 호출은 `reach-container.tsx`, 판단은 `reach-model.ts`가 한다.
// 이 컴퓨터의 컨트롤러(`remote`)가 없으면(다른 컴퓨터에 붙어 있음) 한 줄 안내만 그린다.

const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";

const MODE_LABEL: Readonly<Record<ReachMode, MessageId>> = {
  wifi: "desktop.connection.reach.mode.wifi",
  tailscale: "desktop.connection.reach.mode.tailscale",
  public: "desktop.connection.reach.mode.public",
};

function run(work: Promise<void>): void {
  detach(work, rethrow);
}

export function ReachSection(props: SectionContext): ReactNode {
  if (props.remote === null) {
    return (
      <SettingSection title={t("desktop.connection.reach.title")}>
        <p className="m-0 text-ui text-text-tertiary">{t("desktop.connection.reach.elsewhere")}</p>
      </SettingSection>
    );
  }
  return <ReachContainer {...props} remote={props.remote} />;
}

type ReachContext = SectionContext & { readonly remote: RemoteScreen };

function statusOf(remote: RemoteScreen): RemoteStatus | null {
  return remote.state.status.kind === "ready" ? remote.state.status.value : null;
}

function ReachContainer(props: ReachContext): ReactNode {
  const status = statusOf(props.remote);
  const serviceRunning = props.state.service.kind === "running";
  const enabled = serverModeOf(status, serviceRunning) === "service+remote" && !props.web;
  const reach = useReachSetup({
    status,
    enabled,
    statusKey: `${status?.state ?? "none"}:${String(serviceRunning)}:${String(status?.tlsPort ?? 0)}`,
    copy: props.copy,
  });
  return <ReachView {...props} setup={reach.setup} setupActions={reach.actions} />;
}

export interface ReachViewProps extends ReachContext {
  readonly setup: ReachSetupState;
  readonly setupActions: ReachSetupActions;
  /** 대화 상자를 제자리에 그린다(시험용) */
  readonly inline?: boolean;
  /** 처음 고른 방식(시험용). 없으면 기본값 규칙 */
  readonly initialMode?: ReachMode;
}

/** 구역 그림. 상태와 동작은 props로만 받는다(서버 렌더 시험이 직접 그린다) */
export function ReachView(props: ReachViewProps): ReactNode {
  const { remote, state, setup } = props;
  const status = statusOf(remote);
  const serviceRunning = state.service.kind === "running";
  const enabled = serverModeOf(status, serviceRunning) === "service+remote";
  const tailscale = setup.tailscale.kind === "ready" ? setup.tailscale.value : null;
  const [picked, setPicked] = useState<ReachMode | null>(props.initialMode ?? null);
  const mode = picked ?? defaultReachMode(tailscale, status?.hosts ?? []);

  /** 방식 고르기는 컨트롤러의 `selectMode`다. 끝나면 화면 상태를 다시 읽는다(서비스 상태 줄이 따라간다) */
  const select = (next: "service" | "service+remote"): void => {
    run(
      remote.actions.selectMode(next, serviceRunning).then(() => {
        props.handlers.refresh();
        return undefined;
      }),
    );
  };

  return (
    <SettingSection title={t("desktop.connection.reach.title")}>
      <EnableRow {...props} status={status} enabled={enabled} onSelect={select} />
      {enabled && status !== null && !props.web ? (
        <>
          <SettingRow
            layout="stacked"
            label={t("desktop.connection.reach.mode.label")}
            control={
              <SegmentedControl
                size={FORM_CONTROL_SIZE}
                aria-label={t("desktop.connection.reach.mode.label")}
                value={mode}
                onValueChange={(next) => {
                  const found = REACH_MODES.find((item) => item === next);
                  if (found !== undefined) setPicked(found);
                }}
              >
                {REACH_MODES.map((item) => (
                  <SegmentedControlItem key={item} value={item}>
                    {t(MODE_LABEL[item])}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            }
          />
          <ModePanel
            {...props}
            status={status}
            mode={mode}
            tailscale={tailscale}
            onSelect={select}
          />
        </>
      ) : null}
      {enabled && status !== null && props.web ? (
        <div data-slot="reach-web-panel">
          <PairPanel
            addresses={webAddressesOf(props, status, tailscale)}
            pairing={remote.state.pairing}
            nowMs={props.nowMs}
            busy={remote.state.busy !== "none"}
            fingerprint={null}
            onIssue={() => {
              run(remote.actions.issuePairing());
            }}
            copy={props.copy}
          />
        </div>
      ) : null}
      {enabled ? <RespondRow {...props} /> : null}
      <EnableDialog {...props} status={status} />
    </SettingSection>
  );
}

// ── 켜기 줄 ─────────────────────────────────────────────────────────────

function EnableRow(
  props: ReachViewProps & {
    readonly status: RemoteStatus | null;
    readonly enabled: boolean;
    readonly onSelect: (mode: "service" | "service+remote") => void;
  },
): ReactNode {
  const { remote, status, enabled, web } = props;
  const labelId = useId();
  const busy = remote.state.busy !== "none";
  const loaded = remote.state.status;
  const label = t("desktop.connection.reach.enable.label");
  const info = t("desktop.connection.reach.enable.info");
  if (loaded.kind === "loading") {
    return (
      <SettingRow
        label={label}
        info={info}
        control={<Skeleton width={32} height={18} />}
        slot="reach-enable"
      />
    );
  }
  if (loaded.kind === "failed") {
    const unsupported = loaded.error.kind === "unsupported";
    return (
      <SettingRow
        label={label}
        info={info}
        slot="reach-enable"
        notes={
          <RowNote
            tone={unsupported ? "warning" : "danger"}
            actions={
              unsupported ? undefined : (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    run(remote.actions.reloadStatus());
                  }}
                >
                  {t("desktop.connection.reach.reload")}
                </Button>
              )
            }
          >
            {unsupported
              ? t("desktop.connection.reach.error.unsupported")
              : t("desktop.connection.reach.enable.loadFailed")}
          </RowNote>
        }
      />
    );
  }
  if (web) {
    return (
      <SettingRow
        label={label}
        info={info}
        slot="reach-enable"
        description={t("desktop.connection.reach.enable.web")}
      />
    );
  }
  const starting = status !== null && status.state === "starting";
  const failed = status !== null && status.state === "failed";
  const notice = remote.state.notice;
  const noticeText =
    notice === null
      ? null
      : notice.kind === "enableFailed"
        ? t("desktop.connection.reach.notice.enableFailed")
        : notice.kind === "disableFailed"
          ? t("desktop.connection.reach.notice.disableFailed")
          : notice.kind === "serviceFailed"
            ? t("desktop.connection.reach.notice.serviceFailed")
            : null;
  return (
    <SettingRow
      label={label}
      labelId={labelId}
      info={info}
      slot="reach-enable"
      description={
        enabled
          ? starting
            ? t("desktop.connection.reach.enable.starting")
            : undefined
          : t("desktop.connection.reach.enable.offHint")
      }
      control={
        <Switch
          size={FORM_CONTROL_SIZE}
          aria-labelledby={labelId}
          checked={enabled}
          disabled={busy}
          onCheckedChange={(next) => {
            props.onSelect(next ? "service+remote" : "service");
          }}
        />
      }
      notes={
        <>
          {failed && status.error !== null ? (
            <RowNote
              tone="danger"
              actions={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    run(remote.actions.retryEnable());
                  }}
                >
                  {t("desktop.connection.retry")}
                </Button>
              }
            >
              {t("desktop.connection.reach.enable.failed", { message: status.error.message })}
            </RowNote>
          ) : null}
          {noticeText === null ? null : <RowNote tone="danger">{noticeText}</RowNote>}
        </>
      }
    />
  );
}

/** 켜기 확인 대화 상자의 본문: 켜면 열리는 주소 + 위험 한 줄 */
export function EnableDialogBody(props: { readonly status: RemoteStatus | null }): ReactNode {
  const urls =
    props.status === null
      ? []
      : accessUrls(props.status).filter((url) => url.startsWith("https://"));
  return (
    <div data-slot="reach-enable-body" className="grid gap-3">
      <p className="m-0 text-ui text-text-secondary">
        {urls.length === 0
          ? t("desktop.connection.reach.confirm.noAddress")
          : t("desktop.connection.reach.confirm.opens")}
      </p>
      {urls.length === 0 ? null : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {urls.map((url) => (
            <li key={url} className="break-all font-mono text-mono-sm text-text-primary">
              {url}
            </li>
          ))}
        </ul>
      )}
      <RowNote tone="warning">{t("desktop.connection.reach.confirm.risk")}</RowNote>
    </div>
  );
}

function EnableDialog(props: ReachViewProps & { readonly status: RemoteStatus | null }): ReactNode {
  const { remote } = props;
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={props.inline === true && remote.state.confirmOpen}
      open={remote.state.confirmOpen}
      onOpenChange={(next) => {
        if (!next) remote.actions.cancelConfirm();
      }}
      title={t("desktop.connection.reach.confirm.title")}
      footer={
        <>
          <Button
            variant="outline"
            size={FORM_CONTROL_SIZE}
            onClick={() => {
              remote.actions.cancelConfirm();
            }}
          >
            {t("desktop.connection.reach.cancel")}
          </Button>
          <Button
            variant="solid"
            size={FORM_CONTROL_SIZE}
            loading={remote.state.busy === "enabling"}
            onClick={() => {
              run(
                remote.actions.confirmRemote().then(() => {
                  props.handlers.refresh();
                  return undefined;
                }),
              );
            }}
          >
            {t("desktop.connection.reach.confirm.enable")}
          </Button>
        </>
      }
    >
      <EnableDialogBody status={props.status} />
    </Dialog>
  );
}

// ── 다른 기기에서 승인하기 ────────────────────────────────────────────────

function RespondRow(props: ReachViewProps): ReactNode {
  const { state } = props;
  const labelId = useId();
  return (
    <SettingRow
      label={t("desktop.connection.reach.respond.label")}
      labelId={labelId}
      info={t("desktop.connection.reach.respond.info")}
      slot="reach-respond"
      description={
        state.status.kind === "ready" && state.remoteAllowRespond === null
          ? t("desktop.connection.reach.respond.unknown")
          : undefined
      }
      control={
        <Switch
          size={FORM_CONTROL_SIZE}
          aria-labelledby={labelId}
          checked={state.remoteAllowRespond === true}
          disabled={!canSetRemoteRespond(state)}
          onCheckedChange={props.handlers.setRemoteRespond}
        />
      }
    />
  );
}

// ── 방식별 패널 ─────────────────────────────────────────────────────────

interface PanelProps extends ReachViewProps {
  readonly status: RemoteStatus;
  readonly mode: ReachMode;
  readonly tailscale: TailscaleInfo | null;
  readonly onSelect: (mode: "service" | "service+remote") => void;
}

function addressesOf(props: PanelProps): readonly PanelAddress[] {
  const pairing = props.remote.state.pairing;
  const code = pairing.kind === "issued" ? pairing.code : null;
  const tailscale = props.tailscale;
  return panelAddressesOf({
    mode: props.mode,
    links: code?.links ?? [],
    urls: accessUrls(props.status),
    code: code?.code ?? null,
    serveUrl: serveIsOn(tailscale) && tailscale !== null ? tailscale.serve.url : null,
    domain: appliedDomainOf(props.setup, props.status),
  });
}

/** 웹 셸: 방식을 고르지 않고 닿는 주소를 모두 보인다 */
function webAddressesOf(
  props: ReachViewProps,
  status: RemoteStatus,
  tailscale: TailscaleInfo | null,
): readonly PanelAddress[] {
  const pairing = props.remote.state.pairing;
  const code = pairing.kind === "issued" ? pairing.code : null;
  return REACH_MODES.flatMap((mode) =>
    panelAddressesOf({
      mode,
      links: code?.links ?? [],
      urls: accessUrls(status),
      code: code?.code ?? null,
      serveUrl: serveIsOn(tailscale) && tailscale !== null ? tailscale.serve.url : null,
      domain: appliedDomainOf(props.setup, status),
    }),
  );
}

function ModePanel(props: PanelProps): ReactNode {
  const { remote, status } = props;
  const fingerprint =
    status.certSource === "self-signed" && status.fingerprint !== null
      ? fingerprintDisplay(status.fingerprint)
      : null;
  const serving = serveIsOn(props.tailscale);
  const pair = (
    <div data-slot="reach-pair">
      <PairPanel
        key={props.mode}
        addresses={addressesOf(props)}
        pairing={remote.state.pairing}
        nowMs={props.nowMs}
        busy={remote.state.busy !== "none"}
        fingerprint={
          props.mode === "wifi" || (props.mode === "tailscale" && !serving) ? fingerprint : null
        }
        onIssue={() => {
          run(remote.actions.issuePairing());
        }}
        copy={props.copy}
      />
    </div>
  );
  switch (props.mode) {
    case "wifi":
      return (
        <>
          <PreflightBlock {...props} />
          {pair}
          {status.certSource === "self-signed" ? (
            <div data-slot="reach-wifi-note">
              <RowNote tone="warning">{t("desktop.connection.reach.wifi.certNote")}</RowNote>
            </div>
          ) : null}
        </>
      );
    case "tailscale":
      return (
        <>
          <TailscaleBlock {...props} />
          {pair}
        </>
      );
    case "public":
      return (
        <>
          <PublicBlock {...props} />
          {pair}
        </>
      );
    default:
      return assertNever(props.mode, "ReachMode");
  }
}

/** 사전 점검 4줄. 실패 줄에 앱이 고칠 수 있으면 단추 하나 */
function PreflightBlock(props: PanelProps): ReactNode {
  const { setup, setupActions, remote } = props;
  const fix = (line: ReachLine): void => {
    switch (line.autoFix) {
      case "startService":
        run(
          remote.actions.selectMode("service", false).then(() => {
            props.handlers.refresh();
            setupActions.recheck();
            return undefined;
          }),
        );
        return;
      case "enableRemote":
        props.onSelect("service+remote");
        return;
      case "addHosts":
        setupActions.addAllowedHosts(line.missingHosts);
        return;
      case "autostart":
        run(remote.actions.requestAutostart(true));
        return;
      case null:
        return;
      default:
        assertNever(line.autoFix, "AutoFixKind");
    }
  };
  const steps: readonly CheckStep[] = reachLinesOf(setup.preflight).map((line) => ({
    id: line.id,
    label: t(LINE_LABEL[line.id]),
    state: line.state,
    detail: line.cause === null ? null : t(line.cause),
    fix: line.fix === null ? null : t(line.fix),
    action:
      line.autoFix === null
        ? null
        : {
            label: t(AUTO_FIX_LABEL[line.autoFix]),
            onAction: () => {
              fix(line);
            },
          },
  }));
  return (
    <div data-slot="reach-preflight" className="grid gap-2">
      <CheckSteps
        steps={steps}
        label={t("desktop.connection.reach.check.label")}
        onRetry={setupActions.recheck}
        disabled={remote.state.busy !== "none" || setup.hosts.busy}
      />
      {setup.preflight.kind === "failed" ? (
        <RowNote tone="danger">{t(remoteErrorTextOf(setup.preflight.error))}</RowNote>
      ) : null}
      {setup.hosts.restartNeeded ? (
        <RowNote tone="warning">{t("desktop.connection.reach.restartNeeded")}</RowNote>
      ) : null}
    </div>
  );
}

/** serve 켜기 확인의 본문: 실행할 명령 한 줄과 공개 인증서 기록 안내 */
export function ServeConfirmBody(props: {
  readonly command: string;
  readonly copy: (text: string) => void;
}): ReactNode {
  return (
    <div data-slot="reach-serve-body" className="grid gap-3">
      <p className="m-0 text-ui text-text-secondary">{t("desktop.connection.reach.serve.runs")}</p>
      <CommandLine text={props.command} onCopy={props.copy} />
      <RowNote tone="warning">{t("desktop.connection.reach.serve.publicLog")}</RowNote>
    </div>
  );
}

function TailscaleBlock(props: PanelProps): ReactNode {
  const { setup, setupActions, status } = props;
  const [confirm, setConfirm] = useState(false);
  const labelId = useId();
  if (setup.tailscale.kind === "idle" || setup.tailscale.kind === "loading") {
    return (
      <div data-slot="reach-tailscale-loading" role="status" className="grid gap-2">
        <span className="sr-only">{t("desktop.connection.reach.tailscale.loading")}</span>
        <Skeleton width="40%" height={14} />
        <Skeleton width="60%" height={14} />
      </div>
    );
  }
  if (setup.tailscale.kind === "failed") {
    return (
      <div data-slot="reach-tailscale-failed">
        <RowNote
          tone="danger"
          actions={
            <Button size="xs" variant="outline" onClick={setupActions.reloadTailscale}>
              {t("desktop.connection.reach.reload")}
            </Button>
          }
        >
          {t(remoteErrorTextOf(setup.tailscale.error))}
        </RowNote>
      </div>
    );
  }
  const info = setup.tailscale.value;
  const band = tailscaleBandOf(info);
  const action =
    band.action === "download" ? (
      <Button
        size={FORM_CONTROL_SIZE}
        variant="outline"
        onClick={() => {
          setupActions.openLink(TAILSCALE_DOWNLOAD_URL);
        }}
      >
        {t("desktop.connection.reach.tailscale.download")}
      </Button>
    ) : band.action === "login" && info.authUrl !== null ? (
      <Button
        size={FORM_CONTROL_SIZE}
        variant="outline"
        onClick={() => {
          if (info.authUrl !== null) setupActions.openLink(info.authUrl);
        }}
      >
        {t("desktop.connection.reach.tailscale.login")}
      </Button>
    ) : band.action === "reload" || band.action === "login" ? (
      <Button size={FORM_CONTROL_SIZE} variant="ghost" onClick={setupActions.reloadTailscale}>
        {t("desktop.connection.reach.reload")}
      </Button>
    ) : undefined;
  const serving = info.serve.kind === "on";
  const tlsPort = status.tlsPort;
  return (
    <>
      <StatusBand
        slot="reach-tailscale"
        state={info.state}
        tone={band.tone}
        title={band.name ?? t(band.title)}
        description={
          band.name === null
            ? band.description === null
              ? undefined
              : t(band.description)
            : t(band.title)
        }
        actions={action}
      />
      {info.state === "ready" ? (
        <SettingRow
          label={t("desktop.connection.reach.serve.label")}
          labelId={labelId}
          info={t("desktop.connection.reach.serve.info")}
          slot="reach-serve"
          description={
            info.serve.kind === "other"
              ? t("desktop.connection.reach.serve.other")
              : tlsPort === null
                ? t("desktop.connection.reach.serve.noPort")
                : undefined
          }
          control={
            <Switch
              size={FORM_CONTROL_SIZE}
              aria-labelledby={labelId}
              checked={serving}
              disabled={
                setup.serveBusy ||
                tlsPort === null ||
                info.serve.kind === "other" ||
                info.serve.kind === "unavailable"
              }
              onCheckedChange={(next) => {
                if (next) setConfirm(true);
                else setupActions.setServe(false);
              }}
            />
          }
          notes={
            info.failure === null ? null : (
              <RowNote
                tone={info.failure === "https_not_enabled" ? "warning" : "danger"}
                actions={
                  info.consentUrl === null ? undefined : (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        if (info.consentUrl !== null) setupActions.openLink(info.consentUrl);
                      }}
                    >
                      {t("desktop.connection.reach.serve.openConsent")}
                    </Button>
                  )
                }
              >
                {t(serveFailureTextOf(info.failure))}
              </RowNote>
            )
          }
        />
      ) : null}
      <Dialog
        kind="alert"
        size="sm"
        inline={props.inline === true && confirm}
        open={confirm}
        onOpenChange={(next) => {
          if (!next) setConfirm(false);
        }}
        title={t("desktop.connection.reach.serve.confirmTitle")}
        footer={
          <>
            <Button
              variant="outline"
              size={FORM_CONTROL_SIZE}
              onClick={() => {
                setConfirm(false);
              }}
            >
              {t("desktop.connection.reach.cancel")}
            </Button>
            <Button
              variant="solid"
              size={FORM_CONTROL_SIZE}
              onClick={() => {
                setConfirm(false);
                setupActions.setServe(true);
              }}
            >
              {t("desktop.connection.reach.serve.confirm")}
            </Button>
          </>
        }
      >
        <ServeConfirmBody command={serveCommandOf(tlsPort ?? 0)} copy={props.copy} />
      </Dialog>
    </>
  );
}

function PublicBlock(props: PanelProps): ReactNode {
  const { setup, setupActions, status } = props;
  const applied = appliedDomainOf(setup, status);
  const [draft, setDraft] = useState(applied ?? "");
  const [touched, setTouched] = useState(false);
  const issue = domainIssueOf(draft);
  const applying = setup.domain.kind === "applying";
  const ensureProxy = setupActions.ensureProxy;
  useEffect(() => {
    ensureProxy();
  }, [ensureProxy]);
  const labelId = useId();
  const domainNotes = (
    <>
      {touched && issue !== null ? (
        <RowNote tone="danger">{t(DOMAIN_ISSUE_TEXT[issue])}</RowNote>
      ) : null}
      {status.tlsPort === null ? (
        <RowNote tone="warning">{t("desktop.connection.reach.domain.noPort")}</RowNote>
      ) : null}
      {setup.domain.kind === "invalid"
        ? setup.domain.codes.map((code) => (
            <RowNote key={code} tone="danger">
              {t(configIssueTextOf(code))}
            </RowNote>
          ))
        : null}
      {setup.domain.kind === "failed" ? (
        <RowNote tone="danger">{t(remoteErrorTextOf(setup.domain.error))}</RowNote>
      ) : null}
      {setup.domain.kind === "applied" && setup.domain.restartNeeded ? (
        <RowNote tone="warning">{t("desktop.connection.reach.restartNeeded")}</RowNote>
      ) : null}
    </>
  );
  return (
    <>
      <SettingRow
        layout="stacked"
        label={t("desktop.connection.reach.domain.label")}
        labelId={labelId}
        info={t("desktop.connection.reach.domain.info")}
        slot="reach-domain"
        description={
          setup.domain.kind === "applied"
            ? t("desktop.connection.reach.domain.applied", { domain: setup.domain.domain })
            : undefined
        }
        control={
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setTouched(true);
              if (issue === null) setupActions.applyDomain(draft);
            }}
          >
            <Input
              size={FORM_CONTROL_SIZE}
              containerClassName={FIELD_WIDTH.full}
              aria-labelledby={labelId}
              placeholder="fresnel.example.com"
              value={draft}
              invalid={touched && issue !== null}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
            />
            <Button
              type="submit"
              size={FORM_CONTROL_SIZE}
              variant="outline"
              loading={applying}
              disabled={applying || status.tlsPort === null}
            >
              {t("desktop.connection.reach.domain.apply")}
            </Button>
          </form>
        }
        notes={domainNotes}
      />
      <SettingRow
        layout="stacked"
        label={t("desktop.connection.reach.proxy.label")}
        slot="reach-proxy"
        description={applied === null ? t("desktop.connection.reach.proxy.needDomain") : undefined}
        control={
          applied === null ? undefined : (
            <div className="grid min-w-0 gap-2">
              <div>
                <SegmentedControl
                  size={FORM_CONTROL_SIZE}
                  aria-label={t("desktop.connection.reach.proxy.label")}
                  value={setup.proxyKind}
                  onValueChange={(next) => {
                    const found = PROXY_KINDS.find((kind) => kind === next);
                    if (found !== undefined) setupActions.setProxyKind(found);
                  }}
                >
                  <SegmentedControlItem value="caddy">
                    {t("desktop.connection.reach.proxy.caddy")}
                  </SegmentedControlItem>
                  <SegmentedControlItem value="nginx">
                    {t("desktop.connection.reach.proxy.nginx")}
                  </SegmentedControlItem>
                </SegmentedControl>
              </div>
              {setup.proxy.kind === "ready" ? (
                <CodeBlock
                  text={setup.proxy.value.text}
                  onCopy={props.copy}
                  slot="reach-proxy-code"
                />
              ) : setup.proxy.kind === "failed" ? (
                <RowNote tone="danger">{t(remoteErrorTextOf(setup.proxy.error))}</RowNote>
              ) : (
                <Skeleton width="100%" height={96} />
              )}
              <p className="m-0 text-ui text-text-tertiary">
                {t("desktop.connection.reach.proxy.hint")}
              </p>
            </div>
          )
        }
      />
      <div data-slot="reach-public-check" className="grid justify-items-start gap-3">
        <Button
          size={FORM_CONTROL_SIZE}
          variant="outline"
          disabled={setup.preflight.kind === "loading"}
          onClick={setupActions.recheck}
        >
          {t("desktop.connection.reach.public.check")}
        </Button>
        {setup.preflight.kind === "idle" ? null : (
          <div className="w-full">
            <PreflightLines {...props} />
          </div>
        )}
      </div>
    </>
  );
}

/** 공개 서버의 점검 결과(머리 없이 줄만) */
function PreflightLines(props: PanelProps): ReactNode {
  const steps: readonly CheckStep[] = reachLinesOf(props.setup.preflight).map((line) => ({
    id: line.id,
    label: t(LINE_LABEL[line.id]),
    state: line.state,
    detail: line.cause === null ? null : t(line.cause),
    fix: line.fix === null ? null : t(line.fix),
  }));
  return <CheckSteps steps={steps} label={t("desktop.connection.reach.check.label")} />;
}
