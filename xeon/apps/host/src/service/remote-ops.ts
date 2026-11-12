import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { isAbsolute } from "node:path";
import { assertNever, attempt, err, ok, type Clock, type Result } from "@fresnel/contracts";
import type { SettingReader } from "../assembly/settings-sources.ts";
import type { AutostartStatus } from "./autostart.ts";
import { gatewayConfigOf, localHostNames } from "./gateway-config.ts";
import {
  loopbackOnlyPlan,
  proxyExampleOf,
  readGatewaySettings,
  validateGatewaySettings,
  writeGatewaySettings,
  type GatewaySettingsIssue,
  type GatewaySettingsView,
  type ProxyExampleError,
  type ProxyExampleInput,
  type SettingWriter,
} from "./gateway-settings.ts";
import type { RemoteFailure, RemoteStatusView } from "./gateway.ts";
import { pairLinkOf } from "./pair-link.ts";
import {
  findPortHolder,
  reachableAddressesOf,
  runPreflight,
  type PortHolderFact,
  type PreflightFacts,
  type PreflightResult,
  type ReachableAddress,
  type ReachableAddressKind,
} from "./preflight.ts";
import {
  detectTailscale,
  disableTailscaleServe,
  enableTailscaleServe,
  magicDnsNameOf,
  tailscaleHostNames,
  tailscaleServeStatus,
  type ServeStatus,
  type TailscaleDeps,
  type TailscaleServeFailure,
  type TailscaleState,
} from "./tailscale.ts";

// L4.remote.spec §8.8(연결 링크, Tailscale, 사전 점검, 공개 서버 구성), §10(설정). 서비스가 `host.remote.*` 포트에 넣는 동작을 모았다.
// 이 모듈은 직접 I/O를 하지 않는다. 기기 접근(설정 읽기·쓰기, 감독자 상태, `tailscale`·`lsof` 실행, 시계, 자동 시작 상태)은 `RemoteOpsEnv`로 받는다.
// 예상 가능한 실패는 값(`Result`)이다. 주소 목록과 점검 값은 `preflight.ts`와 `tailscale.ts`의 순수 함수가 만든다.

/** 게이트웨이 설정이 없을 때 루프백 포트(설정 기본값과 같다) */
const DEFAULT_LOOPBACK_PORT = 8480;
const BIND_PORT = /:(\d{1,5})$/u;
/** 포트 충돌을 뜻하는 게이트웨이 오류 종류(`preflight.ts`의 `PORT_CONFLICT`와 같은 규칙) */
const PORT_CONFLICT = /\b(?:addr|port)|EADDRINUSE/iu;
const UNKNOWN_SERVE: ServeView = { kind: "unavailable", url: null };

export interface RemoteOpsEnv {
  /** 지금 감독자 상태 */
  readonly status: () => RemoteStatusView;
  /** 설정 읽기(호출할 때마다 최신 값) */
  readonly read: SettingReader;
  /** 설정 쓰기 포트. `host.remote.config`가 쓴다 */
  readonly writer: SettingWriter;
  /** `tailscale`과 `lsof`를 부르는 외부 명령 */
  readonly tailscale: TailscaleDeps;
  readonly clock: Clock;
  /** 자동 시작 상태. 지원하지 않는 기기는 `supported: false`다 */
  readonly autostart: () => Promise<AutostartStatus>;
}

/** 사실을 모을 때 한 번 읽는 값들. 연결 링크와 점검이 같은 값을 쓴다 */
interface Snapshot {
  readonly view: RemoteStatusView;
  readonly settings: GatewaySettingsView;
  readonly tailscale: TailscaleState;
  /** 게이트웨이가 지금 쓸 허용 호스트(Tailscale 이름은 방금 읽은 값으로 더한다) */
  readonly hosts: readonly string[];
}

async function snapshotOf(env: RemoteOpsEnv): Promise<Snapshot> {
  const tailscale = await detectTailscale(env.tailscale);
  return {
    view: env.status(),
    settings: readGatewaySettings(env.read),
    tailscale,
    hosts: gatewayConfigOf(env.read, localHostNames, () => tailscaleHostNames(tailscale)).hosts,
  };
}

function gatewayFactsOf(snap: Snapshot): PreflightFacts["gateway"] {
  const { view } = snap;
  return {
    enabled: view.enabled,
    state: view.state,
    loopbackPort: view.loopbackPort,
    tlsPort: view.tlsPort,
    hosts: snap.hosts,
    certSource: view.certSource,
    errorKind: view.error === null ? null : view.error.kind,
  };
}

function namesOf(tailscale: TailscaleState): PreflightFacts["names"] {
  const machine = hostname().toLowerCase();
  return {
    machine: machine === "" ? null : machine,
    lanIps: lanIpsOf(),
    // 같은 규칙(`localHostNames`)이 만든 이름만 쓴다: 점검이 보는 mDNS 이름과 허용 호스트 목록이 어긋나지 않는다
    mdnsName: localHostNames().find((name) => name === `${machine}.local`) ?? null,
    tailscaleIps: tailscale.kind === "ready" ? tailscale.ips : [],
    magicDnsName: magicDnsNameOf(tailscale),
  };
}

function lanIpsOf(): readonly string[] {
  return Object.values(networkInterfaces()).flatMap((entries) =>
    (entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address),
  );
}

/** `host:port` 끝의 포트. 모양이 틀리거나 범위 밖이면 null */
function portOfBind(text: string | null): number | null {
  if (text === null) return null;
  const match = BIND_PORT.exec(text);
  if (match === null) return null;
  const [, digits = ""] = match;
  const port = Number(digits);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

/** 설정된 듣기 포트(외부 리스너와 루프백). 충돌한 포트를 찾을 때 이 순서로 본다 */
function configuredPortsOf(settings: GatewaySettingsView): readonly number[] {
  return [portOfBind(settings.listen), portOfBind(settings.listenTls)].filter(
    (port): port is number => port !== null,
  );
}

async function portHolderOf(env: RemoteOpsEnv, snap: Snapshot): Promise<PortHolderFact | null> {
  const { view } = snap;
  if (view.state !== "failed" || view.error === null || !PORT_CONFLICT.test(view.error.kind)) {
    return null;
  }
  const holders = await Promise.all(
    configuredPortsOf(snap.settings).map((port) =>
      findPortHolder((cmd, args) => env.tailscale.run(cmd, args), port),
    ),
  );
  return holders.find((holder) => holder !== null) ?? null;
}

/** 사용자 인증서의 만료 시각(epoch ms). 파일이 없거나 읽지 못하면 null이다(게이트웨이처럼 절대 경로만 받는다) */
function userCertNotAfterOf(path: string | null): number | null {
  if (path === null || !isAbsolute(path)) return null;
  const parsed = attempt(() => new X509Certificate(readFileSync(path, "utf8")));
  if (!parsed.ok) return null;
  const notAfter = Date.parse(parsed.value.validTo);
  return Number.isNaN(notAfter) ? null : notAfter;
}

/** 접속 준비 점검에 넣을 사실을 모은다. 서비스는 항상 떠 있다(이 함수가 그 서비스에서 돈다) */
async function preflightFactsOf(env: RemoteOpsEnv): Promise<PreflightFacts> {
  const snap = await snapshotOf(env);
  const { view, settings } = snap;
  const servePort = view.tlsPort;
  const serving =
    servePort === null
      ? false
      : (await tailscaleServeStatus(env.tailscale, servePort)).kind === "on";
  const autostart = await env.autostart();
  return {
    service: { running: true },
    gateway: gatewayFactsOf(snap),
    portHolder: await portHolderOf(env, snap),
    certificate: {
      source: view.certSource,
      notAfter: view.certSource === "user" ? userCertNotAfterOf(settings.tlsCert) : null,
      tailscaleServe: serving,
    },
    now: env.clock.now(),
    autostart: {
      supported: autostart.supported,
      registered: autostart.registered,
      upToDate: autostart.upToDate,
    },
    names: namesOf(snap.tailscale),
  };
}

/** 접속 준비 점검(`host.remote.preflight`). 원격이 꺼져 있어도 답한다 */
export async function preflightOf(env: RemoteOpsEnv): Promise<PreflightResult> {
  return runPreflight(await preflightFactsOf(env));
}

export interface RemoteLink {
  readonly kind: ReachableAddressKind;
  readonly url: string;
}

/**
 * 연결 링크(`host.remote.pair`의 `links`). 허용된 비루프백 주소마다 하나다.
 * 비루프백 주소가 하나도 없으면 루프백 주소로 링크 하나를 만든다. 허용된 비루프백이 없으면 빈 배열이다.
 * 코드는 링크에만 들어가고 로그에는 싣지 않는다.
 */
export async function pairLinksOf(env: RemoteOpsEnv, code: string): Promise<readonly RemoteLink[]> {
  const snap = await snapshotOf(env);
  const addresses = reachableAddressesOf({
    gateway: gatewayFactsOf(snap),
    names: namesOf(snap.tailscale),
  });
  const remote = addresses.filter((address) => address.kind !== "loopback");
  const chosen = remote.length === 0 ? addresses : remote.filter((address) => address.allowed);
  return chosen.flatMap((address) => linkOf(address, code));
}

function linkOf(address: ReachableAddress, code: string): readonly RemoteLink[] {
  // 주소는 이 모듈이 만든 값이라 URL이 아니면 건너뛴다(그 주소로는 접속할 수 없다)
  if (!URL.canParse(address.url)) return [];
  const link = pairLinkOf(new URL(address.url).origin, code);
  return link === null ? [] : [{ kind: address.kind, url: link }];
}

export interface RemoteConfigOutcome {
  /** 검사한 값: 현재 값에 `patch`를 더한 것이다(읽기면 현재 값) */
  readonly settings: GatewaySettingsView;
  readonly issues: readonly GatewaySettingsIssue[];
  /** 실제로 썼을 때만 참이다 */
  readonly written: boolean;
  /** 쓴 뒤 게이트웨이가 떠 있다. 서비스는 자동으로 다시 띄우지 않는다 */
  readonly restartNeeded: boolean;
}

function configOutcomeOf(
  env: RemoteOpsEnv,
  settings: GatewaySettingsView,
  issues: readonly GatewaySettingsIssue[],
  written: boolean,
): RemoteConfigOutcome {
  const { state } = env.status();
  return {
    settings,
    issues,
    written,
    restartNeeded: written && (state === "running" || state === "starting"),
  };
}

/**
 * 게이트웨이 설정을 읽고, 검사하고, 쓴다(`host.remote.config`). `patch`가 없으면 읽기다.
 * `dryRun`이면 검사만 한다. 검사에 걸리면 아무것도 쓰지 않고 `issues`를 돌려준다. 저장 실패만 `store-failed`(실패 값)다.
 */
export async function remoteConfigOf(
  env: RemoteOpsEnv,
  patch: Partial<GatewaySettingsView> | null,
  dryRun: boolean,
): Promise<Result<RemoteConfigOutcome, RemoteFailure>> {
  const current = readGatewaySettings(env.read);
  const now = env.clock.now();
  if (patch === null) {
    const issues = validateGatewaySettings(current, undefined, now);
    return ok(configOutcomeOf(env, current, issues, false));
  }
  const next: GatewaySettingsView = { ...current, ...patch };
  if (dryRun) {
    const issues = validateGatewaySettings(next, undefined, now);
    return ok(configOutcomeOf(env, next, issues, false));
  }
  const written = await writeGatewaySettings(env.writer, patch, current, undefined, now);
  if (written.ok) return ok(configOutcomeOf(env, written.value, [], true));
  if (written.error.kind === "store_failed") return err({ kind: "store-failed" });
  return ok(configOutcomeOf(env, next, written.error.issues, false));
}

export interface ProxyExampleOutcome {
  readonly text: string;
  readonly plan: {
    readonly listen: string;
    readonly listenTls: string;
    readonly hosts: readonly string[];
  };
}

/**
 * 공개 서버(VPS) 구성의 리버스 프록시 예시와 루프백 전용 구성(`host.remote.proxyExample`). 상태는 바꾸지 않는다.
 * 루프백 포트는 설정 `listen`의 포트이고, 없으면 8480이다. 허용 호스트는 지금 적은 값에 도메인을 더한다(적은 이름을 지우지 않는다).
 */
export function remoteProxyExampleOf(
  env: Pick<RemoteOpsEnv, "read">,
  input: ProxyExampleInput,
): Result<ProxyExampleOutcome, ProxyExampleError> {
  const text = proxyExampleOf(input);
  if (!text.ok) return err(text.error);
  const settings = readGatewaySettings(env.read);
  const loopbackPort = portOfBind(settings.listen) ?? DEFAULT_LOOPBACK_PORT;
  return ok({
    text: text.value,
    plan: loopbackOnlyPlan(loopbackPort, input.tlsPort, input.domain, settings.hosts),
  });
}

export type RemoteTailscaleAction = "status" | "serveOn" | "serveOff";

interface ServeView {
  readonly kind: ServeStatus["kind"];
  readonly url: string | null;
}

export interface RemoteTailscaleReport {
  readonly state: TailscaleState["kind"];
  readonly authUrl: string | null;
  readonly magicDnsName: string | null;
  readonly ips: readonly string[];
  readonly httpsEnabled: boolean | null;
  readonly serve: ServeView;
  /** HTTPS가 꺼져 있을 때 tailnet에서 켜는 동의 링크 */
  readonly consentUrl: string | null;
  /** 실패 종류(`https_not_enabled` 등). 성공이면 null */
  readonly failure: string | null;
}

function serveViewOf(status: ServeStatus): ServeView {
  switch (status.kind) {
    case "on":
      return { kind: "on", url: status.url };
    case "off":
      return { kind: "off", url: null };
    case "other":
      return { kind: "other", url: null };
    case "unavailable":
      return { kind: "unavailable", url: null };
    default:
      return assertNever(status, "ServeStatus");
  }
}

/** `serveOn`·`serveOff`을 실행한다. `status`면 아무것도 하지 않는다 */
async function serveChangeOf(
  env: RemoteOpsEnv,
  action: RemoteTailscaleAction,
  port: number | null,
): Promise<TailscaleServeFailure | null> {
  if (port === null || action === "status") return null;
  const changed =
    action === "serveOn"
      ? await enableTailscaleServe(env.tailscale, port)
      : await disableTailscaleServe(env.tailscale, port);
  return changed.ok ? null : changed.error;
}

function reportOf(
  state: TailscaleState,
  serve: ServeView,
  failure: TailscaleServeFailure | null,
): RemoteTailscaleReport {
  const authUrl =
    state.kind === "needs_login"
      ? state.authUrl
      : failure !== null && failure.kind === "needs_login"
        ? failure.authUrl
        : null;
  return {
    state: state.kind,
    authUrl,
    magicDnsName: magicDnsNameOf(state),
    ips: state.kind === "ready" ? [...state.ips] : [],
    httpsEnabled: state.kind === "ready" ? state.httpsEnabled : null,
    serve,
    consentUrl:
      failure !== null && failure.kind === "https_not_enabled" ? failure.consentUrl : null,
    failure: failure === null ? null : failure.kind,
  };
}

/**
 * Tailscale 상태를 읽고, 요청이면 이 포트의 `tailscale serve`를 켜거나 끈다(`host.remote.tailscale`).
 * `serveOn`·`serveOff`은 게이트웨이의 **루프백 평문 리스너** 포트로 한다(TLS 포트가 아니다). 포트가 없으면 `remote-off`다.
 * 실패는 값이다: 실패 종류와 동의 링크를 돌려주고 오류로 던지지 않는다.
 */
export async function remoteTailscaleOf(
  env: RemoteOpsEnv,
  action: RemoteTailscaleAction,
): Promise<Result<RemoteTailscaleReport, RemoteFailure>> {
  const port = env.status().tlsPort;
  if (action !== "status" && port === null) return err({ kind: "remote-off" });
  const failure = await serveChangeOf(env, action, port);
  const state = await detectTailscale(env.tailscale);
  const serve: ServeView =
    port === null ? UNKNOWN_SERVE : serveViewOf(await tailscaleServeStatus(env.tailscale, port));
  return ok(reportOf(state, serve, failure));
}
