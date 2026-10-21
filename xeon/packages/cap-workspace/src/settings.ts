import { Type } from "typebox";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
} from "@xeon/contracts/settings";

// L2.workspace.spec §6. M1이 읽는 키만 선언한다(read.*, shell.*, list.maxEntries; plan W8).
// 나머지 키(grep.*, find.*, edit.fuzzy, images.*)는 그 키를 읽는 도구가 들어오는 마일스톤(M2, M3)에 더한다.

const ALL_SCOPES = ["managed", "user", "project", "local", "session"] as const;

const workspaceSettings = defineSettings("l2.workspace", {
  "read.maxLines": {
    type: Type.Integer(),
    default: 2000,
    range: { min: 1, max: 100000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 200, label: "읽기 최대 줄 수", unit: "줄" },
    since: "0.1.0",
  },
  "read.maxBytes": {
    type: Type.Integer(),
    default: 51200,
    range: { min: 1024, max: 10485760 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 201, label: "읽기 최대 바이트", unit: "B" },
    since: "0.1.0",
  },
  "shell.maxLines": {
    type: Type.Integer(),
    default: 2000,
    range: { min: 1, max: 100000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 202, label: "셸 출력 최대 줄 수", unit: "줄" },
    since: "0.1.0",
  },
  "shell.maxBytes": {
    type: Type.Integer(),
    default: 51200,
    range: { min: 1024, max: 10485760 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 203, label: "셸 출력 최대 바이트", unit: "B" },
    since: "0.1.0",
  },
  "shell.defaultTimeoutSec": {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 86400 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 204,
      label: "셸 기본 제한 시간",
      help: "0이면 제한 없음",
      unit: "초",
    },
    since: "0.1.0",
  },
  "list.maxEntries": {
    type: Type.Integer(),
    default: 500,
    range: { min: 1, max: 10000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "number", order: 205, label: "목록 최대 항목 수", unit: "개" },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const WORKSPACE_SETTING_DEFS: readonly SettingDef[] = Object.values(workspaceSettings.defs);

/** 호출 한 번이 읽는 유효 설정 */
export interface WorkspaceSettings {
  readonly read: { readonly maxLines: number; readonly maxBytes: number };
  readonly shell: {
    readonly maxLines: number;
    readonly maxBytes: number;
    /** 0이면 제한 없음 */
    readonly defaultTimeoutSec: number;
  };
  readonly list: { readonly maxEntries: number };
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  read: { maxLines: 2000, maxBytes: 51200 },
  shell: { maxLines: 2000, maxBytes: 51200, defaultTimeoutSec: 0 },
  list: { maxEntries: 500 },
};

/** 설정 층을 돌려준다. 파일 범위와 세션 범위를 모두 합친 스택이다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface WorkspaceSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

function integerValue(def: SettingDef, layers: ScopeStack, fallback: number): number {
  const { value } = resolveSetting(def, layers).setting;
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readWorkspaceSettings(layers: ScopeStack): WorkspaceSettings {
  const defs = workspaceSettings.defs;
  const fallback = DEFAULT_WORKSPACE_SETTINGS;
  return {
    read: {
      maxLines: integerValue(defs["read.maxLines"], layers, fallback.read.maxLines),
      maxBytes: integerValue(defs["read.maxBytes"], layers, fallback.read.maxBytes),
    },
    shell: {
      maxLines: integerValue(defs["shell.maxLines"], layers, fallback.shell.maxLines),
      maxBytes: integerValue(defs["shell.maxBytes"], layers, fallback.shell.maxBytes),
      defaultTimeoutSec: integerValue(
        defs["shell.defaultTimeoutSec"],
        layers,
        fallback.shell.defaultTimeoutSec,
      ),
    },
    list: { maxEntries: integerValue(defs["list.maxEntries"], layers, fallback.list.maxEntries) },
  };
}
