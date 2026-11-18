import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";

const REMOTE_NAMES = [
  "host.remote.status",
  "host.remote.setEnabled",
  "host.remote.pair",
  "host.remote.devices",
  "host.remote.revoke",
  "host.remote.preflight",
  "host.remote.tailscale",
  "host.remote.config",
  "host.remote.proxyExample",
];
const FINGERPRINT = "ab".repeat(32);
const DEVICE_ID = "dev_0123456789abcdef";
const DEVICE = {
  id: DEVICE_ID,
  name: "work laptop",
  kind: "desktop",
  createdAt: 1_700_000_000_000,
  lastSeenAt: null,
  address: null,
};

describe("host.remote methods", () => {
  test("are registered at M4 under the nine names (five from the spec table, four decided 2026-11-11)", () => {
    const registered = Object.entries(WIRE_METHODS).filter(([name]) =>
      name.startsWith("host.remote."),
    );
    expect(registered.map(([name]) => name).toSorted()).toEqual(REMOTE_NAMES.toSorted());
    expect(registered.map(([, spec]) => spec.stage)).toEqual(REMOTE_NAMES.map(() => "M4"));
  });

  test("host.remote.status takes no fields and answers with the state, ports, fingerprint and error", () => {
    const { params, result } = WIRE_METHODS["host.remote.status"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { _meta: {} }).ok).toBe(true);
    expect(parse(params, { extra: true }).ok).toBe(false);

    const off = {
      enabled: false,
      state: "off",
      loopbackPort: null,
      tlsPort: null,
      hosts: [],
      fingerprint: null,
      certSource: null,
      pushAvailable: false,
      error: null,
    };
    const running = {
      enabled: true,
      state: "running",
      loopbackPort: 8480,
      tlsPort: 8443,
      hosts: ["fresnel.example.ts.net", "127.0.0.1"],
      fingerprint: FINGERPRINT,
      certSource: "self-signed",
      pushAvailable: true,
      error: null,
    };
    const failed = {
      ...off,
      state: "failed",
      error: { kind: "remote.tls", message: "port in use" },
    };
    expect(parse(result, off).ok).toBe(true);
    expect(parse(result, running).ok).toBe(true);
    expect(parse(result, failed).ok).toBe(true);

    // 지문은 소문자 16진 64자다. 63자, 대문자, 알 수 없는 상태, 알 수 없는 인증서 출처, 0번 포트는 거절한다
    expect(parse(result, { ...running, fingerprint: FINGERPRINT.slice(0, 63) }).ok).toBe(false);
    expect(parse(result, { ...running, fingerprint: FINGERPRINT.toUpperCase() }).ok).toBe(false);
    expect(parse(result, { ...running, state: "x" }).ok).toBe(false);
    expect(parse(result, { ...running, certSource: "letsencrypt" }).ok).toBe(false);
    expect(parse(result, { ...running, tlsPort: 0 }).ok).toBe(false);
    expect(parse(result, { ...failed, error: { kind: "remote.tls" } }).ok).toBe(false);
  });

  test("host.remote.setEnabled takes a boolean and answers with the status result", () => {
    const { params, result } = WIRE_METHODS["host.remote.setEnabled"];
    expect(parse(params, { enabled: true }).ok).toBe(true);
    expect(parse(params, { enabled: false, _meta: {} }).ok).toBe(true);
    expect(parse(params, { enabled: "yes" }).ok).toBe(false);
    expect(parse(params, {}).ok).toBe(false);
    expect(parse(params, { enabled: true, extra: 1 }).ok).toBe(false);
    expect(result).toBe(WIRE_METHODS["host.remote.status"].result);
  });

  test("host.remote.pair takes no fields and answers with a 10-character code and its expiry", () => {
    const { params, result } = WIRE_METHODS["host.remote.pair"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { name: "x" }).ok).toBe(false);
    expect(parse(result, { code: "23456789AB", expiresAt: 1_700_000_300_000 }).ok).toBe(true);
    expect(parse(result, { code: "23456789A", expiresAt: 1_700_000_300_000 }).ok).toBe(false);
    expect(parse(result, { code: "23456789AB", expiresAt: -1 }).ok).toBe(false);
    expect(parse(result, { code: "23456789AB", expiresAt: 1.5 }).ok).toBe(false);
  });

  test("host.remote.devices answers with the paired devices and no token", () => {
    const { params, result } = WIRE_METHODS["host.remote.devices"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(result, { devices: [] }).ok).toBe(true);
    expect(
      parse(result, {
        devices: [
          DEVICE,
          {
            id: "dev_fedcba9876543210",
            name: "phone",
            kind: "web",
            createdAt: 1_700_000_000_000,
            lastSeenAt: 1_700_000_100_000,
            address: "100.64.0.2",
          },
        ],
      }).ok,
    ).toBe(true);
    expect(parse(result, { devices: [{ ...DEVICE, kind: "tv" }] }).ok).toBe(false);
    expect(
      parse(result, {
        devices: [{ id: DEVICE_ID, kind: "web", createdAt: 1, lastSeenAt: null, address: null }],
      }).ok,
    ).toBe(false);
    expect(parse(result, { devices: [{ ...DEVICE, token: "secret" }] }).ok).toBe(false);
  });

  test("host.remote.revoke takes one id or all, never both", () => {
    const { params, result } = WIRE_METHODS["host.remote.revoke"];
    expect(parse(params, { id: DEVICE_ID }).ok).toBe(true);
    expect(parse(params, { all: true }).ok).toBe(true);
    expect(parse(params, { all: true, _meta: {} }).ok).toBe(true);
    expect(parse(params, { id: DEVICE_ID, all: true }).ok).toBe(false);
    expect(parse(params, {}).ok).toBe(false);
    expect(parse(params, { all: false }).ok).toBe(false);
    expect(parse(params, { id: "" }).ok).toBe(false);
    expect(parse(params, { id: DEVICE_ID, extra: 1 }).ok).toBe(false);
    expect(parse(result, { revoked: 2 }).ok).toBe(true);
    expect(parse(result, { revoked: -1 }).ok).toBe(false);
  });

  test("host.remote.pair may carry the connection links: a kind and a URL each, and no other field", () => {
    const { result } = WIRE_METHODS["host.remote.pair"];
    const base = { code: "23456789AB", expiresAt: 1_700_000_300_000 };
    expect(parse(result, base).ok).toBe(true);
    expect(parse(result, { ...base, links: [] }).ok).toBe(true);
    const links = [
      { kind: "loopback", url: "http://127.0.0.1:8480/login#code=23456789AB" },
      {
        kind: "tailscale_magicdns",
        url: "https://my-mac.tail1234.ts.net:8443/login#code=23456789AB",
      },
    ];
    expect(parse(result, { ...base, links }).ok).toBe(true);
    expect(parse(result, { ...base, links: [{ kind: "wan", url: "https://x" }] }).ok).toBe(false);
    expect(parse(result, { ...base, links: [{ kind: "lan_ip" }] }).ok).toBe(false);
    expect(parse(result, { ...base, links: [{ kind: "lan_ip", url: "https://x", y: 1 }] }).ok).toBe(
      false,
    );
    expect(parse(result, { ...base, token: "secret" }).ok).toBe(false);
  });

  test("host.remote.preflight takes no fields and answers with the ready flag and the items", () => {
    const { params, result } = WIRE_METHODS["host.remote.preflight"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { _meta: {} }).ok).toBe(true);
    expect(parse(params, { extra: true }).ok).toBe(false);
    const passing = {
      id: "service_running",
      status: "pass",
      cause: null,
      fix: null,
      autoFix: null,
      detail: { port: 8443, holder: null },
    };
    const failing = {
      id: "gateway_running",
      status: "fail",
      cause: "gateway_off",
      fix: "turn_on_remote_access",
      autoFix: "enable_gateway",
      detail: {},
    };
    expect(parse(result, { ready: false, items: [passing, failing] }).ok).toBe(true);
    expect(parse(result, { ready: true, items: [] }).ok).toBe(true);
    expect(
      parse(result, {
        ready: true,
        items: [{ ...passing, detail: { addresses: [{ kind: "loopback", allowed: true }] } }],
      }).ok,
    ).toBe(true);
    expect(parse(result, { ready: false, items: [{ ...failing, status: "warn" }] }).ok).toBe(false);
    expect(parse(result, { ready: false, items: [{ ...failing, extra: 1 }] }).ok).toBe(false);
    expect(parse(result, { items: [passing] }).ok).toBe(false);
  });

  test("host.remote.tailscale takes one of three actions and answers with the state, serve and a failure value", () => {
    const { params, result } = WIRE_METHODS["host.remote.tailscale"];
    expect(parse(params, { action: "status" }).ok).toBe(true);
    expect(parse(params, { action: "serveOn", _meta: {} }).ok).toBe(true);
    expect(parse(params, { action: "serveOff" }).ok).toBe(true);
    expect(parse(params, { action: "serve" }).ok).toBe(false);
    expect(parse(params, {}).ok).toBe(false);

    const ready = {
      state: "ready",
      authUrl: null,
      magicDnsName: "my-mac.tail1234.ts.net",
      ips: ["100.64.0.2"],
      httpsEnabled: true,
      serve: { kind: "on", url: "https://my-mac.tail1234.ts.net" },
      consentUrl: null,
      failure: null,
    };
    const consent = {
      ...ready,
      httpsEnabled: false,
      serve: { kind: "off", url: null },
      consentUrl: "https://login.tailscale.com/f/serve?node=abc",
      failure: "https_not_enabled",
    };
    const absent = {
      state: "not_installed",
      authUrl: null,
      magicDnsName: null,
      ips: [],
      httpsEnabled: null,
      serve: { kind: "unavailable", url: null },
      consentUrl: null,
      failure: null,
    };
    expect(parse(result, ready).ok).toBe(true);
    expect(parse(result, consent).ok).toBe(true);
    expect(parse(result, absent).ok).toBe(true);
    expect(parse(result, { ...ready, state: "stopped" }).ok).toBe(false);
    expect(parse(result, { ...ready, serve: { kind: "proxy", url: null } }).ok).toBe(false);
    expect(parse(result, { ...ready, serve: { kind: "on", url: null, target: "x" } }).ok).toBe(
      false,
    );
  });

  test("host.remote.config takes an optional patch and a dry-run flag; the patch keys are closed", () => {
    const { params, result } = WIRE_METHODS["host.remote.config"];
    expect(parse(params, {}).ok).toBe(true);
    expect(parse(params, { dryRun: true }).ok).toBe(true);
    expect(
      parse(params, {
        patch: {
          listen: "127.0.0.1:8480",
          listenTls: null,
          hosts: ["fresnel.example.ts.net"],
          tlsCert: null,
          tlsKey: null,
        },
        dryRun: false,
        _meta: {},
      }).ok,
    ).toBe(true);
    expect(parse(params, { patch: { listen: "127.0.0.1:8480", port: 9 } }).ok).toBe(false);
    expect(parse(params, { patch: { hosts: "fresnel" } }).ok).toBe(false);
    expect(parse(params, { dryRun: "yes" }).ok).toBe(false);
    expect(parse(params, { extra: true }).ok).toBe(false);

    const settings = {
      listen: "127.0.0.1:8480",
      listenTls: "0.0.0.0:8443",
      hosts: [],
      tlsCert: null,
      tlsKey: null,
    };
    expect(parse(result, { settings, issues: [], written: false, restartNeeded: false }).ok).toBe(
      true,
    );
    expect(
      parse(result, {
        settings,
        issues: [{ field: "listenTls", code: "port_out_of_range" }],
        written: false,
        restartNeeded: false,
      }).ok,
    ).toBe(true);
    expect(
      parse(result, {
        settings: { ...settings, tlsKey: 1 },
        issues: [],
        written: false,
        restartNeeded: false,
      }).ok,
    ).toBe(false);
    expect(
      parse(result, {
        settings,
        issues: [{ field: "x", code: "y", message: "z" }],
        written: false,
        restartNeeded: false,
      }).ok,
    ).toBe(false);
    expect(parse(result, { settings, issues: [], written: true }).ok).toBe(false);
  });

  test("host.remote.proxyExample takes a kind, a DNS domain and a 1..65535 port; it answers with the text and the plan", () => {
    const { params, result } = WIRE_METHODS["host.remote.proxyExample"];
    const input = { kind: "caddy", domain: "fresnel.example.com", tlsPort: 8443 };
    expect(parse(params, input).ok).toBe(true);
    expect(parse(params, { ...input, kind: "nginx", _meta: {} }).ok).toBe(true);
    expect(parse(params, { ...input, kind: "apache" }).ok).toBe(false);
    expect(parse(params, { ...input, tlsPort: 0 }).ok).toBe(false);
    expect(parse(params, { ...input, tlsPort: 65536 }).ok).toBe(false);
    expect(parse(params, { ...input, tlsPort: 443.5 }).ok).toBe(false);
    expect(parse(params, { ...input, domain: "" }).ok).toBe(false);
    expect(parse(params, { ...input, extra: 1 }).ok).toBe(false);

    const answer = {
      text: "fresnel.example.com {\n}\n",
      plan: {
        listen: "127.0.0.1:8480",
        listenTls: "127.0.0.1:8443",
        hosts: ["fresnel.example.com"],
      },
    };
    expect(parse(result, answer).ok).toBe(true);
    // 계획은 기존 허용 호스트에 도메인을 더한 목록이다(L4.remote §8.8). 설정의 상한(64개)까지 받는다
    expect(parse(result, { ...answer, plan: { ...answer.plan, hosts: ["a", "b"] } }).ok).toBe(true);
    const many = Array.from({ length: 65 }, (_, index) => `h${String(index)}.example.com`);
    expect(parse(result, { ...answer, plan: { ...answer.plan, hosts: many } }).ok).toBe(false);
  });
});
