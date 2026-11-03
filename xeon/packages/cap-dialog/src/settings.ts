import type { NoticeKind } from "@fresnel/contracts/capabilities";
import { Type } from "typebox";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
} from "@fresnel/contracts/settings";

// L2.dialog.spec §6. 13개 키를 모두 선언한다(plan D8). notify.*는 OS 전달(§4.7.2)이 읽고, styles.active는 2차 기능이 읽을 때까지 선언만 있다.

const FILE_SCOPES = ["managed", "user", "project", "local"] as const;
const USER_PROJECT = ["user", "project", "local"] as const;
const USER_PROJECT_SESSION = ["user", "project", "local", "launch"] as const;

const SHELL_INJECTION_MODES = ["confirm", "off"] as const;

const DEFAULT_SEGMENTS = ["core.turn", "core.tools", "core.usage", "*"] as const;

const dialogSettings = defineSettings("l2.dialog", {
  "ask.timeoutSec": {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 86400 },
    runtimeChange: "nextTurn",
    allowedScopes: USER_PROJECT_SESSION,
    ui: {
      tab: "tools",
      widget: "number",
      order: 300,
      label: "Default question time limit",
      help: "0 means no limit",
      unit: "s",
    },
    since: "0.1.0",
  },
  "commands.dirs": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 64 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: USER_PROJECT,
    ui: { tab: "tools", widget: "list", order: 301, label: "Extra command directories" },
    since: "0.1.0",
  },
  "commands.advertise": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: USER_PROJECT_SESSION,
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 302,
      label: "Tell the model about commands",
      help: "Adds command names and descriptions to the system prompt so the model can suggest commands to the user",
    },
    since: "0.1.0",
  },
  "commands.shellInjection": {
    type: Type.String({ maxLength: 16 }),
    default: "confirm",
    range: { enum: [...SHELL_INJECTION_MODES] },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "tools",
      widget: "select",
      order: 303,
      label: "Shell injection in command templates",
      help: "confirm asks before running, off blocks it",
    },
    since: "0.1.0",
  },
  "status.segments": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 66 }), { maxItems: 64 }),
    default: [...DEFAULT_SEGMENTS],
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: {
      tab: "appearance",
      widget: "list",
      order: 310,
      label: "Status line items to show",
      help: "Item id or prefix pattern (ending in *). The item * matches every item not picked earlier",
    },
    since: "0.1.0",
  },
  "attachments.maxBytes": {
    type: Type.Integer(),
    default: 20971520,
    range: { min: 1024, max: 104857600 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 320,
      label: "Max size of one attachment",
      unit: "B",
    },
    since: "0.1.0",
  },
  "styles.active": {
    type: Type.String({ maxLength: 32 }),
    default: "default",
    runtimeChange: "nextTurn",
    allowedScopes: USER_PROJECT_SESSION,
    ui: { tab: "appearance", widget: "text", order: 330, label: "Output style" },
    since: "0.1.0",
  },
  "notify.os": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: ["user"],
    ui: { tab: "execution", widget: "toggle", order: 340, label: "OS notifications" },
    since: "0.1.0",
  },
  "notify.completed": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 341, label: "Task completed notifications" },
    since: "0.1.0",
  },
  "notify.approvalWaiting": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 342, label: "Approval waiting notifications" },
    since: "0.1.0",
  },
  "notify.questionWaiting": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 343, label: "Question waiting notifications" },
    since: "0.1.0",
  },
  "notify.error": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 344, label: "Error notifications" },
    since: "0.1.0",
  },
  "notify.backgroundCompleted": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: {
      tab: "execution",
      widget: "toggle",
      order: 345,
      label: "Background task completed notifications",
    },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const DIALOG_SETTING_DEFS: readonly SettingDef[] = Object.values(dialogSettings.defs);

type ShellInjectionMode = (typeof SHELL_INJECTION_MODES)[number];

/** 호출 한 번이 읽는 유효 설정. 이 패키지가 읽는 키만 담는다(styles.active는 2차 기능이 읽는다) */
interface CommandDirSetting {
  readonly path: string;
  readonly scope: "user" | "project" | "local";
}

export interface DialogSettings {
  readonly ask: { readonly timeoutSec: number };
  readonly commands: {
    /** 설정에서 온 명령 디렉터리와 그 값이 나온 범위(spec §4.2.1a). 범위별 규칙은 `commands/service.ts`가 적용한다 */
    readonly dirs: readonly CommandDirSetting[];
    readonly advertise: boolean;
    readonly shellInjection: ShellInjectionMode;
  };
  readonly status: { readonly segments: readonly string[] };
  readonly attachments: { readonly maxBytes: number };
  /** 알림 전달 켜기. `os`는 OS 알림, `kinds`는 알림 종류별 켜기다(L2.dialog.spec §6) */
  readonly notify: {
    readonly os: boolean;
    readonly kinds: Readonly<Record<NoticeKind, boolean>>;
  };
}

export const DEFAULT_DIALOG_SETTINGS: DialogSettings = {
  ask: { timeoutSec: 0 },
  commands: { dirs: [], advertise: true, shellInjection: "confirm" },
  status: { segments: DEFAULT_SEGMENTS },
  attachments: { maxBytes: 20971520 },
  notify: {
    os: true,
    kinds: {
      completed: true,
      approval_waiting: true,
      question_waiting: true,
      error: true,
      background_completed: true,
    },
  },
};

/** 설정 층을 돌려준다. 파일 범위와 세션 범위를 합친 스택이다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface DialogSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

function valueOf(key: keyof typeof dialogSettings.defs, layers: ScopeStack): unknown {
  return resolveSetting(dialogSettings.defs[key], layers).setting.value;
}

function integerOf(
  key: keyof typeof dialogSettings.defs,
  layers: ScopeStack,
  fallback: number,
): number {
  const value = valueOf(key, layers);
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function booleanOf(
  key: keyof typeof dialogSettings.defs,
  layers: ScopeStack,
  fallback: boolean,
): boolean {
  const value = valueOf(key, layers);
  return typeof value === "boolean" ? value : fallback;
}

function stringsOf(
  key: keyof typeof dialogSettings.defs,
  layers: ScopeStack,
  fallback: readonly string[],
): readonly string[] {
  const value = valueOf(key, layers);
  if (!Array.isArray(value)) return fallback;
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return fallback;
    strings.push(item);
  }
  return strings;
}

/**
 * 파일 범위마다 `commands.dirs`를 따로 읽는다. 값이 가장 높은 범위 하나가 이기지 않고 범위마다 더해진다.
 * 범위가 있어야 저장소가 쓸 수 있는 범위(project, local)의 절대·홈 경로를 거를 수 있다
 */
function commandDirsOf(layers: ScopeStack): readonly CommandDirSetting[] {
  const key = "l2.dialog.commands.dirs";
  const dirs: CommandDirSetting[] = [];
  for (const layer of layers) {
    if (layer.scope !== "user" && layer.scope !== "project" && layer.scope !== "local") continue;
    const value = layer.values.get(key);
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.length > 0)
        dirs.push({ path: item, scope: layer.scope });
    }
  }
  return dirs;
}

function shellInjectionOf(layers: ScopeStack): ShellInjectionMode {
  const value = valueOf("commands.shellInjection", layers);
  return value === "off" ? "off" : "confirm";
}

function notifyKindsOf(
  layers: ScopeStack,
  fallback: DialogSettings["notify"]["kinds"],
): DialogSettings["notify"]["kinds"] {
  return {
    completed: booleanOf("notify.completed", layers, fallback.completed),
    approval_waiting: booleanOf("notify.approvalWaiting", layers, fallback.approval_waiting),
    question_waiting: booleanOf("notify.questionWaiting", layers, fallback.question_waiting),
    error: booleanOf("notify.error", layers, fallback.error),
    background_completed: booleanOf(
      "notify.backgroundCompleted",
      layers,
      fallback.background_completed,
    ),
  };
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readDialogSettings(layers: ScopeStack): DialogSettings {
  const fallback = DEFAULT_DIALOG_SETTINGS;
  return {
    ask: { timeoutSec: integerOf("ask.timeoutSec", layers, fallback.ask.timeoutSec) },
    commands: {
      dirs: commandDirsOf(layers),
      advertise: booleanOf("commands.advertise", layers, fallback.commands.advertise),
      shellInjection: shellInjectionOf(layers),
    },
    status: { segments: stringsOf("status.segments", layers, fallback.status.segments) },
    attachments: {
      maxBytes: integerOf("attachments.maxBytes", layers, fallback.attachments.maxBytes),
    },
    notify: {
      os: booleanOf("notify.os", layers, fallback.notify.os),
      kinds: notifyKindsOf(layers, fallback.notify.kinds),
    },
  };
}
