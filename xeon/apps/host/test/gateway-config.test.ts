import { expect, test } from "bun:test";
import type { SettingReader } from "../src/assembly/settings-sources.ts";
import { gatewayConfigOf, remoteEnabledOf } from "../src/service/gateway-config.ts";

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
