import type { MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  PairLinkKind,
  ProxyExample,
  RemoteError,
  RemotePreflight,
  RemotePreflightItem,
  TailscaleInfo,
} from "../../../app/remote/remote-types.ts";
import type { CheckState } from "../shared/check-steps.tsx";

// "휴대폰·브라우저에서 쓰기" 구역(`reach-section.tsx`)의 순수 판단. React와 명령 호출이 없다.
// 사전 점검 7항목 → 화면 4줄 묶기와 원인·고침 문구 키, autoFix 동작 고르기, 닿는 방식의 기본값, 주소 종류 → 닿는 범위 문구,
// 도메인 검사, Tailscale 상태 띠, 연결 패널의 주소 목록을 맡는다. 원인 코드의 정본은 `apps/host/src/service/preflight.ts`다.

/** 닿는 방식 셋. 세그먼트 값과 같다 */
export type ReachMode = "wifi" | "tailscale" | "public";
export const REACH_MODES: readonly ReachMode[] = ["wifi", "tailscale", "public"];

/** 읽기 한 칸. 아직 부르지 않음, 읽는 중, 값, 실패 */
export type Fetch<T> =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "failed"; readonly error: RemoteError };

/** 공개 서버 도메인 적용의 진행. `issues`는 `host.remote.config` 검사 코드다 */
export type DomainApply =
  | { readonly kind: "idle" }
  | { readonly kind: "applying" }
  | { readonly kind: "applied"; readonly domain: string; readonly restartNeeded: boolean }
  | { readonly kind: "invalid"; readonly codes: readonly string[] }
  | { readonly kind: "failed"; readonly error: RemoteError };

/** 구역이 부르는 새 호출(사전 점검·Tailscale·설정·프록시 예시)의 상태. `reach-container.tsx`가 만든다 */
export interface ReachSetupState {
  readonly preflight: Fetch<RemotePreflight>;
  readonly tailscale: Fetch<TailscaleInfo>;
  /** serve 켜기·끄기가 도는 중 */
  readonly serveBusy: boolean;
  readonly domain: DomainApply;
  /** 허용 주소 넣기(autoFix)가 도는 중이거나 끝나 다시 시작이 필요한가 */
  readonly hosts: { readonly busy: boolean; readonly restartNeeded: boolean };
  readonly proxyKind: ProxyKind;
  readonly proxy: Fetch<ProxyExample>;
}

export type ProxyKind = "caddy" | "nginx";
export const PROXY_KINDS: readonly ProxyKind[] = ["caddy", "nginx"];

export const INITIAL_REACH_SETUP: ReachSetupState = {
  preflight: { kind: "idle" },
  tailscale: { kind: "idle" },
  serveBusy: false,
  domain: { kind: "idle" },
  hosts: { busy: false, restartNeeded: false },
  proxyKind: "caddy",
  proxy: { kind: "idle" },
};

// ── 사전 점검 → 화면 줄 ─────────────────────────────────────────────────

/** 화면 줄 넷. 서비스(+자동 시작) · 다른 기기 접속(+인증서) · 포트와 허용 주소 · 닿는 주소 */
export type ReachLineId = "service" | "remote" | "port" | "address";

const LINE_GROUPS: readonly (readonly [ReachLineId, readonly string[]])[] = [
  ["service", ["service_running", "autostart"]],
  ["remote", ["gateway_running", "certificate"]],
  ["port", ["listen_port", "allowed_hosts"]],
  ["address", ["reachable_addresses"]],
];

export const LINE_LABEL: Readonly<Record<ReachLineId, MessageId>> = {
  service: "desktop.connection.reach.check.service",
  remote: "desktop.connection.reach.check.remote",
  port: "desktop.connection.reach.check.port",
  address: "desktop.connection.reach.check.address",
};

/** 앱이 대신 고치는 동작. 화면이 아는 것만 */
export type AutoFixKind = "startService" | "enableRemote" | "addHosts" | "autostart";

export interface ReachLine {
  readonly id: ReachLineId;
  readonly state: CheckState;
  /** 원인(실패·건너뜀) 또는 통과 줄의 안내(자체 서명 인증서 등). 없으면 null */
  readonly cause: MessageId | null;
  /** 실패 줄의 고치는 법 */
  readonly fix: MessageId | null;
  readonly autoFix: AutoFixKind | null;
  /** 허용 주소에 넣을 이름(`allowed_hosts` 실패의 `detail.missing`) */
  readonly missingHosts: readonly string[];
}

const CAUSE_TEXT: Readonly<Record<string, MessageId>> = {
  service_not_running: "desktop.connection.reach.cause.serviceNotRunning",
  depends_on_failed: "desktop.connection.reach.cause.dependsOnFailed",
  gateway_off: "desktop.connection.reach.cause.remoteOff",
  gateway_failed: "desktop.connection.reach.cause.remoteFailed",
  gateway_starting: "desktop.connection.reach.cause.remoteStarting",
  port_in_use: "desktop.connection.reach.cause.portInUse",
  no_tls_port: "desktop.connection.reach.cause.noTlsPort",
  no_hosts: "desktop.connection.reach.cause.noHosts",
  host_missing: "desktop.connection.reach.cause.hostMissing",
  no_certificate: "desktop.connection.reach.cause.noCertificate",
  cert_self_signed: "desktop.connection.reach.cause.certSelfSigned",
  cert_expired: "desktop.connection.reach.cause.certExpired",
  cert_expiring: "desktop.connection.reach.cause.certExpiring",
  unsupported_platform: "desktop.connection.reach.cause.unsupportedPlatform",
  autostart_missing: "desktop.connection.reach.cause.autostartMissing",
  autostart_stale: "desktop.connection.reach.cause.autostartStale",
  no_reachable_address: "desktop.connection.reach.cause.noReachableAddress",
};

const FIX_TEXT: Readonly<Record<string, MessageId>> = {
  start_the_service: "desktop.connection.reach.fix.startService",
  turn_on_remote_access: "desktop.connection.reach.fix.turnOnRemote",
  see_the_error: "desktop.connection.reach.fix.seeError",
  free_the_port_or_change_it: "desktop.connection.reach.fix.freePort",
  set_allowed_hosts: "desktop.connection.reach.fix.setHosts",
  use_tailscale_serve_for_trusted_https: "desktop.connection.reach.fix.useTailscale",
  replace_the_certificate: "desktop.connection.reach.fix.replaceCertificate",
  enable_autostart: "desktop.connection.reach.fix.enableAutostart",
  refresh_autostart: "desktop.connection.reach.fix.refreshAutostart",
  connect_to_a_network_or_enable_tailscale: "desktop.connection.reach.fix.connectNetwork",
};

const AUTO_FIX: Readonly<Record<string, AutoFixKind>> = {
  start_service: "startService",
  enable_gateway: "enableRemote",
  add_allowed_hosts: "addHosts",
  install_autostart: "autostart",
  refresh_autostart: "autostart",
};

export const AUTO_FIX_LABEL: Readonly<Record<AutoFixKind, MessageId>> = {
  startService: "desktop.connection.reach.autoFix.startService",
  enableRemote: "desktop.connection.reach.autoFix.enableRemote",
  addHosts: "desktop.connection.reach.autoFix.addHosts",
  autostart: "desktop.connection.reach.autoFix.autostart",
};

/** 자기 속성으로 든 값만 읽는다(상속 속성은 보지 않는다) */
function ownEntry<T>(table: Readonly<Record<string, T>>, key: string): T | null {
  return Object.hasOwn(table, key) ? (table[key] ?? null) : null;
}

/** 원인 코드 → 문구 키. 모르는 코드는 일반 문구, null은 null */
export function causeTextOf(code: string | null): MessageId | null {
  if (code === null) return null;
  return ownEntry(CAUSE_TEXT, code) ?? "desktop.connection.reach.cause.unknown";
}

/** 고치는 법 코드 → 문구 키. 모르는 코드는 null(원인 문구만 보인다) */
export function fixTextOf(code: string | null): MessageId | null {
  return code === null ? null : ownEntry(FIX_TEXT, code);
}

/** autoFix 코드 → 화면 동작. 모르는 코드는 null(단추 없음) */
export function autoFixOf(code: string | null): AutoFixKind | null {
  return code === null ? null : ownEntry(AUTO_FIX, code);
}

/** `detail`의 문자열 목록 하나. 모양이 틀리면 빈 목록 */
function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item: unknown): item is string => typeof item === "string");
}

/** 실패해도 지금 접속을 막지 않는 항목(다음 로그인 뒤에만 영향) */
const ADVISORY: ReadonlySet<string> = new Set(["autostart"]);

function lineOf(id: ReachLineId, items: readonly RemotePreflightItem[]): ReachLine {
  const empty = { cause: null, fix: null, autoFix: null, missingHosts: [] };
  const failed =
    items.find((item) => item.status === "fail" && !ADVISORY.has(item.id)) ??
    items.find((item) => item.status === "fail");
  if (failed !== undefined) {
    return {
      id,
      // 자동 시작이 없는 것은 지금 닿는 데 지장이 없다. 막는 실패가 아니라 확인할 거리로 보인다
      state: ADVISORY.has(failed.id) ? "attention" : "failed",
      cause: causeTextOf(failed.cause),
      fix: fixTextOf(failed.fix),
      autoFix: autoFixOf(failed.autoFix),
      missingHosts: failed.id === "allowed_hosts" ? stringsOf(failed.detail["missing"]) : [],
    };
  }
  if (items.length === 0) return { id, state: "skipped", ...empty };
  if (items.every((item) => item.status === "skip")) {
    return { ...empty, id, state: "skipped", cause: causeTextOf(items[0]?.cause ?? null) };
  }
  // 통과 줄에도 안내 원인이 있을 수 있다(자체 서명, 곧 만료). 건너뛴 항목의 원인은 보이지 않는다
  const note = items.find((item) => item.status === "pass" && item.cause !== null);
  return { ...empty, id, state: "passed", cause: causeTextOf(note?.cause ?? null) };
}

/** 아직 결과가 없는 줄 넷 */
function pendingLines(state: CheckState): readonly ReachLine[] {
  return LINE_GROUPS.map(([id]) => ({
    id,
    state,
    cause: null,
    fix: null,
    autoFix: null,
    missingHosts: [],
  }));
}

/** 사전 점검 결과를 화면 줄 넷으로 묶는다. 읽는 중이면 모두 running, 읽기 전이면 모두 waiting */
export function reachLinesOf(preflight: Fetch<RemotePreflight>): readonly ReachLine[] {
  switch (preflight.kind) {
    case "idle":
    case "failed":
      return pendingLines("waiting");
    case "loading":
      return pendingLines("running");
    case "ready":
      return LINE_GROUPS.map(([id, ids]) =>
        lineOf(
          id,
          preflight.value.items.filter((item) => ids.includes(item.id)),
        ),
      );
    default:
      return assertNever(preflight, "Fetch");
  }
}

// ── 닿는 방식 ─────────────────────────────────────────────────────────

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const HOST_NAME_MAX = 253;

/** 이 이름이 공개 도메인처럼 보이는가: 점이 든 DNS 이름이고 IP, `.local`, Tailscale 이름, localhost가 아니다 */
export function isPublicDomain(host: string): boolean {
  const name = host.toLowerCase();
  if (name.length > HOST_NAME_MAX || !name.includes(".")) return false;
  if (IPV4.test(name) || name.includes(":")) return false;
  if (name.endsWith(".local") || name.endsWith(".ts.net") || name === "localhost") return false;
  return name.split(".").every((label) => DNS_LABEL.test(label));
}

/** 허용 주소 가운데 첫 공개 도메인. 없으면 null */
export function publicDomainOf(hosts: readonly string[]): string | null {
  return hosts.find((host) => isPublicDomain(host)) ?? null;
}

/** Tailscale serve가 이 컴퓨터에 켜져 있는가 */
export function serveIsOn(tailscale: TailscaleInfo | null): boolean {
  return tailscale !== null && tailscale.state === "ready" && tailscale.serve.kind === "on";
}

/** 방식의 기본값: Tailscale 준비됨이고 serve가 켜져 있으면 Tailscale, 허용 주소에 공개 도메인이 있으면 공개 서버, 아니면 같은 Wi‑Fi */
export function defaultReachMode(
  tailscale: TailscaleInfo | null,
  hosts: readonly string[],
): ReachMode {
  if (serveIsOn(tailscale)) return "tailscale";
  if (publicDomainOf(hosts) !== null) return "public";
  return "wifi";
}

/** 도메인 칸의 문제. 없으면 null */
export type DomainIssue = "empty" | "notDomain" | "notPublic";

export const DOMAIN_ISSUE_TEXT: Readonly<Record<DomainIssue, MessageId>> = {
  empty: "desktop.connection.reach.domain.empty",
  notDomain: "desktop.connection.reach.domain.notDomain",
  notPublic: "desktop.connection.reach.domain.notPublic",
};

/** 도메인 칸 검사. 주소(`https://…`, 포트, 경로)가 아니라 이름만 받는다 */
export function domainIssueOf(text: string): DomainIssue | null {
  const name = text.trim();
  if (name === "") return "empty";
  if (/[/:\s]/u.test(name)) return "notDomain";
  if (name.length > HOST_NAME_MAX || !name.split(".").every((label) => DNS_LABEL.test(label))) {
    return "notDomain";
  }
  return isPublicDomain(name) ? null : "notPublic";
}

const CONFIG_ISSUE_TEXT: Readonly<Record<string, MessageId>> = {
  host_bad_name: "desktop.connection.reach.configIssue.hostBadName",
  hosts_too_many: "desktop.connection.reach.configIssue.hostsTooMany",
  listen_bad_format: "desktop.connection.reach.configIssue.listen",
  listen_not_loopback: "desktop.connection.reach.configIssue.listen",
  listen_tls_bad_format: "desktop.connection.reach.configIssue.listen",
  port_out_of_range: "desktop.connection.reach.configIssue.listen",
};

/** 설정 검사 코드 → 문구 키. 인증서 파일 코드처럼 이 구역이 바꾸지 않는 값은 일반 문구다 */
export function configIssueTextOf(code: string): MessageId {
  return ownEntry(CONFIG_ISSUE_TEXT, code) ?? "desktop.connection.reach.configIssue.unknown";
}

// ── Tailscale 상태 띠 ───────────────────────────────────────────────────

type TailscaleBandAction = "download" | "login" | "reload" | null;

export interface TailscaleBand {
  readonly tone: "success" | "warning" | "danger" | "neutral";
  readonly title: MessageId;
  /** 준비됨이면 MagicDNS 이름. 그 밖은 설명 문구 키 */
  readonly name: string | null;
  readonly description: MessageId | null;
  readonly action: TailscaleBandAction;
}

/** Tailscale 감지 결과 → 상태 띠. 읽는 중·못 읽음은 부르는 쪽이 따로 그린다 */
export function tailscaleBandOf(info: TailscaleInfo): TailscaleBand {
  switch (info.state) {
    case "not_installed":
      return {
        tone: "neutral",
        title: "desktop.connection.reach.tailscale.notInstalled",
        name: null,
        description: "desktop.connection.reach.tailscale.notInstalledHint",
        action: "download",
      };
    case "not_running":
      return {
        tone: "warning",
        title: "desktop.connection.reach.tailscale.notRunning",
        name: null,
        description: "desktop.connection.reach.tailscale.notRunningHint",
        action: "reload",
      };
    case "needs_login":
      return {
        tone: "warning",
        title: "desktop.connection.reach.tailscale.needsLogin",
        name: null,
        description: "desktop.connection.reach.tailscale.needsLoginHint",
        action: info.authUrl === null ? "reload" : "login",
      };
    case "ready":
      return {
        tone: "success",
        title: "desktop.connection.reach.tailscale.ready",
        name: info.magicDnsName,
        description: null,
        action: null,
      };
    case "unreadable":
      return {
        tone: "danger",
        title: "desktop.connection.reach.tailscale.unreadable",
        name: null,
        description: null,
        action: "reload",
      };
    default:
      return assertNever(info.state, "TailscaleState");
  }
}

const SERVE_FAILURE_TEXT: Readonly<Record<string, MessageId>> = {
  not_installed: "desktop.connection.reach.serveFailure.notInstalled",
  not_running: "desktop.connection.reach.serveFailure.notRunning",
  needs_login: "desktop.connection.reach.serveFailure.needsLogin",
  https_not_enabled: "desktop.connection.reach.serveFailure.httpsNotEnabled",
  failed: "desktop.connection.reach.serveFailure.failed",
};

/** serve 실패 코드 → 문구 키 */
export function serveFailureTextOf(code: string): MessageId {
  return ownEntry(SERVE_FAILURE_TEXT, code) ?? "desktop.connection.reach.serveFailure.failed";
}

/** serve 켜기가 실행하는 명령(확인 대화 상자에 보인다). 서비스는 TLS 포트의 루프백 리스너를 내보낸다 */
export function serveCommandOf(tlsPort: number): string {
  return `tailscale serve --bg --https=443 https+insecure://127.0.0.1:${String(tlsPort)}`;
}

// ── 연결 패널 주소 ──────────────────────────────────────────────────────

/** 닿는 범위. 주소 옆 말("같은 Wi‑Fi에서만")을 고른다 */
export type ReachScope = "local" | "wifi" | "tailscale" | "internet";

export const SCOPE_TEXT: Readonly<Record<ReachScope, MessageId>> = {
  local: "desktop.connection.reach.scope.local",
  wifi: "desktop.connection.reach.scope.wifi",
  tailscale: "desktop.connection.reach.scope.tailscale",
  internet: "desktop.connection.reach.scope.internet",
};

/** 주소 종류 → 닿는 범위 */
export function scopeOfKind(kind: PairLinkKind): ReachScope {
  switch (kind) {
    case "loopback":
      return "local";
    case "lan_ip":
    case "mdns_local":
      return "wifi";
    case "tailscale_ip":
    case "tailscale_magicdns":
      return "tailscale";
    default:
      return assertNever(kind, "PairLinkKind");
  }
}

const TAILSCALE_CGNAT = /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u;

/** 호스트 이름만으로 주소 종류를 짐작한다(연결 코드의 링크가 아직 없을 때) */
export function kindOfHost(host: string): PairLinkKind {
  const name = host.toLowerCase().replace(/^\[|\]$/gu, "");
  if (name === "127.0.0.1" || name === "localhost" || name === "::1") return "loopback";
  if (name.endsWith(".ts.net")) return "tailscale_magicdns";
  if (TAILSCALE_CGNAT.test(name)) return "tailscale_ip";
  if (name.endsWith(".local")) return "mdns_local";
  return "lan_ip";
}

/** 연결 패널의 주소 한 개. `base`는 보이는 주소, `link`는 코드가 든 연결 링크(코드가 없으면 null) */
export interface PanelAddress {
  readonly base: string;
  readonly link: string | null;
  readonly scope: ReachScope;
}

/** URL의 출처(`https://host:port`). URL이 아니면 그대로 */
function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : url;
}

/** 베이스 주소와 코드로 연결 링크(`/login#code=`)를 만든다. 베이스가 URL이 아니면 null */
export function loginLinkOf(base: string, code: string): string | null {
  if (!URL.canParse(base)) return null;
  const url = new URL("/login", base);
  url.hash = new URLSearchParams([["code", code]]).toString();
  return url.toString();
}

export interface PanelInputs {
  readonly mode: ReachMode;
  /** 지금 코드의 링크(`host.remote.pair`의 `links`). 코드가 없으면 빈 목록 */
  readonly links: readonly { readonly kind: PairLinkKind; readonly url: string }[];
  /** 코드가 없을 때 보일 주소(`accessUrls`) */
  readonly urls: readonly string[];
  readonly code: string | null;
  /** serve가 켜져 있으면 그 주소(`https://<magicdns>`) */
  readonly serveUrl: string | null;
  /** 공개 서버의 도메인 */
  readonly domain: string | null;
}

const MODE_SCOPE: Readonly<Record<ReachMode, ReachScope>> = {
  wifi: "wifi",
  tailscale: "tailscale",
  public: "internet",
};

/** 연결 패널에 보일 주소. 고른 방식으로 닿는 것만 남긴다. 없으면 빈 목록 */
export function panelAddressesOf(input: PanelInputs): readonly PanelAddress[] {
  const { mode, code } = input;
  const withCode = (base: string): PanelAddress => ({
    base,
    link: code === null ? null : loginLinkOf(base, code),
    scope: MODE_SCOPE[mode],
  });
  if (mode === "public") return input.domain === null ? [] : [withCode(`https://${input.domain}`)];
  if (mode === "tailscale" && input.serveUrl !== null) return [withCode(originOf(input.serveUrl))];
  const scope = MODE_SCOPE[mode];
  if (input.links.length > 0) {
    return input.links
      .filter((link) => scopeOfKind(link.kind) === scope)
      .map((link) => ({ base: originOf(link.url), link: link.url, scope }));
  }
  return input.urls
    .filter((url) => URL.canParse(url) && scopeOfKind(kindOfHost(new URL(url).hostname)) === scope)
    .map((url) => withCode(originOf(url)));
}

/** 원격 오류 → 문구 키 */
export function remoteErrorTextOf(error: RemoteError): MessageId {
  switch (error.kind) {
    case "remote-off":
      return "desktop.connection.reach.error.remoteOff";
    case "unsupported":
      return "desktop.connection.reach.error.unsupported";
    case "bad-reply":
    case "failed":
      return "desktop.connection.reach.error.failed";
    default:
      return assertNever(error, "RemoteError");
  }
}
