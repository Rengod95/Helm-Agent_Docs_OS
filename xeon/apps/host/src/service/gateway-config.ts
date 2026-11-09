import type { SettingReader } from "../assembly/settings-sources.ts";
import type { GatewayConfig } from "./gateway.ts";

// L4.remote.spec §10. 게이트웨이 설정 키 여섯 개(`remoteSettings`, settings.ts)를 감독자의 `GatewayConfig`로 옮긴다.
// 읽기는 호출할 때마다 `read`로 한다(켜고 끌 때 최신 값을 쓴다). 빈 문자열은 "없음"이다.

export const REMOTE_ENABLED_KEY = "l4.remote.web.enabled";

/** 게이트웨이를 켜라는 설정인가. 모르는 값(설정 없음, 타입 다름)은 끈 것으로 본다 */
export function remoteEnabledOf(read: SettingReader): boolean {
  return read(REMOTE_ENABLED_KEY) === true;
}

/** `l4.remote.web.*`를 감독자 설정으로 옮긴다. 값이 없거나 타입이 다르면 빈 값(게이트웨이 기본값)으로 본다 */
export function gatewayConfigOf(read: SettingReader): GatewayConfig {
  return {
    listen: textOf(read("l4.remote.web.listen")),
    listenTls: nullIfEmpty(read("l4.remote.web.listenTls")),
    hosts: stringsOf(read("l4.remote.web.hosts")),
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
