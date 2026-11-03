import {
  initialSettingsState,
  reduceSettings,
  settingsViewOf,
  type FieldVM,
  type SettingsState,
  type SettingsView,
} from "@fresnel/client/settings";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  EffectiveSetting,
  SettingDefWire,
  SettingKey,
  SettingScope,
  SettingsTab,
  SettingUi,
  SettingWidget,
} from "@fresnel/contracts/settings";

// 설정 화면 시험의 입력 도우미. 정의와 유효 값은 와이어 모양으로 직접 쓰고, 상태는 클라이언트의 전이 함수로 만든다.
// 그래서 화면 시험이 보는 항목은 실제 `settingsViewOf` 결과와 같다.

const ALL_WRITABLE: readonly SettingScope[] = ["user", "project", "local", "launch"];

/** 정의 하나. 위젯과 값 모양은 호출자가 맞춘다(맞지 않으면 클라이언트가 읽기 전용으로 그린다) */
export function defOf(
  key: SettingKey,
  tab: SettingsTab,
  widget: SettingWidget,
  type: Readonly<Record<string, unknown>>,
  extra: Partial<SettingDefWire> = {},
  ui: Partial<SettingUi> = {},
): SettingDefWire {
  return {
    key,
    type: { ...type },
    runtimeChange: "live",
    layer: "L1",
    allowedScopes: [...ALL_WRITABLE],
    since: "0.1.0",
    ui: { tab, widget, order: 0, label: key, ...ui },
    ...extra,
  };
}

/** 유효 값 하나. 출처는 사용자 파일이다 */
export function settingOf(
  key: SettingKey,
  value: unknown,
  extra: Partial<EffectiveSetting> = {},
): EffectiveSetting {
  return {
    key,
    value,
    source: { scope: "user", path: "/home/user/.fresnel/settings.json" },
    locked: false,
    shadowed: [],
    runtimeChange: "live",
    pendingUntil: null,
    deprecated: false,
    ...extra,
  };
}

/** 정의와 유효 값을 넣은 상태. 열린 대화는 `threadId`로 정한다 */
export function stateOf(
  defs: readonly SettingDefWire[],
  settings: readonly EffectiveSetting[],
  threadId: ThreadId | null = null,
): SettingsState {
  let state = reduceSettings(initialSettingsState, { type: "catalogLoaded", defs });
  state = reduceSettings(state, { type: "valuesLoaded", settings });
  return reduceSettings(state, { type: "threadChanged", threadId });
}

/** 상태에서 화면 view-model을 만든다 */
export function viewOf(
  defs: readonly SettingDefWire[],
  settings: readonly EffectiveSetting[],
  threadId: ThreadId | null = null,
): SettingsView {
  return settingsViewOf(stateOf(defs, settings, threadId));
}

/** 모든 탭의 항목을 키 이름으로 찾는다. 없으면 시험이 실패하도록 `undefined`를 돌려준다 */
export function fieldIn(view: SettingsView, key: SettingKey): FieldVM | undefined {
  return view.tabs.flatMap((tab) => tab.fields).find((field) => field.key === key);
}
