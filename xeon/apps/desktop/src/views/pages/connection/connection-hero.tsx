import { attachErrorKey, attachFixKey, parseTargetAddress } from "@fresnel/client";
import { assertNever } from "@fresnel/contracts";
import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import { Alert, Button, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";
import type { RemoteScreen } from "../../../app/remote/use-remote-controller.ts";
import type { EngineState } from "../../../state/engine/index.ts";
import { FORM_CONTROL_SIZE, RowNote, SettingSection } from "../settings/settings-section.tsx";
import {
  sameChoice,
  stepsOf,
  type ConnectionState,
  type ReconnectLine,
  type TargetChoice,
} from "./connection-model.ts";
import type { HeroExtras, SectionContext } from "./connection-sections.ts";
import { engineMessageOf, hostBadgeOf, stepMessageOf, timeTextOf } from "./connection-text.ts";

// 설정 "원격" 맨 위의 요약 카드 "지금 쓰는 컴퓨터"(시안 dzRW §3). 제목 없는 SettingSection 카드 하나에 두 칸이다.
//   머리 칸: 상태 점 8 + 컴퓨터 이름(16/600) + 상태 글(13 secondary), 오른쪽 끝은 원격일 때만 "이 컴퓨터로 돌아오기"(outline sm).
//            그 아래 들여 쓴 13 tertiary 줄들(요약, 연결 진행 단계, 다시 붙기, 유휴 종료)과 RowNote(연결 실패, 끊김, 읽기 실패).
//   통계 칸: 붙은 기기 · 도는 대화 · 버전 · 다른 기기 접속. 카드 폭 448 이상이면 4칸(720 열에서 칸 약 172), 그보다 좁으면 2×2.
// 마지막 대상 복원 실패 알림은 카드 위 Alert outline warning 한 줄이다(닫기 가능). 연결된 클라이언트 목록은 기기 구역이 맡는다.

/** 요약 카드의 상태 종류. 점 색과 상태 글이다 */
type HeroTone = "success" | "neutral" | "warning" | "danger";

export interface HeroStatus {
  readonly tone: HeroTone;
  readonly label: MessageId;
}

const CONNECTED: HeroStatus = { tone: "success", label: "desktop.connection.hero.state.connected" };
const RUNNING: HeroStatus = { tone: "success", label: "desktop.connection.hero.state.running" };
const CONNECTING: HeroStatus = {
  tone: "neutral",
  label: "desktop.connection.hero.state.connecting",
};
const RECONNECTING: HeroStatus = {
  tone: "warning",
  label: "desktop.connection.hero.state.reconnecting",
};
const DISCONNECTED: HeroStatus = {
  tone: "danger",
  label: "desktop.connection.hero.state.disconnected",
};

const DOT: Readonly<Record<HeroTone, string>> = {
  success: "bg-success-graphic",
  neutral: "bg-neutral-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
};

/**
 * 지금 쓰는 컴퓨터의 상태. 연결을 바꾸는 중이거나 엔진이 뜨는 중이면 연결 중, 엔진이 다시 붙는 중이면 다시 연결 중,
 * 지금 컴퓨터로 붙지 못했거나 엔진이 멈췄거나 연결이 없으면 끊김, 상태를 읽고 엔진이 돌면 연결됨이다. 상태를 읽는 중이면 null이다.
 */
export function heroStatusOf(
  state: ConnectionState,
  engine: EngineState | null,
): HeroStatus | null {
  if (state.pending !== null || engine?.kind === "starting") return CONNECTING;
  if (engine?.kind === "restarting") return RECONNECTING;
  if (state.failure !== null && sameChoice(state.failure.target, state.engineTarget)) {
    return DISCONNECTED;
  }
  if (engine?.kind === "failed" || engine?.kind === "stopped") return DISCONNECTED;
  if (state.status.kind === "offline") return DISCONNECTED;
  if (state.status.kind === "loading") return null;
  if (state.status.kind === "ready" && engine?.kind === "running") {
    return state.engineTarget.kind === "local" ? RUNNING : CONNECTED;
  }
  return { tone: "neutral", label: engineMessageOf(engine) };
}

/** 붙은 기기 수. 클라이언트 목록을 읽었으면 그 수, 아니면 `host.status`의 연결 수다. 둘 다 모르면 null이다 */
export function attachedCountOf(state: ConnectionState): number | null {
  if (state.clients.kind === "ready") return state.clients.clients.length;
  if (state.status.kind === "ready") return state.status.snapshot.host.connections;
  return null;
}

/** 컴퓨터 이름. 이 컴퓨터는 메시지 키이고 원격은 저장한 이름이다 */
function nameOf(choice: TargetChoice): string {
  return choice.kind === "local" ? t("desktop.connection.targets.local") : choice.entry.label;
}

/** 원격 주소의 종류 이름(`SSH`). 풀리지 않는 주소는 종류가 없다(null) */
export function addressKindOf(address: string): string | null {
  const badge = hostBadgeOf(address);
  return badge === null ? null : t(badge);
}

/** 원격 주소의 글(`dev@10.0.0.5`). 종류는 `addressKindOf`로 따로 보인다. 풀리지 않는 주소는 그대로 보인다 */
export function addressSummaryOf(address: string): string {
  const parsed = parseTargetAddress(address);
  const badge = hostBadgeOf(address);
  if (!parsed.ok || badge === null) return address;
  const target = parsed.target;
  return ((): string => {
    switch (target.kind) {
      case "ssh":
        return `${target.user === null ? "" : `${target.user}@`}${target.host}${target.port === null ? "" : `:${target.port}`}`;
      case "unix":
        return target.path;
      case "tcp":
      case "wss":
        return `${target.host}:${target.port}`;
      default:
        return assertNever(target, "TargetAddress");
    }
  })();
}

/** 이 컴퓨터의 요약 줄. 서비스로 돌면 "앱을 닫아도 계속 돌아요", 앱 안이면 "앱 안에서 돌아요"에 시작 시각을 잇는다 */
function localSummaryOf(state: ConnectionState, locale: Locale): string | null {
  if (state.status.kind !== "ready") return null;
  const host = state.status.snapshot.host;
  const key =
    host.mode === "service"
      ? "desktop.connection.hero.summary.service"
      : "desktop.connection.hero.summary.inProcess";
  return t(key, { time: timeTextOf(host.startedAt, locale) });
}

/** 연결 진행 줄. 지금 단계의 이름이고, 엔진을 다시 띄우는 중이면 몇 번째인지 붙인다 */
function connectingLineOf(pending: NonNullable<ConnectionState["pending"]>): string {
  const now = stepsOf(pending.stage).find((step) => step.status === "now");
  const step =
    pending.stage === "restarting"
      ? t("desktop.connection.step.retry", { attempt: pending.attempt })
      : t(stepMessageOf(now === undefined ? "start" : now.id));
  return t("desktop.connection.hero.connecting", { name: nameOf(pending.target), step });
}

/** 다시 붙기 줄 하나의 글 */
function reconnectTextOf(line: ReconnectLine, locale: Locale): string {
  switch (line.kind) {
    case "attempt":
      return t("desktop.connection.hero.reconnect.attempt", {
        attempt: line.attempt,
        seconds: line.seconds,
      });
    case "lastSeen":
      return t("desktop.connection.hero.reconnect.lastSeen", {
        time: timeTextOf(new Date(line.at).toISOString(), locale),
        turns: line.turns,
      });
    case "alive":
      return t("desktop.connection.hero.reconnect.alive");
    case "gone":
      return t("desktop.connection.hero.reconnect.gone");
    case "unknown":
      return t("desktop.connection.hero.reconnect.unknown");
    default:
      return assertNever(line, "ReconnectLine");
  }
}

/** 버전. 이 컴퓨터가 서비스에 붙어 있으면 서비스 버전, 앱 안이면 이 앱 연결의 버전이다. 원격 컴퓨터의 버전은 모른다(null) */
function versionOf(state: ConnectionState): string | null {
  if (state.engineTarget.kind === "remote") return null;
  if (state.service.kind === "running" && state.service.attached) return state.service.version;
  if (state.clients.kind !== "ready") return null;
  return state.clients.clients.find((client) => client.self)?.version ?? null;
}

/** 다른 기기 접속 칸의 글. 원격 컨트롤러가 없거나 상태를 못 읽었으면 null, 읽는 중이면 "loading"이다 */
function accessOf(remote: RemoteScreen | null): MessageId | "loading" | null {
  if (remote === null) return null;
  const status = remote.state.status;
  if (status.kind === "loading") return "loading";
  if (status.kind === "failed") return null;
  if (!status.value.enabled) return "desktop.connection.hero.access.off";
  switch (status.value.state) {
    case "running":
      return "desktop.connection.hero.access.on";
    case "failed":
      return "desktop.connection.hero.access.failed";
    case "off":
    case "starting":
      return "desktop.connection.hero.access.starting";
    default:
      return assertNever(status.value.state, "RemoteState");
  }
}

const NONE = "—";

/** 통계 값을 읽는 중이다(같은 높이의 Skeleton을 그린다) */
const LOADING = { loading: true } as const;

function Stat(props: {
  readonly slot: string;
  readonly term: string;
  /** 값. null이면 모름(—), `LOADING`이면 같은 높이의 Skeleton이다 */
  readonly value: string | null | typeof LOADING;
}): ReactNode {
  return (
    <div data-slot={props.slot} className="grid min-w-0 content-start gap-0.5">
      <dt className="truncate text-ui-sm text-text-tertiary">{props.term}</dt>
      <dd className="m-0 flex min-h-5 min-w-0 items-center truncate text-ui font-medium text-text-primary">
        {typeof props.value === "string" ? (
          props.value
        ) : props.value === null ? (
          NONE
        ) : (
          <Skeleton width={48} height={14} />
        )}
      </dd>
    </div>
  );
}

/** 통계 4칸. 넓으면 한 줄 4칸(칸 사이 1px 세로 선), 좁으면 2×2 */
function Stats(props: SectionContext): ReactNode {
  const { state, remote } = props;
  const loading = state.status.kind === "loading";
  const count = attachedCountOf(state);
  const host = state.status.kind === "ready" ? state.status.snapshot.host : null;
  const access = accessOf(remote);
  const version = versionOf(state);
  return (
    <dl
      data-slot="hero-stats"
      className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 @[28rem]:grid-cols-4 @[28rem]:gap-x-0 @[28rem]:[&>*]:pe-4 @[28rem]:[&>*+*]:border-s @[28rem]:[&>*+*]:border-border-subtle @[28rem]:[&>*+*]:ps-4"
    >
      <Stat
        slot="hero-stat-devices"
        term={t("desktop.connection.hero.stat.devices")}
        value={
          loading
            ? LOADING
            : count === null
              ? null
              : t("desktop.connection.hero.stat.devicesValue", { count })
        }
      />
      <Stat
        slot="hero-stat-turns"
        term={t("desktop.connection.hero.stat.turns")}
        value={
          loading
            ? LOADING
            : host === null
              ? null
              : t("desktop.connection.hero.stat.turnsValue", { count: host.liveTurns })
        }
      />
      <Stat
        slot="hero-stat-version"
        term={t("desktop.connection.hero.stat.version")}
        value={loading && version === null ? LOADING : version}
      />
      <Stat
        slot="hero-stat-access"
        term={t("desktop.connection.hero.stat.access")}
        value={access === "loading" ? LOADING : access === null ? null : t(access)}
      />
    </dl>
  );
}

/** 연결 실패 줄. 원인과 고치는 법이고 다시 시도를 준다. 진행 중에는 잠근다 */
function FailureNote(props: SectionContext): ReactNode {
  const { state, handlers } = props;
  const failure = state.failure;
  if (failure === null) return null;
  const locked = state.busy || state.pending !== null;
  return (
    <RowNote
      tone="danger"
      slot="hero-failure"
      actions={
        <Button size="xs" variant="outline" disabled={locked} onClick={handlers.retry}>
          {t("desktop.connection.retry")}
        </Button>
      }
    >
      {t("desktop.connection.hero.failed", { name: nameOf(failure.target) })}{" "}
      {t(attachErrorKey(failure.kind))} {t(attachFixKey(failure.kind))}
    </RowNote>
  );
}

export function ConnectionHero(props: SectionContext & HeroExtras): ReactNode {
  const { state, engine, locale, handlers, reconnect, targetNotice } = props;
  const choice = state.engineTarget;
  const remoteTarget = choice.kind === "remote";
  const status = heroStatusOf(state, engine);
  const loading = state.status.kind === "loading";
  const summary = remoteTarget ? null : localSummaryOf(state, locale);
  const remoteKind = choice.kind === "remote" ? addressKindOf(choice.entry.address) : null;
  const host = state.status.kind === "ready" ? state.status.snapshot.host : null;
  const locked = state.busy || state.pending !== null;
  const lines: string[] = [];
  if (state.pending !== null) lines.push(connectingLineOf(state.pending));
  for (const line of reconnect) lines.push(reconnectTextOf(line, locale));
  if (host !== null && host.idleShutdownAt !== null) {
    lines.push(
      t("desktop.connection.status.idleNotice", { time: timeTextOf(host.idleShutdownAt, locale) }),
    );
  }
  return (
    <div data-slot="connection-hero">
      {targetNotice === null ? null : (
        <Alert
          tone="warning"
          size="sm"
          variant="outline"
          className="text-ui"
          dismissible
          dismissLabel={t("desktop.connection.dismiss")}
          onDismiss={handlers.dismissTargetNotice}
        >
          {t("desktop.connection.lastTarget.fellBack", { name: targetNotice.name })}
        </Alert>
      )}
      <SettingSection label={t("desktop.connection.hero.label")} continues={targetNotice !== null}>
        <div data-slot="hero-head" className="grid min-w-0 gap-2">
          <div className="flex min-h-7 min-w-0 items-center gap-2">
            <span
              aria-hidden
              data-tone={status === null ? "neutral" : status.tone}
              className={`size-2 flex-none rounded-full ${DOT[status === null ? "neutral" : status.tone]}`}
            />
            <h2 className="m-0 min-w-0 truncate text-title-2 text-text-primary">
              {nameOf(choice)}
            </h2>
            {status === null ? null : (
              <span data-slot="hero-state" className="flex-none text-ui text-text-secondary">
                {t(status.label)}
              </span>
            )}
            <span className="flex-1" />
            {remoteTarget && !props.web ? (
              <Button
                size={FORM_CONTROL_SIZE}
                variant="outline"
                disabled={locked}
                onClick={handlers.backToLocal}
              >
                {t("desktop.connection.hero.backToLocal")}
              </Button>
            ) : null}
          </div>
          <div className="grid min-w-0 gap-1 ps-4">
            {choice.kind === "remote" ? (
              <p
                data-slot="hero-address"
                className="m-0 flex min-w-0 items-baseline gap-2 font-mono text-mono-sm text-text-tertiary"
              >
                {remoteKind === null ? null : (
                  <>
                    <span className="flex-none">{remoteKind}</span>{" "}
                  </>
                )}
                <span className="min-w-0 truncate">{addressSummaryOf(choice.entry.address)}</span>
              </p>
            ) : loading ? (
              <Skeleton width="40%" height={14} />
            ) : summary === null ? null : (
              <p data-slot="hero-summary" className="m-0 truncate text-ui text-text-tertiary">
                {summary}
              </p>
            )}
            {lines.map((line) => (
              <p key={line} data-slot="hero-line" className="m-0 text-ui text-text-tertiary">
                {line}
              </p>
            ))}
            <FailureNote {...props} />
            {state.status.kind === "offline" ? (
              <RowNote slot="hero-offline">
                {t(
                  remoteTarget ? "desktop.status.serviceLost" : "desktop.connection.status.offline",
                )}
              </RowNote>
            ) : null}
            {state.status.kind === "failed" ? (
              <RowNote
                tone="danger"
                slot="hero-load-failed"
                actions={
                  <Button size="xs" variant="outline" onClick={handlers.refresh}>
                    {t("desktop.connection.retry")}
                  </Button>
                }
              >
                {t("desktop.connection.status.loadFailed")}
              </RowNote>
            ) : null}
          </div>
        </div>
        <Stats {...props} />
      </SettingSection>
    </div>
  );
}
