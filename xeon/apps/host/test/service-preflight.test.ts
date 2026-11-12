import { expect, test } from "bun:test";
import {
  findPortHolder,
  reachableAddressesOf,
  runPreflight,
  type PortHolder,
  type PortRun,
  type PreflightAutoFix,
  type PreflightFacts,
  type PreflightItem,
  type PreflightItemId,
  type PreflightResult,
  type PreflightStatus,
  type ReachableAddressKind,
} from "../src/service/preflight.ts";

// 접속 준비 점검 시험. 모든 값은 `toEqual`로 비교한다. 실제 lsof, 실제 인증서, 실제 네트워크는 쓰지 않는다.

const NOW = 1_780_000_000_000;
const DAY = 86_400_000;
const LOOPBACK_PORT = 7001;
const TLS_PORT = 8443;

const LAN = "192.168.0.10";
const MDNS = "my-mac.local";
const TS_IP = "100.64.0.5";
const MAGIC = "my-mac.tail1234.ts.net";
const ALL_HOSTS: readonly string[] = [LAN, MDNS, TS_IP, MAGIC];

const NAMES: PreflightFacts["names"] = {
  machine: "my-mac",
  lanIps: [LAN],
  mdnsName: MDNS,
  tailscaleIps: [TS_IP],
  magicDnsName: MAGIC,
};

const ORDER: PreflightItemId[] = [
  "service_running",
  "gateway_running",
  "listen_port",
  "allowed_hosts",
  "certificate",
  "autostart",
  "reachable_addresses",
];

/** 모두 준비된 사실. 시험마다 필요한 칸만 바꾼다 */
function readyFacts(): PreflightFacts {
  return {
    service: { running: true },
    gateway: {
      enabled: true,
      state: "running",
      loopbackPort: LOOPBACK_PORT,
      tlsPort: TLS_PORT,
      hosts: ALL_HOSTS,
      certSource: "user",
      errorKind: null,
    },
    portHolder: null,
    certificate: { source: "user", notAfter: NOW + 60 * DAY, tailscaleServe: false },
    now: NOW,
    autostart: { supported: true, registered: true, upToDate: true },
    names: NAMES,
  };
}

function itemOf(result: PreflightResult, id: PreflightItemId): PreflightItem | undefined {
  return result.items.find((item) => item.id === id);
}

function skipped(id: PreflightItemId, cause: string): PreflightItem {
  return { id, status: "skip", cause, fix: null, autoFix: null, detail: {} };
}

/** lsof가 없다(실행 파일을 찾지 못함, 셸과 같은 종료 코드 127) */
const LSOF_MISSING: PortRun = () => Promise.resolve({ exitCode: 127, stdout: "" });
/** 아무도 듣지 않는다(lsof는 일치가 없으면 1로 끝난다) */
const LSOF_NOBODY: PortRun = () => Promise.resolve({ exitCode: 1, stdout: "" });
/** 포트를 pid 4321인 node가 쓴다 */
const LSOF_NODE_4321: PortRun = () => Promise.resolve({ exitCode: 0, stdout: "p4321\ncnode\n" });
const HOLDER: PortHolder = { pid: 4321, command: "node" };

test("모두 준비되면 ready이고 항목 7개가 정해진 순서로 나온다", () => {
  const result = runPreflight(readyFacts());
  const statuses: PreflightStatus[] = ["pass", "pass", "pass", "pass", "pass", "pass", "pass"];
  expect(result.ready).toEqual(true);
  expect(result.items.map((item) => item.id)).toEqual(ORDER);
  expect(result.items.map((item) => item.status)).toEqual(statuses);
  expect(itemOf(result, "listen_port")).toEqual({
    id: "listen_port",
    status: "pass",
    cause: null,
    fix: null,
    autoFix: null,
    detail: { port: TLS_PORT },
  });
  expect(itemOf(result, "allowed_hosts")).toEqual({
    id: "allowed_hosts",
    status: "pass",
    cause: null,
    fix: null,
    autoFix: null,
    detail: { missing: [] },
  });
});

test("서비스가 꺼져 있으면 게이트 항목이 건너뛰고 ready가 아니다", () => {
  const result = runPreflight({ ...readyFacts(), service: { running: false } });
  expect(itemOf(result, "service_running")).toEqual({
    id: "service_running",
    status: "fail",
    cause: "service_not_running",
    fix: "start_the_service",
    autoFix: "start_service",
    detail: {},
  });
  expect(itemOf(result, "gateway_running")).toEqual(
    skipped("gateway_running", "depends_on_failed"),
  );
  expect(itemOf(result, "listen_port")).toEqual(skipped("listen_port", "depends_on_failed"));
  expect(itemOf(result, "allowed_hosts")).toEqual(skipped("allowed_hosts", "depends_on_failed"));
  expect(result.ready).toEqual(false);
});

test("게이트웨이가 꺼져 있으면 켜는 동작을 알려주고 하위 항목은 건너뛴다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: {
      ...readyFacts().gateway,
      enabled: false,
      state: "off",
      loopbackPort: null,
      tlsPort: null,
    },
  });
  expect(itemOf(result, "gateway_running")).toEqual({
    id: "gateway_running",
    status: "fail",
    cause: "gateway_off",
    fix: "turn_on_remote_access",
    autoFix: "enable_gateway",
    detail: {},
  });
  expect(itemOf(result, "listen_port")).toEqual(skipped("listen_port", "depends_on_failed"));
  expect(itemOf(result, "allowed_hosts")).toEqual(skipped("allowed_hosts", "depends_on_failed"));
  expect(result.ready).toEqual(false);
});

test("게이트웨이가 시작 중이면 실패가 아니라 건너뜀이다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: { ...readyFacts().gateway, state: "starting" },
  });
  expect(itemOf(result, "gateway_running")).toEqual(skipped("gateway_running", "gateway_starting"));
  expect(itemOf(result, "listen_port")).toEqual(skipped("listen_port", "gateway_starting"));
  expect(itemOf(result, "allowed_hosts")).toEqual(skipped("allowed_hosts", "gateway_starting"));
  expect(result.ready).toEqual(true);
});

test("게이트웨이가 다른 원인으로 실패하면 오류 종류를 담고 포트 항목은 건너뛴다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: {
      ...readyFacts().gateway,
      state: "failed",
      loopbackPort: null,
      tlsPort: null,
      errorKind: "gateway-binary-missing",
    },
  });
  expect(itemOf(result, "gateway_running")).toEqual({
    id: "gateway_running",
    status: "fail",
    cause: "gateway_failed",
    fix: "see_the_error",
    autoFix: null,
    detail: { errorKind: "gateway-binary-missing" },
  });
  expect(itemOf(result, "listen_port")).toEqual(skipped("listen_port", "depends_on_failed"));
});

test("findPortHolder는 lsof 출력에서 pid와 명령을 읽는다", async () => {
  const calls: string[][] = [];
  const run: PortRun = (cmd, args) => {
    calls.push([cmd, ...args]);
    return Promise.resolve({ exitCode: 0, stdout: "p4321\ncnode\n" });
  };
  expect(await findPortHolder(run, TLS_PORT)).toEqual({
    port: TLS_PORT,
    holder: HOLDER,
  });
  expect(calls).toEqual([["lsof", "-nP", "-iTCP:8443", "-sTCP:LISTEN", "-Fpc"]]);
});

test("findPortHolder는 lsof가 없거나 결과가 비면 holder를 알 수 없다(null)", async () => {
  expect(await findPortHolder(LSOF_MISSING, TLS_PORT)).toEqual(null);
  expect(await findPortHolder(LSOF_NOBODY, TLS_PORT)).toEqual(null);
});

test("포트를 다른 프로세스가 쓰면 listen_port가 실패하고 보유자를 담는다", async () => {
  const portHolder = await findPortHolder(LSOF_NODE_4321, TLS_PORT);
  const result = runPreflight({
    ...readyFacts(),
    gateway: {
      ...readyFacts().gateway,
      state: "failed",
      loopbackPort: null,
      tlsPort: null,
      hosts: [],
      errorKind: "EADDRINUSE",
    },
    portHolder,
  });
  expect(itemOf(result, "listen_port")).toEqual({
    id: "listen_port",
    status: "fail",
    cause: "port_in_use",
    fix: "free_the_port_or_change_it",
    autoFix: null,
    detail: { port: TLS_PORT, holder: HOLDER },
  });
  expect(result.ready).toEqual(false);
});

test("포트 충돌인데 보유자를 모르면 holder가 null이다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: {
      ...readyFacts().gateway,
      state: "failed",
      loopbackPort: null,
      tlsPort: null,
      errorKind: "gateway-addr-in-use",
    },
    portHolder: null,
  });
  expect(itemOf(result, "listen_port")).toEqual({
    id: "listen_port",
    status: "fail",
    cause: "port_in_use",
    fix: "free_the_port_or_change_it",
    autoFix: null,
    detail: { port: null, holder: null },
  });
});

test("허용 호스트에 이름이 빠지면 host_missing과 빠진 이름 목록을 준다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: { ...readyFacts().gateway, hosts: [MDNS] },
  });
  expect(itemOf(result, "allowed_hosts")).toEqual({
    id: "allowed_hosts",
    status: "fail",
    cause: "host_missing",
    fix: "set_allowed_hosts",
    autoFix: "add_allowed_hosts",
    detail: { missing: [LAN, TS_IP, MAGIC] },
  });
  expect(result.ready).toEqual(false);
});

test("허용 호스트가 비어 있으면 no_hosts이고 모든 이름이 빠진 것이다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: { ...readyFacts().gateway, hosts: [] },
  });
  expect(itemOf(result, "allowed_hosts")).toEqual({
    id: "allowed_hosts",
    status: "fail",
    cause: "no_hosts",
    fix: "set_allowed_hosts",
    autoFix: "add_allowed_hosts",
    detail: { missing: [LAN, MDNS, TS_IP, MAGIC] },
  });
});

test("직접 발급 인증서가 14일 안에 만료되면 경고로 pass와 cert_expiring을 준다", () => {
  const result = runPreflight({
    ...readyFacts(),
    certificate: { source: "user", notAfter: NOW + 10 * DAY, tailscaleServe: false },
  });
  expect(itemOf(result, "certificate")).toEqual({
    id: "certificate",
    status: "pass",
    cause: "cert_expiring",
    fix: "replace_the_certificate",
    autoFix: null,
    detail: { source: "user", trust: "user", daysLeft: 10 },
  });
  expect(result.ready).toEqual(true);
});

test("직접 발급 인증서가 만료되면 fail이다", () => {
  const result = runPreflight({
    ...readyFacts(),
    certificate: { source: "user", notAfter: NOW - DAY, tailscaleServe: false },
  });
  expect(itemOf(result, "certificate")).toEqual({
    id: "certificate",
    status: "fail",
    cause: "cert_expired",
    fix: "replace_the_certificate",
    autoFix: null,
    detail: { source: "user", trust: "user", daysLeft: -1 },
  });
});

test("자체 서명 인증서는 pass이고 신뢰되지 않는다는 원인과 Tailscale 안내를 준다", () => {
  const result = runPreflight({
    ...readyFacts(),
    certificate: { source: "self-signed", notAfter: null, tailscaleServe: false },
  });
  expect(itemOf(result, "certificate")).toEqual({
    id: "certificate",
    status: "pass",
    cause: "cert_self_signed",
    fix: "use_tailscale_serve_for_trusted_https",
    autoFix: null,
    detail: { source: "self-signed", trust: "self-signed", daysLeft: null },
  });
});

test("tailscale serve가 켜져 있으면 신뢰되는 HTTPS로 pass다", () => {
  const result = runPreflight({
    ...readyFacts(),
    certificate: { source: "self-signed", notAfter: null, tailscaleServe: true },
  });
  expect(itemOf(result, "certificate")).toEqual({
    id: "certificate",
    status: "pass",
    cause: null,
    fix: null,
    autoFix: null,
    detail: { source: "self-signed", trust: "tailscale", daysLeft: null },
  });
});

test("자동 시작이 등록되지 않았으면 install_autostart로 고친다", () => {
  const result = runPreflight({
    ...readyFacts(),
    autostart: { supported: true, registered: false, upToDate: false },
  });
  expect(itemOf(result, "autostart")).toEqual({
    id: "autostart",
    status: "fail",
    cause: "autostart_missing",
    fix: "enable_autostart",
    autoFix: "install_autostart",
    detail: { registered: false, upToDate: false },
  });
});

test("옛 자동 시작 등록이면 refresh_autostart로 고친다", () => {
  const result = runPreflight({
    ...readyFacts(),
    autostart: { supported: true, registered: true, upToDate: false },
  });
  expect(itemOf(result, "autostart")).toEqual({
    id: "autostart",
    status: "fail",
    cause: "autostart_stale",
    fix: "refresh_autostart",
    autoFix: "refresh_autostart",
    detail: { registered: true, upToDate: false },
  });
});

test("자동 시작을 지원하지 않는 플랫폼이면 건너뛴다", () => {
  const result = runPreflight({
    ...readyFacts(),
    autostart: { supported: false, registered: false, upToDate: false },
  });
  expect(itemOf(result, "autostart")).toEqual(skipped("autostart", "unsupported_platform"));
});

test("앱이 대신 고칠 수 있는 항목만 autoFix를 준다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: {
      ...readyFacts().gateway,
      enabled: false,
      state: "off",
      loopbackPort: null,
      tlsPort: null,
      hosts: [],
    },
    autostart: { supported: true, registered: false, upToDate: false },
  });
  const autoFixes: (PreflightAutoFix | null)[] = [
    null,
    "enable_gateway",
    null,
    null,
    null,
    "install_autostart",
    null,
  ];
  expect(result.items.map((item) => item.autoFix)).toEqual(autoFixes);
});

test("다섯 종류 주소가 정해진 url과 allowed 값으로 나온다", () => {
  const kinds: ReachableAddressKind[] = [
    "loopback",
    "lan_ip",
    "mdns_local",
    "tailscale_ip",
    "tailscale_magicdns",
  ];
  const addresses = reachableAddressesOf(readyFacts());
  expect(addresses.map((address) => address.kind)).toEqual(kinds);
  expect(addresses).toEqual([
    { kind: "loopback", host: "127.0.0.1", url: "http://127.0.0.1:7001", allowed: true },
    { kind: "lan_ip", host: LAN, url: "https://192.168.0.10:8443", allowed: true },
    { kind: "mdns_local", host: MDNS, url: "https://my-mac.local:8443", allowed: true },
    { kind: "tailscale_ip", host: TS_IP, url: "https://100.64.0.5:8443", allowed: true },
    {
      kind: "tailscale_magicdns",
      host: MAGIC,
      url: "https://my-mac.tail1234.ts.net:8443",
      allowed: true,
    },
  ]);
});

test("허용 호스트에 없는 주소는 allowed가 false다", () => {
  const facts = readyFacts();
  const addresses = reachableAddressesOf({
    gateway: { ...facts.gateway, hosts: [MDNS, MAGIC] },
    names: facts.names,
  });
  expect(addresses.map((address) => [address.kind, address.allowed])).toEqual([
    ["loopback", true],
    ["lan_ip", false],
    ["mdns_local", true],
    ["tailscale_ip", false],
    ["tailscale_magicdns", true],
  ]);
});

test("IPv6 주소는 url에서 대괄호로 감싼다", () => {
  const facts = readyFacts();
  const addresses = reachableAddressesOf({
    gateway: facts.gateway,
    names: {
      ...facts.names,
      lanIps: [],
      mdnsName: null,
      magicDnsName: null,
      tailscaleIps: ["fd7a:115c:a1e0::1"],
    },
  });
  expect(addresses).toEqual([
    { kind: "loopback", host: "127.0.0.1", url: "http://127.0.0.1:7001", allowed: true },
    {
      kind: "tailscale_ip",
      host: "fd7a:115c:a1e0::1",
      url: "https://[fd7a:115c:a1e0::1]:8443",
      allowed: false,
    },
  ]);
});

test("TLS 포트가 없으면 비루프백 주소가 없어 no_reachable_address로 실패한다", () => {
  const result = runPreflight({
    ...readyFacts(),
    gateway: { ...readyFacts().gateway, tlsPort: null, hosts: [] },
  });
  expect(itemOf(result, "reachable_addresses")).toEqual({
    id: "reachable_addresses",
    status: "fail",
    cause: "no_reachable_address",
    fix: "connect_to_a_network_or_enable_tailscale",
    autoFix: null,
    detail: {
      addresses: [
        { kind: "loopback", host: "127.0.0.1", url: "http://127.0.0.1:7001", allowed: true },
      ],
    },
  });
});
