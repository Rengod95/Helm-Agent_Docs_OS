import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";

const REMOTE_NAMES = [
  "host.remote.status",
  "host.remote.setEnabled",
  "host.remote.pair",
  "host.remote.devices",
  "host.remote.revoke",
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
  test("are registered at M4 under the five spec names", () => {
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
});
