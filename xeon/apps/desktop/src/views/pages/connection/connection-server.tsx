import { t, type Locale } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  Alert,
  Button,
  Dialog,
  ListDescription,
  ListDescriptionRow,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Switch,
} from "@caustic/react";
import { useState, type ReactNode } from "react";
import type { RemoteActions } from "../../../app/remote/use-remote-controller.ts";
import {
  accessUrls,
  deviceRowOf,
  fingerprintDisplay,
  isPairingExpired,
  pairingCodeDisplay,
  pairingRemainingLabel,
  pairingRemainingMs,
  pushShownAvailable,
  serverModeOf,
  sortDevices,
  type DeviceRow,
  type ServerMode,
} from "../../../app/remote/remote-model.ts";
import type {
  Loadable,
  PairingState,
  RemoteNotice,
  RemoteScreenState,
} from "../../../app/remote/remote-state.ts";
import type {
  CertSource,
  PairingCode,
  RemoteDevice,
  RemoteError,
  RemoteState,
  RemoteStatus,
  RevokeTarget,
} from "../../../app/remote/remote-types.ts";
import type { ServiceAutostart } from "../../../transport/ipc.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import { StatusBadge, type StatusTone } from "./connection-badge.tsx";

// 서버 모드 섹션(P-08)의 그림. 상태와 동작은 `RemoteScreenState`와 `RemoteActions`로 받고, 시계와 클립보드도 props로 받는다.
// 위에서부터 쓰는 방식(끄기·서비스·외부 접근), 로그인할 때 자동으로 켜기 스위치, 상태 줄, 쓰기 실패 알림, 외부 접근 켜기 확인,
// 로그인 자동 시작 켜기 확인, 페어링 코드, 연결된 기기 순이다.
// 경고는 늘 보이는 글이고, 설명은 정보 아이콘 뒤에 둔다. 기기 해제 확인만 이 파일이 지금 고른 기기를 지역 상태로 든다.

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 쓰는 방식의 순서. 라디오 묶음이 이 순서로 그린다 */
const MODES: readonly ServerMode[] = ["off", "service", "service+remote"];

/** 지문을 쌍 여덟 개씩 한 줄로 나눈다. 줄을 이으면 원래 문자열이 되도록 끝 줄을 뺀 줄은 콜론으로 끝난다 */
function fingerprintLines(display: string): readonly string[] {
  const pairs = display.split(":");
  const lines: string[] = [];
  for (let start = 0; start < pairs.length; start += 8) {
    const line = pairs.slice(start, start + 8).join(":");
    lines.push(start + 8 < pairs.length ? `${line}:` : line);
  }
  return lines;
}

export interface ServerModeSectionProps {
  readonly state: RemoteScreenState;
  /** 이 기기 서비스가 도는가. 연결 화면의 서비스 카드와 같은 값이다 */
  readonly serviceRunning: boolean;
  /** 지금 시각(밀리초). 페어링 남은 시간과 마지막 연결 표시가 쓴다. 부르는 쪽이 넘긴다 */
  readonly nowMs: number;
  readonly locale: Locale;
  readonly actions: RemoteActions;
  /** 글을 클립보드에 쓴다 */
  readonly copy: (text: string) => void;
  /** 대화 상자를 제자리에 그린다(시험용). 기본은 포털이다 */
  readonly inline?: boolean;
}

/** 화면이 부르는 동작은 값을 돌려주지 않는다. 실패는 컨트롤러가 알림으로 남기므로 여기서는 기다리지 않는다 */
function run(work: Promise<void>): void {
  detach(work, rethrow);
}

export function ServerModeSection(props: ServerModeSectionProps): ReactNode {
  const { state, serviceRunning, nowMs, locale, actions, copy, inline = false } = props;
  const status = state.status.kind === "ready" ? state.status.value : null;
  const busy = state.busy !== "none";
  const running = status !== null && status.state === "running";
  return (
    <div className="grid content-start gap-4">
      <ModeChoice
        mode={serverModeOf(status, serviceRunning)}
        busy={busy}
        serviceRunning={serviceRunning}
        actions={actions}
      />
      <AutostartRow
        autostart={state.autostart}
        linger={state.autostartLinger}
        busy={busy}
        actions={actions}
      />
      <StatusBlock status={state.status} busy={busy} actions={actions} copy={copy} />
      {state.notice === null ? null : (
        <Alert tone="danger" size="sm">
          {noticeTextOf(state.notice)}
        </Alert>
      )}
      <EnableDialog
        open={state.confirmOpen}
        status={status}
        busy={state.busy === "enabling"}
        inline={inline}
        actions={actions}
      />
      <AutostartDialog open={state.autostartConfirmOpen} inline={inline} actions={actions} />
      {running ? (
        <PairingBlock
          pairing={state.pairing}
          nowMs={nowMs}
          busy={busy}
          actions={actions}
          copy={copy}
        />
      ) : null}
      {running ? (
        <DevicesBlock
          devices={state.devices}
          nowMs={nowMs}
          locale={locale}
          busy={busy}
          actions={actions}
          inline={inline}
        />
      ) : null}
    </div>
  );
}

// ── 쓰는 방식 ────────────────────────────────────────────────────────────

/** 라디오 값을 서버 모드로 바꾼다. 모르는 값이면 null이다 */
function modeOfValue(value: string): ServerMode | null {
  return MODES.find((mode) => mode === value) ?? null;
}

function modeLabelOf(mode: ServerMode): string {
  switch (mode) {
    case "off":
      return t("desktop.connection.server.mode.off");
    case "service":
      return t("desktop.connection.server.mode.service");
    case "service+remote":
      return t("desktop.connection.server.mode.remote");
    default:
      return assertNever(mode, "ServerMode");
  }
}

function ModeChoice(props: {
  readonly mode: ServerMode;
  readonly busy: boolean;
  readonly serviceRunning: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { mode, busy, serviceRunning, actions } = props;
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-ui-sm font-medium text-text-primary">
          {t("desktop.connection.server.mode.heading")}
        </span>
        <InfoTip text={t("desktop.connection.server.mode.hint")} />
      </div>
      <RadioGroup
        aria-label={t("desktop.connection.server.heading")}
        size="sm"
        value={mode}
        disabled={busy}
        className="gap-0.5"
        onValueChange={(value) => {
          const next = modeOfValue(value);
          if (next !== null) run(actions.selectMode(next, serviceRunning));
        }}
      >
        {MODES.map((item) => (
          <RadioGroupItem key={item} value={item}>
            <span className="text-ui-sm text-text-primary">{modeLabelOf(item)}</span>
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}

// ── 로그인 자동 시작 ─────────────────────────────────────────────────────

/**
 * 로그인할 때 자동으로 켜기 스위치. 상태를 못 읽으면 다시 읽기 알림을, 읽는 중이면 자리 표시를 보인다.
 * 이 기기가 지원하지 않으면 스위치를 잠그고 그 글을 보인다. Linux linger 안내는 켠 뒤 한 번 보인다.
 */
function AutostartRow(props: {
  readonly autostart: Loadable<ServiceAutostart>;
  readonly linger: boolean;
  readonly busy: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { autostart, linger, busy, actions } = props;
  switch (autostart.kind) {
    case "loading":
      return <Skeleton width="50%" height={14} />;
    case "failed":
      return (
        <Alert
          tone="danger"
          size="sm"
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => {
                run(actions.reloadAutostart());
              }}
            >
              {t("desktop.connection.retry")}
            </Button>
          }
        >
          {t("desktop.connection.server.autostart.loadFailed")}
        </Alert>
      );
    case "ready":
      return (
        <AutostartSwitch value={autostart.value} linger={linger} busy={busy} actions={actions} />
      );
    default:
      return assertNever(autostart, "Loadable");
  }
}

function AutostartSwitch(props: {
  readonly value: ServiceAutostart;
  readonly linger: boolean;
  readonly busy: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { value, linger, busy, actions } = props;
  const label = t("desktop.connection.server.autostart.label");
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5">
          <span className="text-ui-sm font-medium text-text-primary">{label}</span>
          <InfoTip text={t("desktop.connection.server.autostart.hint")} />
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
        <span className="text-ui-sm text-text-tertiary">
          {t("desktop.connection.server.autostart.unsupported")}
        </span>
      )}
      {linger ? (
        <div className="grid gap-1 text-ui-sm text-text-secondary">
          <span>{t("desktop.connection.server.autostart.linger")}</span>
          <code className="font-mono text-text-primary">loginctl enable-linger</code>
        </div>
      ) : null}
    </div>
  );
}

/** 로그인 자동 시작 켜기 확인. 파일을 어디에 쓰는지와 끄면 지운다는 것을 글로 보인다. 확인을 누르면 동작이 돈다 */
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
      title={t("desktop.connection.server.autostart.confirm.title")}
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
            {t("desktop.connection.server.autostart.confirm.enable")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui-sm text-text-secondary">
        {t("desktop.connection.server.autostart.confirm.body")}
      </p>
    </Dialog>
  );
}

// ── 상태 ──────────────────────────────────────────────────────────────────

function stateLabelOf(state: RemoteState): string {
  switch (state) {
    case "off":
      return t("desktop.connection.server.state.off");
    case "starting":
      return t("desktop.connection.server.state.starting");
    case "running":
      return t("desktop.connection.server.state.running");
    case "failed":
      return t("desktop.connection.server.state.failed");
    default:
      return assertNever(state, "RemoteState");
  }
}

function stateToneOf(state: RemoteState): StatusTone {
  switch (state) {
    case "off":
      return "neutral";
    case "starting":
      return "info";
    case "running":
      return "success";
    case "failed":
      return "danger";
    default:
      return assertNever(state, "RemoteState");
  }
}

function certSourceTextOf(source: CertSource | null): string {
  switch (source) {
    case "self-signed":
      return t("desktop.connection.server.cert.selfSigned");
    case "user":
      return t("desktop.connection.server.cert.user");
    case null:
      return t("desktop.connection.server.notYet");
    default:
      return assertNever(source, "CertSource");
  }
}

function noticeTextOf(notice: RemoteNotice): string {
  switch (notice.kind) {
    case "enableFailed":
      return t("desktop.connection.server.notice.enableFailed");
    case "disableFailed":
      return t("desktop.connection.server.notice.disableFailed");
    case "serviceFailed":
      return t("desktop.connection.server.notice.serviceFailed");
    case "revokeFailed":
      return t("desktop.connection.server.notice.revokeFailed");
    case "autostartFailed":
      // 글에는 셸이 준 닫힌 오류 코드만 든다(경로와 토큰은 없다)
      return t("desktop.connection.server.notice.autostartFailed", {
        code: notice.code ?? "unknown",
      });
    default:
      return assertNever(notice.kind, "RemoteNoticeKind");
  }
}

/** 엔진이 외부 접근을 모른다는 뜻인가. 옛 서비스는 `host.remote.*`가 없어 `unsupported`로 온다(엔진 오프라인·시간 초과와 다르다) */
function isUnsupported(error: RemoteError): boolean {
  return error.kind === "unsupported";
}

function StatusBlock(props: {
  readonly status: Loadable<RemoteStatus>;
  readonly busy: boolean;
  readonly actions: RemoteActions;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { status, busy, actions, copy } = props;
  switch (status.kind) {
    case "loading":
      return <StatusSkeleton />;
    case "failed":
      return <StatusFailure error={status.error} busy={busy} actions={actions} />;
    case "ready":
      return <StatusRows status={status.value} busy={busy} actions={actions} copy={copy} />;
    default:
      return assertNever(status, "Loadable");
  }
}

function StatusSkeleton(): ReactNode {
  return (
    <div role="status" className="grid content-start gap-3">
      <span className="sr-only">{t("desktop.connection.server.status.loading")}</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex gap-6">
          <Skeleton width="30%" height={12} />
          <Skeleton width={`${30 + ((i * 13) % 35)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

/** 상태를 못 읽은 자리. 지원 안 함은 차분한 글로, 그 밖의 실패는 위험 글로 보인다. 다시 시도는 두 경우 모두 있다 */
function StatusFailure(props: {
  readonly error: RemoteError;
  readonly busy: boolean;
  readonly actions: RemoteActions;
}): ReactNode {
  const { error, busy, actions } = props;
  const retry = (
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      onClick={() => {
        run(actions.reloadStatus());
      }}
    >
      {t("desktop.connection.retry")}
    </Button>
  );
  if (isUnsupported(error)) {
    return (
      <Alert tone="neutral" size="sm" action={retry}>
        {t("desktop.connection.server.status.unsupported")}
      </Alert>
    );
  }
  return (
    <Alert tone="danger" size="sm" action={retry}>
      {t("desktop.connection.server.status.loadFailed")}
    </Alert>
  );
}

function StatusRows(props: {
  readonly status: RemoteStatus;
  readonly busy: boolean;
  readonly actions: RemoteActions;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { status, busy, actions, copy } = props;
  const urls = accessUrls(status);
  const fingerprint = status.fingerprint === null ? null : fingerprintDisplay(status.fingerprint);
  return (
    <div className="grid gap-3">
      {status.error === null ? null : (
        <Alert
          tone="danger"
          size="sm"
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => {
                run(actions.retryEnable());
              }}
            >
              {t("desktop.connection.retry")}
            </Button>
          }
        >
          {status.error.message}
        </Alert>
      )}
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.connection.server.heading")}
        className={ROWS_CLASS}
      >
        <ListDescriptionRow term={t("desktop.connection.server.row.state")}>
          <StatusBadge tone={stateToneOf(status.state)}>{stateLabelOf(status.state)}</StatusBadge>
        </ListDescriptionRow>
        {urls.length === 0 ? null : (
          <ListDescriptionRow term={t("desktop.connection.server.row.urls")}>
            <span className="grid min-w-0 gap-1">
              {urls.map((url) => (
                <span key={url} className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 break-all font-mono">{url}</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      copy(url);
                    }}
                  >
                    {t("desktop.connection.server.copy")}
                  </Button>
                </span>
              ))}
            </span>
          </ListDescriptionRow>
        )}
        <ListDescriptionRow term={t("desktop.connection.server.row.fingerprint")}>
          {fingerprint === null ? (
            <span>{t("desktop.connection.server.notYet")}</span>
          ) : (
            <span className="grid min-w-0 justify-items-start gap-1">
              <span className="grid font-mono">
                {fingerprintLines(fingerprint).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  copy(fingerprint);
                }}
              >
                {t("desktop.connection.server.copy")}
              </Button>
            </span>
          )}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.connection.server.row.certSource")}>
          {certSourceTextOf(status.certSource)}
        </ListDescriptionRow>
        <ListDescriptionRow term={t("desktop.connection.server.row.push")}>
          {pushShownAvailable(status) ? (
            t("desktop.connection.server.push.available")
          ) : (
            <span className="inline-flex items-center gap-1.5">
              {t("desktop.connection.server.push.unavailable")}
              <InfoTip text={t("desktop.connection.server.push.hint")} />
            </span>
          )}
        </ListDescriptionRow>
      </ListDescription>
    </div>
  );
}

// ── 외부 접근 켜기 확인 ──────────────────────────────────────────────────

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
      <div className="grid gap-3">
        <p className="m-0 text-ui-sm text-text-secondary">
          {t("desktop.connection.server.confirm.opens")}
        </p>
        {urls.length === 0 ? (
          <p className="m-0 text-ui-sm text-text-secondary">
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
        <Alert tone="warning" size="sm">
          {t("desktop.connection.server.confirm.warning")}
        </Alert>
        <p className="m-0 text-ui-sm text-text-secondary">
          {fingerprint === null
            ? t("desktop.connection.server.confirm.noFingerprint")
            : t("desktop.connection.server.confirm.fingerprint", { fingerprint })}
        </p>
      </div>
    </Dialog>
  );
}

// ── 페어링 코드 ──────────────────────────────────────────────────────────

function PairingBlock(props: {
  readonly pairing: PairingState;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly actions: RemoteActions;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { pairing, nowMs, busy, actions, copy } = props;
  const issue = (): void => {
    run(actions.issuePairing());
  };
  switch (pairing.kind) {
    case "none":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="soft" disabled={busy} onClick={issue}>
            {t("desktop.connection.server.pairing.create")}
          </Button>
          <InfoTip text={t("desktop.connection.server.pairing.hint")} />
        </div>
      );
    case "issuing":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="soft" loading disabled>
            {t("desktop.connection.server.pairing.creating")}
          </Button>
        </div>
      );
    case "issued":
      return (
        <IssuedCode code={pairing.code} nowMs={nowMs} busy={busy} onIssue={issue} copy={copy} />
      );
    case "failed":
      return (
        <div className="grid gap-2">
          <Alert tone={pairing.error.kind === "remote-off" ? "warning" : "danger"} size="sm">
            {pairing.error.kind === "remote-off"
              ? t("desktop.connection.server.pairing.remoteOff")
              : t("desktop.connection.server.pairing.failed")}
          </Alert>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="soft" disabled={busy} onClick={issue}>
              {t("desktop.connection.server.pairing.create")}
            </Button>
          </div>
        </div>
      );
    default:
      return assertNever(pairing, "PairingState");
  }
}

/** 발급된 페어링 코드. 남은 시간을 보이고, 만료하면 "만료됨"과 다시 발급을 보인다 */
function IssuedCode(props: {
  readonly code: PairingCode;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly onIssue: () => void;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { code, nowMs, busy, onIssue, copy } = props;
  const expired = isPairingExpired(code, nowMs);
  const remaining = pairingRemainingLabel(pairingRemainingMs(code, nowMs));
  return (
    <div className="grid content-start gap-2">
      <span className="text-ui-sm text-text-secondary">
        {t("desktop.connection.server.pairing.label")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`font-mono text-title-2 ${expired ? "text-text-tertiary" : "text-text-primary"}`}
        >
          {pairingCodeDisplay(code.code)}
        </span>
        {expired ? (
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.connection.server.pairing.expired")}
          </span>
        ) : (
          <>
            <span className="text-ui-sm text-text-secondary">
              {t("desktop.connection.server.pairing.remaining", { time: remaining })}
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                copy(code.code);
              }}
            >
              {t("desktop.connection.server.copy")}
            </Button>
          </>
        )}
      </div>
      {expired ? (
        <div>
          <Button size="sm" variant="soft" disabled={busy} onClick={onIssue}>
            {t("desktop.connection.server.pairing.reissue")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── 연결된 기기 ──────────────────────────────────────────────────────────

/** 지금 고른 해제 대상. 기기 하나거나 전부다 */
type PendingRevoke =
  | { readonly kind: "one"; readonly id: string; readonly name: string }
  | { readonly kind: "all"; readonly count: number };

/** 방금 연결한 것은 "방금", 그 밖은 로케일의 상대 시각이다 */
function agoTextOf(elapsedMs: number, locale: Locale): string {
  const format = new Intl.RelativeTimeFormat(locale);
  if (elapsedMs < HOUR_MS) return format.format(-Math.floor(elapsedMs / MINUTE_MS), "minute");
  if (elapsedMs < DAY_MS) return format.format(-Math.floor(elapsedMs / HOUR_MS), "hour");
  return format.format(-Math.floor(elapsedMs / DAY_MS), "day");
}

function lastSeenTextOf(row: DeviceRow, nowMs: number, locale: Locale): string {
  if (row.lastSeenKind === "now") return t("desktop.connection.server.devices.justNow");
  if (row.lastSeenKind === "never" || row.lastSeenAt === null) {
    return t("desktop.connection.server.devices.never");
  }
  return agoTextOf(nowMs - row.lastSeenAt, locale);
}

function DevicesBlock(props: {
  readonly devices: Loadable<readonly RemoteDevice[]>;
  readonly nowMs: number;
  readonly locale: Locale;
  readonly busy: boolean;
  readonly actions: RemoteActions;
  readonly inline: boolean;
}): ReactNode {
  const { devices, nowMs, locale, busy, actions, inline } = props;
  const [pending, setPending] = useState<PendingRevoke | null>(null);
  const ready = devices.kind === "ready" ? devices.value : null;
  return (
    <div className="grid content-start gap-2">
      <div className="flex min-h-7 items-center gap-1.5">
        <h3 className="m-0 flex-1 text-ui-sm font-medium text-text-primary">
          {t("desktop.connection.server.devices.heading")}
        </h3>
        {ready !== null && ready.length > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            className="text-danger-text"
            disabled={busy}
            onClick={() => {
              setPending({ kind: "all", count: ready.length });
            }}
          >
            {t("desktop.connection.server.devices.revokeAll")}
          </Button>
        ) : null}
      </div>
      <Alert tone="warning" size="sm">
        {t("desktop.connection.server.devices.warning")}
      </Alert>
      {devices.kind === "loading" ? <DevicesSkeleton /> : null}
      {devices.kind === "failed" ? (
        <Alert
          tone="danger"
          size="sm"
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => {
                run(actions.reloadDevices());
              }}
            >
              {t("desktop.connection.retry")}
            </Button>
          }
        >
          {t("desktop.connection.server.devices.loadFailed")}
        </Alert>
      ) : null}
      {ready !== null && ready.length === 0 ? (
        <p className="m-0 text-ui-sm text-text-tertiary">
          {t("desktop.connection.server.devices.empty")}
        </p>
      ) : null}
      {ready === null || ready.length === 0 ? null : (
        <ul className="m-0 grid list-none gap-1 p-0">
          {sortDevices(ready).map((device) => {
            const row = deviceRowOf(device, nowMs);
            const kindText =
              row.kind === "web"
                ? t("desktop.connection.server.devices.kindWeb")
                : t("desktop.connection.server.devices.kindDesktop");
            return (
              <li key={row.id} className="flex items-start justify-between gap-3 py-2">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-ui-sm font-medium text-text-primary">
                    {row.name}
                  </span>
                  <span className="text-ui-sm text-text-tertiary">
                    {`${kindText} · ${lastSeenTextOf(row, nowMs, locale)}`}
                  </span>
                  <span className="truncate font-mono text-ui-sm text-text-tertiary">
                    {row.address ?? t("desktop.connection.server.devices.noAddress")}
                  </span>
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-danger-text"
                  disabled={busy}
                  onClick={() => {
                    setPending({ kind: "one", id: row.id, name: row.name });
                  }}
                >
                  {t("desktop.connection.server.devices.revoke")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {pending === null ? null : (
        <RevokeDialog
          pending={pending}
          inline={inline}
          onCancel={() => {
            setPending(null);
          }}
          onConfirm={(target) => {
            setPending(null);
            run(actions.revoke(target));
          }}
        />
      )}
    </div>
  );
}

function DevicesSkeleton(): ReactNode {
  return (
    <div role="status" className="grid content-start gap-3">
      <span className="sr-only">{t("desktop.connection.server.devices.loading")}</span>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} width={`${50 + ((i * 17) % 30)}%`} height={14} />
      ))}
    </div>
  );
}

/** 기기 해제 확인. 기기 하나나 전부를 가리킨다. 확인을 누르면 그 대상으로 `revoke`를 부른다 */
function RevokeDialog(props: {
  readonly pending: PendingRevoke;
  readonly inline: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (target: RevokeTarget) => void;
}): ReactNode {
  const { pending, inline, onCancel, onConfirm } = props;
  const target: RevokeTarget = pending.kind === "one" ? { id: pending.id } : { all: true };
  const title =
    pending.kind === "one"
      ? t("desktop.connection.server.revokeOne.title")
      : t("desktop.connection.server.revokeAll.title");
  const body =
    pending.kind === "one"
      ? t("desktop.connection.server.revokeOne.body", { name: pending.name })
      : t("desktop.connection.server.revokeAll.body", { count: pending.count });
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("desktop.connection.server.cancel")}
          </Button>
          <Button
            variant="solid"
            size="sm"
            onClick={() => {
              onConfirm(target);
            }}
          >
            {t("desktop.connection.server.devices.revoke")}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui-sm text-text-secondary">{body}</p>
    </Dialog>
  );
}
