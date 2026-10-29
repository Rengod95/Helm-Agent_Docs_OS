import type { SettingsTab } from "@xeon/contracts/settings";
import { t, type MessageId } from "../i18n/index.ts";

// 설정 탭 표(L4.settings-ui §4.1.1, 탭 13개). 값이 `SettingsTab`과 어긋나면 Record 타입이 컴파일 오류로 잡는다.

export interface TabSpec {
  readonly id: SettingsTab;
  readonly label: string;
  /** 0..12, 탭 표시 순서 */
  readonly position: number;
  /** 상태 게이지 자리가 있는 탭(§4.7). M3에서는 budgets와 providers만 참이다 */
  readonly gauge: boolean;
  readonly emptyText: string;
}

/**
 * 탭 한 줄. 글자는 읽는 순간의 현재 로케일로 만든다. 값으로 두면 모듈이 읽힐 때의 로케일에 묶이므로 getter로 둔다(ADR-0016 §3.3).
 */
function tabSpec(
  id: SettingsTab,
  position: number,
  gauge: boolean,
  labelId: MessageId,
  emptyId: MessageId,
): TabSpec {
  return {
    id,
    position,
    gauge,
    get label(): string {
      return t(labelId);
    },
    get emptyText(): string {
      return t(emptyId);
    },
  };
}

export const TAB_SPECS: Readonly<Record<SettingsTab, TabSpec>> = {
  overview: tabSpec(
    "overview",
    0,
    false,
    "client.settings.tabs.overview",
    "client.settings.tabs.overview.empty",
  ),
  models: tabSpec(
    "models",
    1,
    false,
    "client.settings.tabs.models",
    "client.settings.tabs.models.empty",
  ),
  budgets: tabSpec(
    "budgets",
    2,
    true,
    "client.settings.tabs.budgets",
    "client.settings.tabs.budgets.empty",
  ),
  providers: tabSpec(
    "providers",
    3,
    true,
    "client.settings.tabs.providers",
    "client.settings.tabs.providers.empty",
  ),
  secrets: tabSpec(
    "secrets",
    4,
    false,
    "client.settings.tabs.secrets",
    "client.settings.tabs.secrets.empty",
  ),
  permissions: tabSpec(
    "permissions",
    5,
    false,
    "client.settings.tabs.permissions",
    "client.settings.tabs.permissions.empty",
  ),
  sandbox: tabSpec(
    "sandbox",
    6,
    false,
    "client.settings.tabs.sandbox",
    "client.settings.tabs.sandbox.empty",
  ),
  sessions: tabSpec(
    "sessions",
    7,
    false,
    "client.settings.tabs.sessions",
    "client.settings.tabs.sessions.empty",
  ),
  tools: tabSpec(
    "tools",
    8,
    false,
    "client.settings.tabs.tools",
    "client.settings.tabs.tools.empty",
  ),
  plugins: tabSpec(
    "plugins",
    9,
    false,
    "client.settings.tabs.plugins",
    "client.settings.tabs.plugins.empty",
  ),
  execution: tabSpec(
    "execution",
    10,
    false,
    "client.settings.tabs.execution",
    "client.settings.tabs.execution.empty",
  ),
  appearance: tabSpec(
    "appearance",
    11,
    false,
    "client.settings.tabs.appearance",
    "client.settings.tabs.appearance.empty",
  ),
  advanced: tabSpec(
    "advanced",
    12,
    false,
    "client.settings.tabs.advanced",
    "client.settings.tabs.advanced.empty",
  ),
};

/** 탭 id를 표시 순서(position)대로 나열한다 */
export const TAB_ORDER: readonly SettingsTab[] = Object.values(TAB_SPECS)
  .toSorted((a, b) => a.position - b.position)
  .map((spec) => spec.id);
