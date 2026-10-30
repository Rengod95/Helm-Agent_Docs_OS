import { Type, type TInteger } from "typebox";
import {
  defineSettings,
  settingsJsonSchema,
  type SettingCatalog,
  type SettingDefInput,
  type SettingGroup,
} from "@xeon/contracts/settings";

// L4.host-service.spec §3.6, §6.1. l4.host-service.* 키 두 개와 설정 파일 JSON Schema 출력.
// resolveLaunchMode(HS-37)는 서비스 모드(M3)라 아직 없다.

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

export type SettingsFileScope = "managed" | "user" | "project" | "local";

/** settingsJsonSchema 결과를 2칸 들여쓰기 JSON과 끝 줄바꿈 하나로 직렬화한다. 같은 입력이면 바이트가 같다 */
export function renderSettingsSchema(catalog: SettingCatalog, scope: SettingsFileScope): string {
  return `${JSON.stringify(settingsJsonSchema(catalog, { scope }), null, 2)}\n`;
}
