import { expect, test } from "bun:test";
import type { Clock } from "@fresnel/contracts";
import type { SettingReader } from "../src/assembly/settings-sources.ts";
import { gatewayConfigOf } from "../src/service/gateway-config.ts";
import {
  createTailscaleHostNames,
  detectTailscale,
  disableTailscaleServe,
  enableTailscaleServe,
  magicDnsNameOf,
  networkFingerprint,
  tailscaleHostNames,
  tailscaleServeStatus,
  type NetworkEntry,
  type NetworkInterfaceMap,
  type TailscaleDeps,
  type TailscaleState,
} from "../src/service/tailscale.ts";

// `tailscale` 실행 파일을 가짜로 바꾼다. `실행 파일 인자…` 한 줄을 키로 미리 정한 답을 돌려주고, 부른 명령을 쌓는다.
// 답이 없는 명령은 종료 코드 2(시험 잘못)로 답해 드러나게 한다. 실제 tailscale, 실제 홈, 실제 키는 쓰지 않는다.

const APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const PORT = 8443;

interface Reply {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

interface Call {
  readonly cmd: string;
  readonly args: readonly string[];
}

type FakeTailscale = TailscaleDeps & { readonly calls: Call[] };

function fakeTailscale(table: Readonly<Record<string, Reply>>, platform = "darwin"): FakeTailscale {
  const calls: Call[] = [];
  return {
    platform,
    calls,
    run(cmd, args) {
      calls.push({ cmd, args: [...args] });
      const line = [cmd, ...args].join(" ");
      const reply: Reply = table[line] ?? { exitCode: 2, stderr: `시험에 없는 명령: ${line}` };
      return Promise.resolve({
        exitCode: reply.exitCode ?? 0,
        stdout: reply.stdout ?? "",
        stderr: reply.stderr ?? "",
      });
    },
  };
}

const MISSING_BOTH: Readonly<Record<string, Reply>> = {
  "tailscale status --json": { exitCode: 127 },
  [`${APP} status --json`]: { exitCode: 127 },
};

const RUNNING = JSON.stringify({
  BackendState: "Running",
  AuthURL: "",
  Self: { DNSName: "My-Mac.Tail1234.ts.net.", TailscaleIPs: ["100.64.0.5", "fd7a:115c:a1e0::5"] },
  CurrentTailnet: { Name: "example.com", MagicDNSEnabled: true },
  CertDomains: ["my-mac.tail1234.ts.net"],
});

const READY: TailscaleState = {
  kind: "ready",
  magicDnsName: "my-mac.tail1234.ts.net",
  ips: ["100.64.0.5", "fd7a:115c:a1e0::5"],
  tailnetName: "example.com",
  httpsEnabled: true,
};

const SERVE_OURS = JSON.stringify({
  TCP: { "443": { HTTPS: true } },
  Web: { "my-mac.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8443" } } } },
});

const SERVE_OTHER = JSON.stringify({
  TCP: { "443": { HTTPS: true } },
  Web: { "my-mac.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } } } },
});

const DAEMON_OFF_STDERR = "failed to connect to local Tailscale daemon";

test("no tailscale on PATH and no app bundle means not installed, and both places were tried", async () => {
  const fake = fakeTailscale(MISSING_BOTH);
  expect(await detectTailscale(fake)).toEqual({ kind: "not_installed" });
  expect(fake.calls).toEqual([
    { cmd: "tailscale", args: ["status", "--json"] },
    { cmd: APP, args: ["status", "--json"] },
  ]);
});

test("off macOS the app bundle is not tried, so a missing PATH tailscale is not installed", async () => {
  const fake = fakeTailscale({ "tailscale status --json": { exitCode: 127 } }, "linux");
  expect(await detectTailscale(fake)).toEqual({ kind: "not_installed" });
  expect(fake.calls).toEqual([{ cmd: "tailscale", args: ["status", "--json"] }]);
});

test("the app bundle's CLI is used when PATH has no tailscale", async () => {
  const fake = fakeTailscale({
    "tailscale status --json": { exitCode: 127 },
    [`${APP} status --json`]: { stdout: RUNNING },
  });
  expect(await detectTailscale(fake)).toEqual(READY);
});

test("a Running status gives the MagicDNS name lowercased without the trailing dot, and the addresses and tailnet", async () => {
  const fake = fakeTailscale({ "tailscale status --json": { stdout: RUNNING } });
  expect(await detectTailscale(fake)).toEqual({
    kind: "ready",
    magicDnsName: "my-mac.tail1234.ts.net",
    ips: ["100.64.0.5", "fd7a:115c:a1e0::5"],
    tailnetName: "example.com",
    httpsEnabled: true,
  });
});

test("an empty CertDomains list means HTTPS is off, and a missing key means unknown", async () => {
  const empty = JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "a.b.", TailscaleIPs: [] },
    CertDomains: [],
  });
  const missing = JSON.stringify({ BackendState: "Running", Self: { DNSName: "a.b." } });
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: empty } })),
  ).toEqual({
    kind: "ready",
    magicDnsName: "a.b",
    ips: [],
    tailnetName: null,
    httpsEnabled: false,
  });
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: missing } })),
  ).toEqual({
    kind: "ready",
    magicDnsName: "a.b",
    ips: [],
    tailnetName: null,
    httpsEnabled: null,
  });
});

test("NeedsLogin keeps the AuthURL, and an empty AuthURL is null", async () => {
  const withUrl = JSON.stringify({
    BackendState: "NeedsLogin",
    AuthURL: "https://login.tailscale.com/a/abc",
  });
  const noUrl = JSON.stringify({ BackendState: "NeedsLogin", AuthURL: "" });
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: withUrl } })),
  ).toEqual({ kind: "needs_login", authUrl: "https://login.tailscale.com/a/abc" });
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: noUrl } })),
  ).toEqual({ kind: "needs_login", authUrl: null });
});

test("a stopped backend, and a daemon that is off (nonzero exit with empty output), are not running", async () => {
  const stopped = JSON.stringify({ BackendState: "Stopped" });
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: stopped } })),
  ).toEqual({ kind: "not_running" });
  expect(
    await detectTailscale(
      fakeTailscale({
        "tailscale status --json": { exitCode: 1, stderr: DAEMON_OFF_STDERR },
      }),
    ),
  ).toEqual({ kind: "not_running" });
});

test("output that is not a JSON object, or is empty on a zero exit, is unreadable", async () => {
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: "{" } })),
  ).toEqual({ kind: "unreadable", detail: "status 출력이 JSON 객체가 아니다" });
  expect(
    await detectTailscale(fakeTailscale({ "tailscale status --json": { stdout: "[1,2]" } })),
  ).toEqual({ kind: "unreadable", detail: "status 출력이 JSON 객체가 아니다" });
  expect(await detectTailscale(fakeTailscale({ "tailscale status --json": {} }))).toEqual({
    kind: "unreadable",
    detail: "status 출력이 비었다",
  });
});

test("serve status: an empty object is off, a handler to this port is on with its URL, another port is other", async () => {
  expect(
    await tailscaleServeStatus(
      fakeTailscale({ "tailscale serve status --json": { stdout: "{}" } }),
      PORT,
    ),
  ).toEqual({ kind: "off" });
  expect(
    await tailscaleServeStatus(
      fakeTailscale({ "tailscale serve status --json": { stdout: SERVE_OURS } }),
      PORT,
    ),
  ).toEqual({
    kind: "on",
    url: "https://my-mac.tail1234.ts.net",
    target: "http://127.0.0.1:8443",
  });
  expect(
    await tailscaleServeStatus(
      fakeTailscale({ "tailscale serve status --json": { stdout: SERVE_OTHER } }),
      PORT,
    ),
  ).toEqual({
    kind: "other",
    detail: "my-mac.tail1234.ts.net:443/ → http://127.0.0.1:9000",
  });
});

test("serve status with the daemon off is unavailable as not running, with the output line", async () => {
  const fake = fakeTailscale({
    "tailscale serve status --json": { exitCode: 1, stderr: DAEMON_OFF_STDERR },
    "tailscale status --json": { exitCode: 1 },
  });
  expect(await tailscaleServeStatus(fake, PORT)).toEqual({
    kind: "unavailable",
    reason: "not_running",
    detail: DAEMON_OFF_STDERR,
  });
});

test("enable runs serve with exactly these arguments and reads the URL back from the status", async () => {
  const fake = fakeTailscale({
    "tailscale serve --bg --https=443 http://127.0.0.1:8443": {
      stdout: "Available within your tailnet:\n\nhttps://my-mac.tail1234.ts.net/\n",
    },
    "tailscale serve status --json": { stdout: SERVE_OURS },
  });
  expect(await enableTailscaleServe(fake, PORT)).toEqual({
    ok: true,
    value: { url: "https://my-mac.tail1234.ts.net" },
  });
  expect(fake.calls[0]).toEqual({
    cmd: "tailscale",
    args: ["serve", "--bg", "--https=443", "http://127.0.0.1:8443"],
  });
});

test("enable with HTTPS off on the tailnet returns the consent link without the trailing period", async () => {
  const fake = fakeTailscale({
    "tailscale serve --bg --https=443 http://127.0.0.1:8443": {
      exitCode: 1,
      stderr:
        "Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=abc123.\n",
    },
  });
  expect(await enableTailscaleServe(fake, PORT)).toEqual({
    ok: false,
    error: {
      kind: "https_not_enabled",
      consentUrl: "https://login.tailscale.com/f/serve?node=abc123",
    },
  });
});

test("enable with the daemon off is not running, and an unknown failure keeps its first output line", async () => {
  const off = fakeTailscale({
    "tailscale serve --bg --https=443 http://127.0.0.1:8443": {
      exitCode: 1,
      stderr: DAEMON_OFF_STDERR,
    },
    "tailscale status --json": { exitCode: 1 },
  });
  expect(await enableTailscaleServe(off, PORT)).toEqual({
    ok: false,
    error: { kind: "not_running" },
  });
  const broken = fakeTailscale({
    "tailscale serve --bg --https=443 http://127.0.0.1:8443": {
      exitCode: 1,
      stderr: "boom: unknown flag\nmore detail",
    },
    "tailscale status --json": { stdout: RUNNING },
  });
  expect(await enableTailscaleServe(broken, PORT)).toEqual({
    ok: false,
    error: { kind: "failed", detail: "boom: unknown flag" },
  });
});

test("disable on a port that is already off succeeds without running the off command", async () => {
  const fake = fakeTailscale({ "tailscale serve status --json": { stdout: "{}" } });
  expect(await disableTailscaleServe(fake, PORT)).toEqual({ ok: true, value: null });
  expect(fake.calls).toEqual([{ cmd: "tailscale", args: ["serve", "status", "--json"] }]);
});

test("disable turns off this serve config when it points at this port", async () => {
  const fake = fakeTailscale({
    "tailscale serve status --json": { stdout: SERVE_OURS },
    "tailscale serve --https=443 off": { stdout: "" },
  });
  expect(await disableTailscaleServe(fake, PORT)).toEqual({ ok: true, value: null });
  expect(fake.calls[1]).toEqual({ cmd: "tailscale", args: ["serve", "--https=443", "off"] });
});

test("disable refuses to turn off another target's serve config and runs nothing", async () => {
  const fake = fakeTailscale({ "tailscale serve status --json": { stdout: SERVE_OTHER } });
  expect(await disableTailscaleServe(fake, PORT)).toEqual({
    ok: false,
    error: {
      kind: "failed",
      detail:
        "다른 대상을 내보내는 중이라 끄지 않았다: my-mac.tail1234.ts.net:443/ → http://127.0.0.1:9000",
    },
  });
  expect(fake.calls).toHaveLength(1);
});

test("disable with the daemon off is not running", async () => {
  const fake = fakeTailscale({
    "tailscale serve status --json": { exitCode: 1, stderr: DAEMON_OFF_STDERR },
    "tailscale status --json": { exitCode: 1 },
  });
  expect(await disableTailscaleServe(fake, PORT)).toEqual({
    ok: false,
    error: { kind: "not_running" },
  });
});

test("host names are the MagicDNS name and the addresses only when ready", () => {
  expect(tailscaleHostNames(READY)).toEqual([
    "my-mac.tail1234.ts.net",
    "100.64.0.5",
    "fd7a:115c:a1e0::5",
  ]);
  expect(tailscaleHostNames({ kind: "not_running" })).toEqual([]);
  expect(tailscaleHostNames({ kind: "needs_login", authUrl: null })).toEqual([]);
  expect(magicDnsNameOf(READY)).toBe("my-mac.tail1234.ts.net");
  expect(magicDnsNameOf({ kind: "not_running" })).toBeNull();
});

function readerOf(values: Readonly<Record<string, unknown>>): SettingReader {
  return (key) => values[key];
}

const TAILSCALE_NAMES: readonly string[] = ["my-mac.tail1234.ts.net", "100.64.0.5"];
const LOCAL_NAMES = (): readonly string[] => ["box", "192.168.0.7"];

test("names from Tailscale are added after the user's hosts, without duplicates", () => {
  const reader = readerOf({
    "l4.remote.web.listen": "127.0.0.1:8480",
    "l4.remote.web.hosts": ["mine.example", "my-mac.tail1234.ts.net"],
  });
  expect(gatewayConfigOf(reader, LOCAL_NAMES, () => TAILSCALE_NAMES).hosts).toEqual([
    "mine.example",
    "my-mac.tail1234.ts.net",
    "100.64.0.5",
  ]);
});

test("with no user hosts and no wildcard TLS, the Tailscale names alone are the hosts", () => {
  const reader = readerOf({ "l4.remote.web.listenTls": "127.0.0.1:8443" });
  expect(gatewayConfigOf(reader, LOCAL_NAMES, () => TAILSCALE_NAMES).hosts).toEqual(
    TAILSCALE_NAMES,
  );
});

test("with a wildcard TLS and no user hosts, this computer's names come first and repeats are dropped", () => {
  const reader = readerOf({ "l4.remote.web.listenTls": "0.0.0.0:8443" });
  expect(gatewayConfigOf(reader, LOCAL_NAMES, () => ["box", "100.64.0.5"]).hosts).toEqual([
    "box",
    "192.168.0.7",
    "100.64.0.5",
  ]);
});

test("the host list stays within 64 names, and without extra names the result is unchanged", () => {
  const user = Array.from({ length: 60 }, (_, index) => `h${index}.example`);
  const reader = readerOf({ "l4.remote.web.hosts": user });
  const extra = Array.from({ length: 10 }, (_, index) => `x${index}.example`);
  expect(gatewayConfigOf(reader, LOCAL_NAMES, () => extra).hosts).toEqual([
    ...user,
    "x0.example",
    "x1.example",
    "x2.example",
    "x3.example",
  ]);
  expect(gatewayConfigOf(readerOf({ "l4.remote.web.hosts": ["a.example"] })).hosts).toEqual([
    "a.example",
  ]);
});

function entryOf(address: string, internal = false): NetworkEntry {
  return { family: "IPv4", address, netmask: "255.255.255.0", internal };
}

test("the network fingerprint is the sorted list of interface entries, the same for the same addresses", () => {
  const one: NetworkInterfaceMap = {
    en0: [entryOf("192.168.0.7")],
    lo0: [entryOf("127.0.0.1", true)],
  };
  const reordered: NetworkInterfaceMap = {
    lo0: [entryOf("127.0.0.1", true)],
    en0: [entryOf("192.168.0.7")],
  };
  expect(networkFingerprint(one)).toBe(networkFingerprint(one));
  expect(networkFingerprint(one)).toBe(networkFingerprint(reordered));
  expect(networkFingerprint({ en0: [entryOf("10.0.0.2")] })).toBe(
    JSON.stringify([JSON.stringify(["en0", "IPv4", "10.0.0.2", "255.255.255.0", false])]),
  );
  expect(networkFingerprint(one)).not.toBe(
    networkFingerprint({ en0: [entryOf("192.168.0.8")], lo0: [entryOf("127.0.0.1", true)] }),
  );
});

test("refresh reads Tailscale again only after the interval or when the network changes", async () => {
  let now = 1_000;
  const clock: Clock = { now: () => now };
  let address = "10.0.0.2";
  const fake = fakeTailscale({ "tailscale status --json": { stdout: RUNNING } });
  const names = createTailscaleHostNames(fake, 60_000, {
    clock,
    interfaces: () => ({ en0: [entryOf(address)] }),
  });
  expect(names.current()).toEqual([]);

  await names.refresh();
  expect(names.current()).toEqual(tailscaleHostNames(READY));
  expect(fake.calls).toHaveLength(1);

  now = 31_000;
  await names.refresh();
  expect(fake.calls).toHaveLength(1);

  now = 61_000;
  await names.refresh();
  expect(fake.calls).toHaveLength(2);

  address = "10.0.0.9";
  await names.refresh();
  expect(fake.calls).toHaveLength(3);
});
