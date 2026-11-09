import { Type, type TArray, type TBoolean, type TInteger, type TString } from "typebox";
import {
  defineSettings,
  settingsJsonSchema,
  type SettingCatalog,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";

// L4.host-service.spec §3.6, §6.1. l4.host-service.* 키 두 개와 설정 파일 JSON Schema 출력.
// resolveLaunchMode(HS-37)는 서비스 모드(M3)라 아직 없다.
// L4.remote.spec §10. l4.remote.web.* 키 여섯 개(게이트웨이 설정). 시크릿 값은 두지 않는다.

export type HostSettingInputs = {
  readonly maxReplayEvents: SettingDefInput<TInteger>;
  readonly maxSubscriptionsPerConnection: SettingDefInput<TInteger>;
};

/** 기본값은 이 상수 한 곳에만 둔다(BP-06) */
export const DEFAULT_MAX_REPLAY_EVENTS = 100_000;
export const DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION = 16;

/**
 * 프로젝트·로컬 범위를 허용하지 않는다: 저장소를 받는 것만으로 연결 한도가 바뀌지 않게 하기 위해서다
 * (F.wire-settings.spec §4.7 규칙 4).
 */
export const hostSettings: SettingGroup<"l4.host-service", HostSettingInputs> = defineSettings(
  "l4.host-service",
  {
    maxReplayEvents: {
      type: Type.Integer(),
      default: DEFAULT_MAX_REPLAY_EVENTS,
      range: { min: 1000, max: 1_000_000 },
      runtimeChange: "live",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "number",
        order: 200,
        label: "Maximum events replayed per subscription",
        labelKey: "settings.l4.hostService.maxReplayEvents.label",
        help: "Events one subscription can replay. Beyond this, subscribe again from a newer position",
        helpKey: "settings.l4.hostService.maxReplayEvents.help",
        unit: "items",
      },
      since: "0.1.0",
    },
    maxSubscriptionsPerConnection: {
      type: Type.Integer(),
      default: DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION,
      range: { min: 1, max: 256 },
      runtimeChange: "live",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "number",
        order: 210,
        label: "Subscriptions per connection",
        labelKey: "settings.l4.hostService.maxSubscriptionsPerConnection.label",
        unit: "items",
      },
      since: "0.1.0",
    },
  },
);

export type RemoteSettingInputs = {
  readonly "web.enabled": SettingDefInput<TBoolean>;
  readonly "web.listen": SettingDefInput<TString>;
  readonly "web.listenTls": SettingDefInput<TString>;
  readonly "web.hosts": SettingDefInput<TArray<TString>>;
  readonly "web.tlsCert": SettingDefInput<TString>;
  readonly "web.tlsKey": SettingDefInput<TString>;
};

/** 루프백 HTTP 리스너의 기본 주소. 기본값은 이 상수 한 곳에만 둔다(BP-06) */
const DEFAULT_REMOTE_LISTEN = "127.0.0.1:8480";

/**
 * 프로젝트·로컬 범위를 허용하지 않는다: 저장소를 받는 것만으로 외부 접근이 열리면 안 되기 때문이다.
 */
export const remoteSettings: SettingGroup<"l4.remote", RemoteSettingInputs> = defineSettings(
  "l4.remote",
  {
    "web.enabled": {
      type: Type.Boolean(),
      default: false,
      runtimeChange: "restart",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "toggle",
        order: 300,
        label: "Run the remote web gateway",
        labelKey: "settings.l4.remote.web.enabled.label",
      },
      since: "0.1.0",
    },
    "web.listen": {
      type: Type.String(),
      default: DEFAULT_REMOTE_LISTEN,
      runtimeChange: "restart",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "text",
        order: 310,
        label: "Loopback web listen address",
        labelKey: "settings.l4.remote.web.listen.label",
      },
      since: "0.1.0",
    },
    "web.listenTls": {
      type: Type.String(),
      default: "",
      runtimeChange: "restart",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "text",
        order: 320,
        label: "External TLS listen address",
        labelKey: "settings.l4.remote.web.listenTls.label",
      },
      since: "0.1.0",
    },
    "web.hosts": {
      type: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 64 }),
      default: [],
      runtimeChange: "restart",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "list",
        order: 330,
        label: "Allowed Host names",
        labelKey: "settings.l4.remote.web.hosts.label",
      },
      since: "0.1.0",
    },
    "web.tlsCert": {
      type: Type.String(),
      default: "",
      runtimeChange: "restart",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "text",
        order: 340,
        label: "TLS certificate file path",
        labelKey: "settings.l4.remote.web.tlsCert.label",
      },
      since: "0.1.0",
    },
    "web.tlsKey": {
      type: Type.String(),
      default: "",
      runtimeChange: "restart",
      allowedScopes: ["managed", "user"],
      ui: {
        tab: "execution",
        widget: "text",
        order: 350,
        label: "TLS key file path",
        labelKey: "settings.l4.remote.web.tlsKey.label",
      },
      since: "0.1.0",
    },
  },
);

export type SettingsFileScope = "managed" | "user" | "project" | "local";

/** settingsJsonSchema 결과를 2칸 들여쓰기 JSON과 끝 줄바꿈 하나로 직렬화한다. 같은 입력이면 바이트가 같다 */
export function renderSettingsSchema(catalog: SettingCatalog, scope: SettingsFileScope): string {
  return `${JSON.stringify(settingsJsonSchema(catalog, { scope }), null, 2)}\n`;
}
