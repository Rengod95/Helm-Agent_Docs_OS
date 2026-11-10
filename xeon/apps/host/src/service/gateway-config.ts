import { hostname, networkInterfaces } from "node:os";
import type { SettingReader } from "../assembly/settings-sources.ts";
import type { GatewayConfig } from "./gateway.ts";

// L4.remote.spec §10. 게이트웨이 설정 키 여섯 개(`remoteSettings`, settings.ts)를 감독자의 `GatewayConfig`로 옮긴다.
// 읽기는 호출할 때마다 `read`로 한다(켜고 끌 때 최신 값을 쓴다). 빈 문자열은 "없음"이다.

export const REMOTE_ENABLED_KEY = "l4.remote.web.enabled";

/** 게이트웨이를 켜라는 설정인가. 모르는 값(설정 없음, 타입 다름)은 끈 것으로 본다 */
export function remoteEnabledOf(read: SettingReader): boolean {
  return read(REMOTE_ENABLED_KEY) === true;
}

const WILDCARD_HOSTS: ReadonlySet<string> = new Set(["0.0.0.0", "::"]);
const HOST_PORT = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/u;
const DNS_NAME = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/u;
const HOSTS_MAX = 64;

/**
 * 이 컴퓨터를 브라우저가 부를 만한 이름: 컴퓨터 이름, 그 `.local`(mDNS), `localhost`, 비루프백 IPv4 주소.
 * 이름에 공백이나 한글이 있어 `Host`로 쓸 수 없는 것은 뺀다. 게이트웨이는 모든 주소(`0.0.0.0`)로 열 때 이 목록이 꼭 있어야 뜬다.
 */
export function localHostNames(): readonly string[] {
  const names: string[] = [];
  const machine = hostname().toLowerCase();
  if (DNS_NAME.test(machine)) {
    names.push(machine);
    if (!machine.includes(".")) names.push(`${machine}.local`);
  }
  names.push("localhost");
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) names.push(entry.address);
    }
  }
  return [...new Set(names)].slice(0, HOSTS_MAX);
}

function isWildcardTls(listenTls: string | null): boolean {
  if (listenTls === null) return false;
  const match = HOST_PORT.exec(listenTls);
  const bound = (match?.[1] ?? "").replace(/^\[|\]$/gu, "");
  return match !== null && WILDCARD_HOSTS.has(bound);
}

/**
 * `l4.remote.web.*`를 감독자 설정으로 옮긴다. 값이 없거나 타입이 다르면 빈 값(게이트웨이 기본값)으로 본다.
 * 외부 리스너가 모든 주소이고 `hosts`가 비어 있으면 `localNames`(기본 `localHostNames`)로 채운다: 사용자가 `hosts`를 적으면 그 값만 쓴다.
 */
export function gatewayConfigOf(
  read: SettingReader,
  localNames: () => readonly string[] = localHostNames,
): GatewayConfig {
  const listenTls = nullIfEmpty(read("l4.remote.web.listenTls"));
  const hosts = stringsOf(read("l4.remote.web.hosts"));
  return {
    listen: textOf(read("l4.remote.web.listen")),
    listenTls,
    hosts: hosts.length === 0 && isWildcardTls(listenTls) ? localNames() : hosts,
    tlsCert: nullIfEmpty(read("l4.remote.web.tlsCert")),
    tlsKey: nullIfEmpty(read("l4.remote.web.tlsKey")),
  };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullIfEmpty(value: unknown): string | null {
  const text = textOf(value);
  return text === "" ? null : text;
}

function stringsOf(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
