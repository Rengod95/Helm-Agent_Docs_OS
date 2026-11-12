import { isIP } from "node:net";
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
 * 외부 리스너가 모든 주소이면 `localNames`(기본 `localHostNames`)를 적은 `hosts` 뒤에 더한다: 적은 값과 자동 이름을 함께 쓴다(같은 Wi‑Fi 접속과 공개 도메인이 함께 된다).
 * 결과 `hosts`에는 `extraNames`(Tailscale 이름 등, 루프백 리스너로 들어오는 Host 값)를 더한다. 중복은 뺀다.
 */
export function gatewayConfigOf(
  read: SettingReader,
  localNames: () => readonly string[] = localHostNames,
  extraNames: () => readonly string[] = () => [],
): GatewayConfig {
  const listenTls = nullIfEmpty(read("l4.remote.web.listenTls"));
  const hosts = stringsOf(read("l4.remote.web.hosts"));
  const automatic = isWildcardTls(listenTls) ? localNames() : [];
  return {
    listen: textOf(read("l4.remote.web.listen")),
    listenTls,
    hosts: mergeHosts([...hosts, ...automatic], extraNames()),
    tlsCert: nullIfEmpty(read("l4.remote.web.tlsCert")),
    tlsKey: nullIfEmpty(read("l4.remote.web.tlsKey")),
  };
}

/**
 * 허용 호스트 한 항목을 게이트웨이가 받는 모양으로 바꾼다. IPv6 주소는 대괄호로 싼다(`fd7a:115c:a1e0::1` → `[fd7a:115c:a1e0::1]`).
 * `main/args.ts`의 `--hosts` 검사와 `gateway-settings.ts`의 `hosts` 검사가 이 모양만 받는다(대괄호 없는 IPv6는 "bad name"이다).
 * 영역 식별자(`%en0`)가 붙은 주소는 브라우저가 `Host`로 보내지 않으므로 뺀다(null). IPv4와 이름은 그대로 둔다.
 */
export function hostNameOf(address: string): string | null {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const zone = bare.indexOf("%");
  if (zone >= 0) return isIP(bare.slice(0, zone)) === 6 ? null : address;
  return isIP(bare) === 6 ? `[${bare}]` : address;
}

/**
 * 앞 목록을 먼저 두고 뒤 목록을 더한다. 각 이름은 `hostNameOf`로 바꾸고(영역 식별자가 붙은 것은 뺀다),
 * 같은 이름은 한 번만 남기고, 상한 `HOSTS_MAX`를 넘기지 않는다
 */
function mergeHosts(base: readonly string[], extra: readonly string[]): readonly string[] {
  const names = [...base, ...extra].flatMap((name) => {
    const host = hostNameOf(name);
    return host === null ? [] : [host];
  });
  return [...new Set(names)].slice(0, HOSTS_MAX);
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
