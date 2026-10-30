import type { NoticeKind } from "@xeon/contracts/capabilities";
import { Type } from "typebox";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
} from "@xeon/contracts/settings";

// L2.dialog.spec §6. 13개 키를 모두 선언한다(plan D8). notify.*는 OS 전달(§4.7.2)이 읽고, styles.active는 2차 기능이 읽을 때까지 선언만 있다.

const FILE_SCOPES = ["managed", "user", "project", "local"] as const;
const USER_PROJECT = ["user", "project", "local"] as const;
const USER_PROJECT_SESSION = ["user", "project", "local", "session"] as const;

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
      label: "질문 기본 시간 제한",
      help: "0이면 제한 없음",
      unit: "초",
    },
    since: "0.1.0",
  },
  "commands.dirs": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 64 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: USER_PROJECT,
    ui: { tab: "tools", widget: "list", order: 301, label: "추가 명령 디렉터리" },
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
      label: "모델에 명령 목록 알림",
      help: "명령 이름과 설명을 시스템 프롬프트에 붙여 모델이 사용자에게 명령을 권할 수 있게 한다",
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
      label: "명령 템플릿의 셸 주입",
      help: "confirm은 실행 전에 확인하고, off는 막는다",
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
      label: "상태줄에 보일 항목",
      help: "id나 접두 패턴(끝이 *). 항목 *는 앞에서 고르지 않은 모든 항목",
    },
    since: "0.1.0",
  },
  "attachments.maxBytes": {
    type: Type.Integer(),
    default: 20971520,
    range: { min: 1024, max: 104857600 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: { tab: "tools", widget: "number", order: 320, label: "첨부 하나의 최대 크기", unit: "B" },
    since: "0.1.0",
  },
  "styles.active": {
    type: Type.String({ maxLength: 32 }),
    default: "default",
    runtimeChange: "nextTurn",
    allowedScopes: USER_PROJECT_SESSION,
    ui: { tab: "appearance", widget: "text", order: 330, label: "출력 스타일" },
    since: "0.1.0",
  },
  "notify.os": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: ["user"],
    ui: { tab: "execution", widget: "toggle", order: 340, label: "OS 알림" },
    since: "0.1.0",
  },
  "notify.completed": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 341, label: "작업 완료 알림" },
    since: "0.1.0",
  },
  "notify.approvalWaiting": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 342, label: "승인 대기 알림" },
    since: "0.1.0",
  },
  "notify.questionWaiting": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 343, label: "질문 대기 알림" },
    since: "0.1.0",
  },
  "notify.error": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 344, label: "오류 알림" },
    since: "0.1.0",
  },
  "notify.backgroundCompleted": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    allowedScopes: USER_PROJECT,
    ui: { tab: "execution", widget: "toggle", order: 345, label: "백그라운드 작업 완료 알림" },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const DIALOG_SETTING_DEFS: readonly SettingDef[] = Object.values(dialogSettings.defs);

type ShellInjectionMode = (typeof SHELL_INJECTION_MODES)[number];

/** 호출 한 번이 읽는 유효 설정. 이 패키지가 읽는 키만 담는다(styles.active는 2차 기능이 읽는다) */
export interface DialogSettings {
  readonly ask: { readonly timeoutSec: number };
  readonly commands: {
    readonly dirs: readonly string[];
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
      dirs: stringsOf("commands.dirs", layers, fallback.commands.dirs),
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
