import { expect, test } from "bun:test";
import type { SettingReader } from "../src/assembly/settings-sources.ts";
import {
  gatewayConfigOf,
  hostNameOf,
  localHostNames,
  remoteEnabledOf,
} from "../src/service/gateway-config.ts";

// `l4.remote.web.*` 값을 감독자 설정으로 옮기는 표(L4.remote §10). 빈 문자열은 없음이고, 타입이 다른 값은 빈 값으로 본다.

function readerOf(values: Readonly<Record<string, unknown>>): SettingReader {
  return (key) => values[key];
}

test("empty text settings become null and an unset list becomes no hosts", () => {
  expect(gatewayConfigOf(readerOf({}))).toEqual({
    listen: "",
    listenTls: null,
    hosts: [],
    tlsCert: null,
    tlsKey: null,
  });
  expect(
    gatewayConfigOf(
      readerOf({
        "l4.remote.web.listen": "127.0.0.1:8480",
        "l4.remote.web.listenTls": "",
        "l4.remote.web.hosts": [],
        "l4.remote.web.tlsCert": "",
        "l4.remote.web.tlsKey": "",
      }),
    ),
  ).toEqual({
    listen: "127.0.0.1:8480",
    listenTls: null,
    hosts: [],
    tlsCert: null,
    tlsKey: null,
  });
});

test("set values pass through, and non-string entries of the host list are dropped", () => {
  expect(
    gatewayConfigOf(
      readerOf({
        "l4.remote.web.listen": "127.0.0.1:9000",
        "l4.remote.web.listenTls": "0.0.0.0:8443",
        "l4.remote.web.hosts": ["fresnel.example", 3, "", "other.example"],
        "l4.remote.web.tlsCert": "/etc/fresnel/cert.pem",
        "l4.remote.web.tlsKey": "/etc/fresnel/key.pem",
      }),
      () => [],
    ),
  ).toEqual({
    listen: "127.0.0.1:9000",
    listenTls: "0.0.0.0:8443",
    hosts: ["fresnel.example", "", "other.example"],
    tlsCert: "/etc/fresnel/cert.pem",
    tlsKey: "/etc/fresnel/key.pem",
  });
});

test("values of the wrong type fall back to the empty value instead of being passed on", () => {
  expect(
    gatewayConfigOf(
      readerOf({
        "l4.remote.web.listen": 8480,
        "l4.remote.web.listenTls": 8443,
        "l4.remote.web.hosts": "fresnel.example",
        "l4.remote.web.tlsCert": null,
        "l4.remote.web.tlsKey": true,
      }),
    ),
  ).toEqual({ listen: "", listenTls: null, hosts: [], tlsCert: null, tlsKey: null });
});

test("the enabled key is on only for the boolean true", () => {
  expect(remoteEnabledOf(readerOf({ "l4.remote.web.enabled": true }))).toBe(true);
  expect(remoteEnabledOf(readerOf({ "l4.remote.web.enabled": false }))).toBe(false);
  expect(remoteEnabledOf(readerOf({ "l4.remote.web.enabled": "true" }))).toBe(false);
  expect(remoteEnabledOf(readerOf({}))).toBe(false);
});

const names = (): readonly string[] => ["box", "box.local", "192.168.0.7"];

test("a wildcard external address always gets this computer's names, after the names the user wrote; a named address gets none", () => {
  const tls = (value: string, hosts: readonly string[]): SettingReader =>
    readerOf({ "l4.remote.web.listenTls": value, "l4.remote.web.hosts": hosts });
  expect(gatewayConfigOf(tls("0.0.0.0:8443", []), names).hosts).toEqual([
    "box",
    "box.local",
    "192.168.0.7",
  ]);
  expect(gatewayConfigOf(tls("[::]:9443", []), names).hosts).toEqual([
    "box",
    "box.local",
    "192.168.0.7",
  ]);
  expect(gatewayConfigOf(tls("0.0.0.0:8443", ["mine.example"]), names).hosts).toEqual([
    "mine.example",
    "box",
    "box.local",
    "192.168.0.7",
  ]);
  expect(gatewayConfigOf(tls("10.0.0.5:8443", []), names).hosts).toEqual([]);
  expect(gatewayConfigOf(tls("10.0.0.5:8443", ["mine.example"]), names).hosts).toEqual([
    "mine.example",
  ]);
  expect(gatewayConfigOf(readerOf({}), names).hosts).toEqual([]);
});

test("a public domain and this computer's names are both allowed: value form, no duplicates, Tailscale names last", () => {
  const read = readerOf({
    "l4.remote.web.listenTls": "0.0.0.0:8443",
    "l4.remote.web.hosts": ["fresnel.example", "box", "fresnel.example"],
  });
  expect(
    gatewayConfigOf(
      read,
      () => ["box", "box.local", "192.168.0.7"],
      () => ["box.tail1234.ts.net", "100.64.0.7", "fd7a:115c:a1e0::1"],
    ).hosts,
  ).toEqual([
    "fresnel.example",
    "box",
    "box.local",
    "192.168.0.7",
    "box.tail1234.ts.net",
    "100.64.0.7",
    "[fd7a:115c:a1e0::1]",
  ]);
});

test("a loopback external listener (the public-server plan) lists only what the user wrote", () => {
  const read = readerOf({
    "l4.remote.web.listenTls": "127.0.0.1:8443",
    "l4.remote.web.hosts": ["fresnel.example"],
  });
  expect(gatewayConfigOf(read, names, () => ["100.64.0.7"]).hosts).toEqual([
    "fresnel.example",
    "100.64.0.7",
  ]);
});

test("the names of this computer are valid Host names, include localhost, and have no duplicates", () => {
  const names = localHostNames();
  expect(names).toContain("localhost");
  expect(new Set(names).size).toBe(names.length);
  for (const name of names) expect(name).toMatch(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/u);
});

test("an IPv6 name is bracketed for --hosts, a zone id is left out, and IPv4 and host names pass unchanged", () => {
  expect(hostNameOf("100.64.0.7")).toBe("100.64.0.7");
  expect(hostNameOf("box.tail1234.ts.net")).toBe("box.tail1234.ts.net");
  expect(hostNameOf("fd7a:115c:a1e0::1")).toBe("[fd7a:115c:a1e0::1]");
  expect(hostNameOf("[fd7a:115c:a1e0::1]")).toBe("[fd7a:115c:a1e0::1]");
  expect(hostNameOf("::1")).toBe("[::1]");
  expect(hostNameOf("fe80::1%en0")).toBeNull();
  expect(hostNameOf("[fe80::1%en0]")).toBeNull();
});

test("the merged host list holds the bracketed IPv6 names in value form, without the zone id", () => {
  const tls = readerOf({
    "l4.remote.web.listenTls": "0.0.0.0:8443",
    "l4.remote.web.hosts": ["[fd7a:115c:a1e0::2]", "fresnel.example", "fresnel.example"],
  });
  expect(
    gatewayConfigOf(
      tls,
      () => [],
      () => [
        "box.tail1234.ts.net",
        "100.64.0.7",
        "fd7a:115c:a1e0::1",
        "fe80::1%en0",
        "[fd7a:115c:a1e0::1]",
      ],
    ).hosts,
  ).toEqual([
    "[fd7a:115c:a1e0::2]",
    "fresnel.example",
    "box.tail1234.ts.net",
    "100.64.0.7",
    "[fd7a:115c:a1e0::1]",
  ]);
});
