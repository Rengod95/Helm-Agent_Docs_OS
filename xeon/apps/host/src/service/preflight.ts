// L4.remote 접속 준비 점검. "다른 기기에서 이 컴퓨터로 들어올 준비가 됐는가"를 항목별로 본다. 화면(wizard)과 `fresnel doctor`가 같은 결과를 쓴다.
// 이 모듈은 I/O를 하지 않는다. 호출하는 쪽이 사실(PreflightFacts)을 모아 넘기고, 여기서는 코드(원인, 고치는 법, 앱이 대신 고칠 동작)를 돌려준다. 문장은 화면이 번역한다.
// `findPortHolder`만 외부 명령을 부른다. `run`은 명령이 없거나 실행에 실패해도 거부하지 않고 0이 아닌 종료 코드로 답한다고 본다. 거부는 그대로 전파한다.
import { hostNameOf } from "./gateway-config.ts";

export type PreflightItemId =
  | "service_running"
  | "gateway_running"
  | "listen_port"
  | "allowed_hosts"
  | "certificate"
  | "autostart"
  | "reachable_addresses";

export type PreflightStatus = "pass" | "fail" | "skip";

export type PreflightAutoFix =
  | "start_service"
  | "enable_gateway"
  | "install_autostart"
  | "add_allowed_hosts"
  | "refresh_autostart";

export interface PreflightItem {
  readonly id: PreflightItemId;
  readonly status: PreflightStatus;
  /** 실패·건너뜀의 원인 코드. pass면 null이 원칙이다. 경고용 안내(cert_expiring, cert_self_signed)만 pass에도 cause와 fix를 단다 */
  readonly cause: string | null;
  /** 고치는 법 코드(화면 번역 키). 예: "start_the_service", "turn_on_remote_access", "free_the_port_or_change_it", "set_allowed_hosts", "replace_the_certificate", "enable_autostart" */
  readonly fix: string | null;
  /** 앱이 대신 고칠 수 있으면 그 동작 이름. 아니면 null */
  readonly autoFix: PreflightAutoFix | null;
  /** 항목별 부가 값(JSON 직렬화 가능한 평문 값만). 예: listen_port → { port, holder: { pid, command } | null }, certificate → { source, trust, daysLeft }, reachable_addresses → { addresses } */
  readonly detail: Readonly<Record<string, unknown>>;
}

export type ReachableAddressKind =
  | "loopback"
  | "lan_ip"
  | "mdns_local"
  | "tailscale_ip"
  | "tailscale_magicdns";

export interface ReachableAddress {
  readonly kind: ReachableAddressKind;
  readonly host: string;
  /** 브라우저가 쓸 완전한 주소 */
  readonly url: string;
  /** 허용 호스트 목록에 들어 있나(없으면 접속해도 421). 루프백은 허용 목록을 보지 않으므로 항상 true다 */
  readonly allowed: boolean;
}

export interface PortHolder {
  readonly pid: number;
  readonly command: string;
}

/** 듣는 포트를 쓰는 프로세스. holder가 null이면 쓰는 프로세스를 알아내지 못했다(게이트웨이 자기 자신이면 호출하는 쪽이 이 값을 null로 넘긴다) */
export interface PortHolderFact {
  readonly port: number;
  readonly holder: PortHolder | null;
}

export interface PreflightFacts {
  readonly service: { readonly running: boolean };
  readonly gateway: {
    readonly enabled: boolean;
    readonly state: "off" | "starting" | "running" | "failed";
    readonly loopbackPort: number | null;
    readonly tlsPort: number | null;
    readonly hosts: readonly string[];
    readonly certSource: "self-signed" | "user" | null;
    /** 게이트웨이 오류 종류. 호출하는 쪽이 `RemoteStatusView.error?.kind`를 넣는다 */
    readonly errorKind: string | null;
  };
  readonly portHolder: PortHolderFact | null;
  readonly certificate: {
    readonly source: "self-signed" | "user" | null;
    /** 인증서 만료 시각(epoch ms). 모르면 null */
    readonly notAfter: number | null;
    /** `tailscale serve`가 켜져 있어 신뢰되는 HTTPS가 따로 있다 */
    readonly tailscaleServe: boolean;
  };
  /** 지금 시각(epoch ms) */
  readonly now: number;
  readonly autostart: {
    readonly supported: boolean;
    readonly registered: boolean;
    readonly upToDate: boolean;
  };
  readonly names: {
    /** 컴퓨터 이름(소문자). 점검에는 쓰지 않는다 */
    readonly machine: string | null;
    readonly lanIps: readonly string[];
    readonly mdnsName: string | null;
    readonly tailscaleIps: readonly string[];
    readonly magicDnsName: string | null;
  };
}

export interface PreflightResult {
  readonly items: readonly PreflightItem[];
  /** fail이 하나도 없다. skip은 무시한다 */
  readonly ready: boolean;
}

export type PortRun = (
  cmd: string,
  args: readonly string[],
) => Promise<{ readonly exitCode: number; readonly stdout: string }>;

const DAY_MS = 86_400_000;
/** 직접 발급 인증서가 이 기간 안에 만료되면 경고(pass + cause "cert_expiring")로 표시한다 */
const EXPIRING_MS = 14 * DAY_MS;
const LOOPBACK_HOST = "127.0.0.1";
/** 포트 충돌을 뜻하는 게이트웨이 오류 종류. 단어 경계에서 addr·port를 보고 EADDRINUSE를 본다("transport" 같은 말은 빼려고 경계를 둔다) */
const PORT_CONFLICT = /\b(?:addr|port)|EADDRINUSE/iu;

interface ItemInit {
  readonly cause?: string;
  readonly fix?: string;
  readonly autoFix?: PreflightAutoFix;
  readonly detail?: Readonly<Record<string, unknown>>;
}

function itemOf(id: PreflightItemId, status: PreflightStatus, init: ItemInit = {}): PreflightItem {
  return {
    id,
    status,
    cause: init.cause ?? null,
    fix: init.fix ?? null,
    autoFix: init.autoFix ?? null,
    detail: init.detail ?? {},
  };
}

type RemoteKind = Exclude<ReachableAddressKind, "loopback">;

interface RemoteName {
  readonly kind: RemoteKind;
  readonly host: string;
}

/** 루프백이 아닌 이름 후보를 정해진 순서로 낸다: LAN IP, mDNS, Tailscale IP, MagicDNS */
function remoteNamesOf(names: PreflightFacts["names"]): readonly RemoteName[] {
  const out: RemoteName[] = [];
  for (const host of names.lanIps) out.push({ kind: "lan_ip", host });
  if (names.mdnsName !== null) out.push({ kind: "mdns_local", host: names.mdnsName });
  for (const host of names.tailscaleIps) out.push({ kind: "tailscale_ip", host });
  if (names.magicDnsName !== null)
    out.push({ kind: "tailscale_magicdns", host: names.magicDnsName });
  return out;
}

function sameHost(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** 허용 호스트에 이 주소가 들어 있나. 두 쪽을 게이트웨이 모양(`hostNameOf`, IPv6는 대괄호)으로 맞춰 본다 */
function allowedBy(hosts: readonly string[], host: string): boolean {
  const name = hostNameOf(host);
  return name !== null && hosts.some((allowed) => sameHost(allowed, name));
}

/** URL에서 IPv6 주소는 대괄호로 감싼다 */
function urlHostOf(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function isPortConflict(errorKind: string | null): boolean {
  return errorKind !== null && PORT_CONFLICT.test(errorKind);
}

/** 브라우저가 쓸 주소 목록. 루프백이 첫 항목이다. 비루프백 주소는 tlsPort가 있을 때만 만든다 */
export function reachableAddressesOf(
  facts: Pick<PreflightFacts, "gateway" | "names">,
): readonly ReachableAddress[] {
  const { gateway, names } = facts;
  const out: ReachableAddress[] = [];
  if (gateway.loopbackPort !== null) {
    out.push({
      kind: "loopback",
      host: LOOPBACK_HOST,
      url: `http://${LOOPBACK_HOST}:${gateway.loopbackPort}`,
      allowed: true,
    });
  }
  if (gateway.tlsPort !== null) {
    for (const remote of remoteNamesOf(names)) {
      out.push({
        kind: remote.kind,
        host: remote.host,
        url: `https://${urlHostOf(remote.host)}:${gateway.tlsPort}`,
        allowed: allowedBy(gateway.hosts, remote.host),
      });
    }
  }
  return out;
}

function serviceItem(facts: PreflightFacts): PreflightItem {
  if (facts.service.running) return itemOf("service_running", "pass");
  return itemOf("service_running", "fail", {
    cause: "service_not_running",
    fix: "start_the_service",
    autoFix: "start_service",
  });
}

function gatewayItem(facts: PreflightFacts): PreflightItem {
  const { service, gateway } = facts;
  if (!service.running) {
    return itemOf("gateway_running", "skip", { cause: "depends_on_failed" });
  }
  if (!gateway.enabled || gateway.state === "off") {
    return itemOf("gateway_running", "fail", {
      cause: "gateway_off",
      fix: "turn_on_remote_access",
      autoFix: "enable_gateway",
    });
  }
  if (gateway.state === "failed") {
    return itemOf("gateway_running", "fail", {
      cause: "gateway_failed",
      fix: "see_the_error",
      detail: { errorKind: gateway.errorKind },
    });
  }
  if (gateway.state === "starting") {
    return itemOf("gateway_running", "skip", { cause: "gateway_starting" });
  }
  return itemOf("gateway_running", "pass");
}

/** 서비스와 게이트웨이가 떠 있어야 볼 수 있는 항목의 건너뜀 사유. 볼 수 있으면 null */
function gatewayGateOf(facts: PreflightFacts): string | null {
  const { service, gateway } = facts;
  if (!service.running) return "depends_on_failed";
  if (!gateway.enabled) return "depends_on_failed";
  if (gateway.state === "starting") return "gateway_starting";
  return gateway.state === "running" ? null : "depends_on_failed";
}

function listenPortItem(facts: PreflightFacts): PreflightItem {
  const { service, gateway } = facts;
  if (service.running && gateway.state === "failed" && isPortConflict(gateway.errorKind)) {
    return itemOf("listen_port", "fail", {
      cause: "port_in_use",
      fix: "free_the_port_or_change_it",
      detail: {
        port: facts.portHolder?.port ?? gateway.tlsPort ?? gateway.loopbackPort,
        holder: facts.portHolder?.holder ?? null,
      },
    });
  }
  const gate = gatewayGateOf(facts);
  if (gate !== null) return itemOf("listen_port", "skip", { cause: gate });
  return itemOf("listen_port", "pass", {
    detail: { port: gateway.tlsPort ?? gateway.loopbackPort },
  });
}

function allowedHostsItem(facts: PreflightFacts): PreflightItem {
  const gate = gatewayGateOf(facts);
  if (gate !== null) return itemOf("allowed_hosts", "skip", { cause: gate });
  const { gateway, names } = facts;
  if (gateway.tlsPort === null) return itemOf("allowed_hosts", "skip", { cause: "no_tls_port" });
  // 빠진 이름은 허용 호스트에 쓸 모양(IPv6는 대괄호)으로 낸다: 자동 고치기가 이 값을 그대로 설정에 쓴다
  const missing = remoteNamesOf(names).flatMap((remote) => {
    const name = hostNameOf(remote.host);
    return name === null || allowedBy(gateway.hosts, name) ? [] : [name];
  });
  const detail = { missing };
  if (gateway.hosts.length === 0) {
    return itemOf("allowed_hosts", "fail", {
      cause: "no_hosts",
      fix: "set_allowed_hosts",
      autoFix: "add_allowed_hosts",
      detail,
    });
  }
  if (missing.length > 0) {
    return itemOf("allowed_hosts", "fail", {
      cause: "host_missing",
      fix: "set_allowed_hosts",
      autoFix: "add_allowed_hosts",
      detail,
    });
  }
  return itemOf("allowed_hosts", "pass", { detail });
}

function certificateItem(facts: PreflightFacts): PreflightItem {
  const { certificate, now } = facts;
  const remainingMs = certificate.notAfter === null ? null : certificate.notAfter - now;
  const daysLeft = remainingMs === null ? null : Math.floor(remainingMs / DAY_MS);
  const detail = (trust: string | null): Readonly<Record<string, unknown>> => ({
    source: certificate.source,
    trust,
    daysLeft,
  });
  if (certificate.tailscaleServe) {
    return itemOf("certificate", "pass", { detail: detail("tailscale") });
  }
  if (certificate.source === null) {
    return itemOf("certificate", "skip", { cause: "no_certificate", detail: detail(null) });
  }
  if (certificate.source === "self-signed") {
    return itemOf("certificate", "pass", {
      cause: "cert_self_signed",
      fix: "use_tailscale_serve_for_trusted_https",
      detail: detail("self-signed"),
    });
  }
  if (remainingMs !== null && remainingMs <= 0) {
    return itemOf("certificate", "fail", {
      cause: "cert_expired",
      fix: "replace_the_certificate",
      detail: detail("user"),
    });
  }
  if (remainingMs !== null && remainingMs <= EXPIRING_MS) {
    return itemOf("certificate", "pass", {
      cause: "cert_expiring",
      fix: "replace_the_certificate",
      detail: detail("user"),
    });
  }
  return itemOf("certificate", "pass", { detail: detail("user") });
}

function autostartItem(facts: PreflightFacts): PreflightItem {
  const { autostart } = facts;
  if (!autostart.supported) {
    return itemOf("autostart", "skip", { cause: "unsupported_platform" });
  }
  const detail = { registered: autostart.registered, upToDate: autostart.upToDate };
  if (!autostart.registered) {
    return itemOf("autostart", "fail", {
      cause: "autostart_missing",
      fix: "enable_autostart",
      autoFix: "install_autostart",
      detail,
    });
  }
  if (!autostart.upToDate) {
    return itemOf("autostart", "fail", {
      cause: "autostart_stale",
      fix: "refresh_autostart",
      autoFix: "refresh_autostart",
      detail,
    });
  }
  return itemOf("autostart", "pass", { detail });
}

function reachableItem(facts: PreflightFacts): PreflightItem {
  const addresses = reachableAddressesOf(facts);
  const detail = { addresses };
  if (addresses.some((address) => address.kind !== "loopback")) {
    return itemOf("reachable_addresses", "pass", { detail });
  }
  return itemOf("reachable_addresses", "fail", {
    cause: "no_reachable_address",
    fix: "connect_to_a_network_or_enable_tailscale",
    detail,
  });
}

/** 접속 준비 점검. 항목 7개를 정해진 순서로 돌려준다 */
export function runPreflight(facts: PreflightFacts): PreflightResult {
  const items: readonly PreflightItem[] = [
    serviceItem(facts),
    gatewayItem(facts),
    listenPortItem(facts),
    allowedHostsItem(facts),
    certificateItem(facts),
    autostartItem(facts),
    reachableItem(facts),
  ];
  return { items, ready: items.every((item) => item.status !== "fail") };
}

/** `lsof -Fpc` 출력에서 첫 프로세스의 pid와 명령 이름을 읽는다. 없거나 pid가 정수가 아니면 null */
function holderOf(stdout: string): PortHolder | null {
  const lines = stdout.split("\n");
  const pidLine = lines.find((line) => line.startsWith("p"));
  const commandLine = lines.find((line) => line.startsWith("c"));
  if (pidLine === undefined || commandLine === undefined) return null;
  const pid = Number(pidLine.slice(1));
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid, command: commandLine.slice(1) };
}

/** 듣는 포트를 쓰는 프로세스를 `lsof`로 찾는다. lsof가 없거나 아무도 듣지 않으면 null */
export async function findPortHolder(run: PortRun, port: number): Promise<PortHolderFact | null> {
  const result = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  if (result.exitCode !== 0) return null;
  const holder = holderOf(result.stdout);
  return holder === null ? null : { port, holder };
}
