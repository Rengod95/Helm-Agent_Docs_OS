import { t, type Locale } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  Alert,
  Button,
  Dialog,
  ListDescription,
  ListDescriptionRow,
  Skeleton,
  Switch,
} from "@caustic/react";
import { useId, useState, type ReactNode } from "react";
import type { RemoteActions } from "../../../app/remote/use-remote-controller.ts";
import {
  deviceRowOf,
  fingerprintDisplay,
  isPairingExpired,
  pairingCodeDisplay,
  pairingRemainingLabel,
  pairingRemainingMs,
  pushShownAvailable,
  accessUrls,
  sortDevices,
  type DeviceRow,
} from "../../../app/remote/remote-model.ts";
import type {
  Loadable,
  PairingState,
  RemoteScreenState,
} from "../../../app/remote/remote-state.ts";
import type {
  CertSource,
  PairingCode,
  RemoteDevice,
  RemoteState,
  RemoteStatus,
  RevokeTarget,
} from "../../../app/remote/remote-types.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import { canSetRemoteRespond, type ConnectionState } from "./connection-model.ts";
import { StatusBadge, type StatusTone } from "./connection-badge.tsx";
import { ConnectionSection } from "./connection-status.tsx";

// "다른 기기 접속" 섹션. 외부 접근이 켜졌을 때만 그린다(실행 방식 섹션이 고른다). 위에서부터 상태 키-값 줄(상태, 접속 주소, 인증서 지문,
// 인증서, 웹 알림), 연결 코드, 연결된 기기, 승인에 답하기 설정 순이다. 상태와 동작은 컨트롤러와 화면 상태로 받는다.
// 설명은 정보 아이콘 뒤에 두고, 경고와 실패는 늘 보이는 글이다.

const ROWS_CLASS =
  "rounded-none [--cs-size-list-term:8rem] [&_[data-slot=list-description-row]]:px-0";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 지문 미리보기에 보이는 조각(두 글자씩)의 수. 여덟 조각이 지문 줄의 첫 줄이다. 나머지는 펼쳐야 보인다 */
const FINGERPRINT_PREVIEW_PARTS = 8;

/**
 * 지문을 조각 여덟 개씩 한 줄로 나눈다. 줄을 이으면 원래 문자열이 되도록 끝 줄을 뺀 줄은 콜론으로 끝난다.
 * 키는 그 줄이 시작하는 조각의 위치로 준다(줄마다 다르다).
 */
function fingerprintLines(
  display: string,
): readonly { readonly at: number; readonly text: string }[] {
  const parts = display.split(":");
  const lines: { readonly at: number; readonly text: string }[] = [];
  for (let start = 0; start < parts.length; start += 8) {
    const line = parts.slice(start, start + 8).join(":");
    lines.push({ at: start, text: start + 8 < parts.length ? `${line}:` : line });
  }
  return lines;
}

/** 화면이 부르는 동작은 값을 돌려주지 않는다. 실패는 컨트롤러가 알림으로 남기므로 여기서는 기다리지 않는다 */
function run(work: Promise<void>): void {
  detach(work, rethrow);
}

export interface RemoteAccessProps {
  /** 외부 접근 상태. 섹션은 `ready`일 때만 그린다 */
  readonly status: RemoteStatus;
  /** 화면 상태. 승인에 답하기 설정 값과 잠금을 읽는다 */
  readonly state: ConnectionState;
  readonly remote: RemoteScreenState;
  readonly actions: RemoteActions;
  /** 지금 시각(밀리초). 페어링 남은 시간과 기기 마지막 연결 표시가 쓴다. 부르는 쪽이 넘긴다 */
  readonly nowMs: number;
  readonly locale: Locale;
  /** 글을 클립보드에 쓴다 */
  readonly copy: (text: string) => void;
  readonly setRemoteRespond: (enabled: boolean) => void;
  /** 대화 상자를 제자리에 그린다(시험용). 기본은 포털이다 */
  readonly inline?: boolean;
}

export function RemoteAccessSection(props: RemoteAccessProps): ReactNode {
  const { status, state, remote, actions, nowMs, locale, copy, setRemoteRespond, inline } = props;
  const busy = remote.busy !== "none";
  const running = status.state === "running";
  const revokeFailed = remote.notice !== null && remote.notice.kind === "revokeFailed";
  return (
    <ConnectionSection title={t("desktop.connection.server.heading")}>
      <div className="grid content-start gap-4">
        <StatusRows status={status} busy={busy} actions={actions} copy={copy} />
        {running ? (
          <PairingBlock
            pairing={remote.pairing}
            nowMs={nowMs}
            busy={busy}
            actions={actions}
            copy={copy}
          />
        ) : null}
        {running ? (
          <DevicesBlock
            devices={remote.devices}
            nowMs={nowMs}
            locale={locale}
            busy={busy}
            revokeFailed={revokeFailed}
            actions={actions}
            inline={inline ?? false}
          />
        ) : null}
        <RespondRow state={state} setRemoteRespond={setRemoteRespond} />
      </div>
    </ConnectionSection>
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

/** 키-값 상태 줄과 상태 오류. 접속 주소마다 복사 단추가 있고, 지문은 앞부분만 보이며 펼치거나 복사한다 */
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
    <div className="grid gap-4">
      {status.error === null ? null : (
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
                      run(actions.retryEnable());
                    },
                    primary: true,
                  },
                ]
          }
        >
          {status.error.message}
        </Alert>
      )}
      <ListDescription
        variant="ghost"
        size="sm"
        aria-label={t("desktop.connection.server.heading")}
        className={`${ROWS_CLASS} text-ui`}
      >
        <ListDescriptionRow term={t("desktop.connection.server.row.state")}>
          <StatusBadge tone={stateToneOf(status.state)}>{stateLabelOf(status.state)}</StatusBadge>
        </ListDescriptionRow>
        {urls.length === 0 ? null : (
          <ListDescriptionRow term={t("desktop.connection.server.row.urls")}>
            <span className="grid min-w-0 gap-1">
              {urls.map((url) => (
                <span key={url} className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 break-all font-mono text-ui-sm">{url}</span>
                  <Button
                    size="sm"
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
            <FingerprintValue display={fingerprint} copy={copy} />
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

/** 인증서 지문. 앞부분만 보이고, 펼치면 전체를 여덟 쌍씩 두 줄로 보인다. 복사는 펼쳤는지와 무관하게 전체를 쓴다 */
function FingerprintValue(props: {
  readonly display: string;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { display, copy } = props;
  const [expanded, setExpanded] = useState(false);
  const preview = `${display.split(":").slice(0, FINGERPRINT_PREVIEW_PARTS).join(":")}…`;
  return (
    <span className="grid min-w-0 justify-items-start gap-1">
      <span className="grid font-mono text-ui-sm break-all">
        {expanded
          ? fingerprintLines(display).map((line) => <span key={line.at}>{line.text}</span>)
          : preview}
      </span>
      <span className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setExpanded((open) => !open);
          }}
        >
          {expanded
            ? t("desktop.connection.server.fingerprint.collapse")
            : t("desktop.connection.server.fingerprint.expand")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            copy(display);
          }}
        >
          {t("desktop.connection.server.copy")}
        </Button>
      </span>
    </span>
  );
}

// ── 승인에 답하기 ─────────────────────────────────────────────────────────

/** 다른 기기에서 온 승인 요청에 이 컴퓨터가 답하는가. 엔진이 설정을 알리지 않으면 바꿀 수 없다는 줄을 회색으로 보인다 */
function RespondRow(props: {
  readonly state: ConnectionState;
  readonly setRemoteRespond: (enabled: boolean) => void;
}): ReactNode {
  const { state, setRemoteRespond } = props;
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span id={labelId} className="min-w-0 text-ui text-text-primary">
          {t("desktop.connection.server.respond.label")}
        </span>
        <InfoTip text={t("desktop.connection.server.respond.hint")} />
        <span className="flex-1" />
        <Switch
          size="sm"
          aria-labelledby={labelId}
          checked={state.remoteAllowRespond === true}
          disabled={!canSetRemoteRespond(state)}
          onCheckedChange={setRemoteRespond}
        />
      </div>
      {state.status.kind === "ready" && state.remoteAllowRespond === null ? (
        <p className="m-0 text-ui text-text-tertiary">
          {t("desktop.connection.server.respond.unknown")}
        </p>
      ) : null}
    </div>
  );
}

// ── 기기 연결 코드 ────────────────────────────────────────────────────────

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
          <Button size="sm" variant="solid" disabled={busy} onClick={issue}>
            {t("desktop.connection.server.pairing.create")}
          </Button>
          <InfoTip text={t("desktop.connection.server.pairing.hint")} />
        </div>
      );
    case "issuing":
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="solid" loading disabled>
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
          <Alert
            tone={pairing.error.kind === "remote-off" ? "warning" : "danger"}
            size="sm"
            variant="outline"
            className="text-ui"
          >
            {pairing.error.kind === "remote-off"
              ? t("desktop.connection.server.pairing.remoteOff")
              : t("desktop.connection.server.pairing.failed")}
          </Alert>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="solid" disabled={busy} onClick={issue}>
              {t("desktop.connection.server.pairing.create")}
            </Button>
          </div>
        </div>
      );
    default:
      return assertNever(pairing, "PairingState");
  }
}

/** 발급된 연결 코드. 코드를 크게 보이고 남은 시간을 잇는다. 만료하면 "만료됨"과 다시 만들기를 보인다 */
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
      <span className="text-ui text-text-secondary">
        {t("desktop.connection.server.pairing.label")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`font-mono text-title-2 ${expired ? "text-text-tertiary" : "text-text-primary"}`}
        >
          {pairingCodeDisplay(code.code)}
        </span>
        {expired ? (
          <span className="text-ui text-text-tertiary">
            {t("desktop.connection.server.pairing.expired")}
          </span>
        ) : (
          <>
            <span className="text-ui text-text-secondary">
              {t("desktop.connection.server.pairing.remaining", { time: remaining })}
            </span>
            <Button
              size="sm"
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

/** 지금 고른 끊기 대상. 기기 하나거나 전부다 */
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
  readonly revokeFailed: boolean;
  readonly actions: RemoteActions;
  readonly inline: boolean;
}): ReactNode {
  const { devices, nowMs, locale, busy, revokeFailed, actions, inline } = props;
  const [pending, setPending] = useState<PendingRevoke | null>(null);
  const ready = devices.kind === "ready" ? devices.value : null;
  return (
    <div className="grid content-start gap-2">
      <div className="flex min-h-7 items-center gap-1.5">
        <h3 className="m-0 flex-1 text-ui font-medium text-text-primary">
          {t("desktop.connection.server.devices.heading")}
        </h3>
        {ready !== null && ready.length > 0 ? (
          <Button
            size="sm"
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
      {revokeFailed ? (
        <Alert tone="danger" size="sm" variant="outline" className="text-ui">
          {t("desktop.connection.server.notice.revokeFailed")}
        </Alert>
      ) : null}
      <Alert tone="warning" size="sm" variant="outline" className="text-ui">
        {t("desktop.connection.server.devices.warning")}
      </Alert>
      {devices.kind === "loading" ? <DevicesSkeleton /> : null}
      {devices.kind === "failed" ? (
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
                      run(actions.reloadDevices());
                    },
                    primary: true,
                  },
                ]
          }
        >
          {t("desktop.connection.server.devices.loadFailed")}
        </Alert>
      ) : null}
      {ready !== null && ready.length === 0 ? (
        <p className="m-0 text-ui text-text-tertiary">
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
              <li key={row.id} className="flex items-start justify-between gap-2 py-2">
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-ui font-medium text-text-primary">{row.name}</span>
                  <span className="text-ui text-text-tertiary">
                    {`${kindText} · ${lastSeenTextOf(row, nowMs, locale)}`}
                  </span>
                  <span className="truncate font-mono text-ui-sm text-text-tertiary">
                    {row.address ?? t("desktop.connection.server.devices.noAddress")}
                  </span>
                </span>
                <Button
                  size="sm"
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
    <div role="status" className="grid content-start gap-2">
      <span className="sr-only">{t("desktop.connection.server.devices.loading")}</span>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} width={`${50 + ((i * 17) % 30)}%`} height={14} />
      ))}
    </div>
  );
}

/** 기기 끊기 확인. 기기 하나나 전부를 가리킨다. 확인을 누르면 그 대상으로 `revoke`를 부른다 */
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
      <p className="m-0 text-ui text-text-secondary">{body}</p>
    </Dialog>
  );
}
