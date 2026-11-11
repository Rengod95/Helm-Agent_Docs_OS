import type { MessageId } from "@fresnel/client/i18n";
import type { FieldVM } from "@fresnel/client/settings";
import type { SettingKey, SettingsTab } from "@fresnel/contracts/settings";
import {
  SETTINGS_SECTION_IDS,
  isSettingsSectionId,
  type SettingsJumpTarget,
  type SettingsSectionId,
} from "../../../state/ui/index.ts";

// 설정 화면의 구역 구성(L4.settings-ui §4.1.1 [결정: 2026-11-11 사용자]). 화면에 보이는 설정 키는 이 표에 적힌 것뿐이다.
// 엔진 정의의 `ui.tab`은 화면 배치에 쓰지 않는다. 표에 없는 키는 화면에 없고(엔진 키·파일 값은 그대로), "파일로 보기"로만 바꾼다.
// 판정 근거(남김·뺌)는 설계 노트 `cyZ-audit.md`에 있다. 구역마다 부분(part)이 차례로 놓이고, 부분은 제목 붙은 항목 카드이거나
// 자기 머리와 카드를 그리는 패널이다.

export type { SettingsSectionId };

/** 구역 묶음. 설정 내비에서 묶음 이름 아래에 구역이 놓인다 */
export type SettingsGroupId = "app" | "agent" | "engine";

/** 자기 머리와 카드를 그리는 패널(화면이 넣는다) */
export type SettingsPanelId =
  | "appearance"
  | "about"
  | "shortcuts"
  | "notify"
  | "rotation"
  | "secrets"
  | "trust"
  | "mcp"
  | "toolsWeb"
  | "plugins"
  | "memory"
  | "connection"
  | "backup"
  | "files";

export type SectionPart =
  | {
      readonly kind: "fields";
      /** 카드 머리. null이면 구역 이름을 낭독기 이름으로만 쓴다 */
      readonly title: MessageId | null;
      readonly keys: readonly SettingKey[];
    }
  | { readonly kind: "panel"; readonly panel: SettingsPanelId };

export interface SectionSpec {
  readonly id: SettingsSectionId;
  readonly group: SettingsGroupId;
  readonly label: MessageId;
  readonly parts: readonly SectionPart[];
}

const fields = (title: MessageId | null, keys: readonly SettingKey[]): SectionPart => ({
  kind: "fields",
  title,
  keys,
});
const panel = (id: SettingsPanelId): SectionPart => ({ kind: "panel", panel: id });

export const SETTINGS_GROUPS: readonly {
  readonly id: SettingsGroupId;
  readonly label: MessageId;
}[] = [
  { id: "app", label: "desktop.settings.group.app" },
  { id: "agent", label: "desktop.settings.group.agent" },
  { id: "engine", label: "desktop.settings.group.engine" },
];

export const SETTINGS_SECTIONS: Readonly<Record<SettingsSectionId, SectionSpec>> = {
  general: {
    id: "general",
    group: "app",
    label: "desktop.settings.section.general",
    parts: [
      fields("desktop.settings.part.languageWindow", [
        "l4.ui.locale",
        "l4.desktop.window.closeBehavior",
      ]),
      panel("appearance"),
      panel("about"),
    ],
  },
  shortcuts: {
    id: "shortcuts",
    group: "app",
    label: "desktop.settings.section.shortcuts",
    parts: [panel("shortcuts")],
  },
  notifications: {
    id: "notifications",
    group: "app",
    label: "desktop.settings.section.notifications",
    parts: [panel("notify")],
  },
  models: {
    id: "models",
    group: "agent",
    label: "desktop.settings.section.models",
    parts: [
      fields("desktop.settings.part.accounts", ["l1.models.accounts", "l1.models.providers"]),
      panel("rotation"),
      fields("desktop.settings.part.modelPolicy", [
        "l1.models.default",
        "l1.models.allowedModels",
        "l1.models.deniedModels",
      ]),
    ],
  },
  secrets: {
    id: "secrets",
    group: "agent",
    label: "desktop.settings.section.secrets",
    parts: [
      panel("secrets"),
      fields("desktop.settings.part.secretApproval", [
        "l0.secrets.approval.default",
        "l0.secrets.approval.writeHosts",
      ]),
    ],
  },
  permissions: {
    id: "permissions",
    group: "agent",
    label: "desktop.settings.section.permissions",
    parts: [
      fields("desktop.settings.part.approval", [
        "l1.tools.permissionMode",
        "l1.tools.bypassAllowed",
        "l1.tools.rules",
        "l1.tools.unattended.approval",
        "l1.tools.unattended.timeoutSeconds",
        "l2.work.plans.requireApproval",
        "l2.work.plans.exitOnApprove",
      ]),
      fields("desktop.settings.part.trust", ["x.loading-trust.defaultProjectTrust"]),
      panel("trust"),
      fields("desktop.settings.part.web", [
        "l2.web.policy.allow",
        "l2.web.policy.ask",
        "l2.web.policy.deny",
        "l2.web.policy.allowPrivateNetwork",
        "l2.web.policy.unseenUrl",
      ]),
    ],
  },
  sandbox: {
    id: "sandbox",
    group: "agent",
    label: "desktop.settings.section.sandbox",
    parts: [
      fields(null, [
        "l0.sandbox.enabled",
        "l0.sandbox.onUnavailable",
        "l0.sandbox.escapeRetry",
        "l0.sandbox.writeRoots.extra",
        "l0.sandbox.protectedPaths.extra",
        "l0.sandbox.network.blockedDomains",
        "l0.sandbox.credentialFiles",
        "l0.sandbox.nestedNamespaces",
      ]),
    ],
  },
  tools: {
    id: "tools",
    group: "agent",
    label: "desktop.settings.section.tools",
    parts: [
      panel("mcp"),
      fields("desktop.settings.part.mcpPolicy", [
        "l2.mcp.approvalMode",
        "l2.mcp.allowedServers",
        "l2.mcp.deniedServers",
        "l2.mcp.managedOnly",
        "l2.mcp.importMcpJson",
        "l2.mcp.sandbox.userSource",
        "l2.mcp.sandbox.projectSource",
      ]),
      panel("toolsWeb"),
      fields("desktop.settings.part.skills", [
        "l2.knowledge.skills.enabled",
        "l2.knowledge.skills.projectSkills",
        "l2.knowledge.skills.paths",
        "l2.dialog.commands.shellInjection",
      ]),
    ],
  },
  plugins: {
    id: "plugins",
    group: "agent",
    label: "desktop.settings.section.plugins",
    parts: [
      panel("plugins"),
      fields("desktop.settings.part.pluginSafety", [
        "x.ui.apps",
        "x.ui.allowProjectApps",
        "x.operations.safeMode.default",
        "x.operations.autoDisable.enabled",
        "x.loading-trust.paths",
      ]),
      fields("desktop.settings.part.hooks", [
        "x.operations.hookDefs",
        "x.operations.hookOrder",
        "x.operations.hookDisabled",
        "x.operations.hookEnvAllow",
      ]),
      fields("desktop.settings.part.developer", [
        "x.operations.trace.enabled",
        "x.operations.trace.storeRequestBody",
        "l3.authoring.devMode",
      ]),
    ],
  },
  sessions: {
    id: "sessions",
    group: "agent",
    label: "desktop.settings.section.sessions",
    parts: [
      fields("desktop.settings.part.retention", [
        "l1.persistence.retention.maxAgeDays",
        "l1.persistence.retention.maxCount",
        "l1.persistence.autoResume",
      ]),
      fields("desktop.settings.part.knowledge", [
        "l2.knowledge.memory.enabled",
        "l2.knowledge.search.enabled",
        "l2.knowledge.search.includeHiddenDefault",
        "l2.knowledge.write.approval",
      ]),
      panel("memory"),
    ],
  },
  connection: {
    id: "connection",
    group: "engine",
    label: "desktop.settings.section.connection",
    parts: [panel("connection")],
  },
  execution: {
    id: "execution",
    group: "engine",
    label: "desktop.settings.section.execution",
    parts: [
      fields("desktop.settings.part.shell", ["l0.exec.shell", "l0.exec.envAllowlist.extra"]),
      fields("desktop.settings.part.concurrency", [
        "l0.process.lockFallback.default",
        "l2.schedule.entries.directCreate",
      ]),
    ],
  },
  data: {
    id: "data",
    group: "engine",
    label: "desktop.settings.section.data",
    parts: [
      panel("backup"),
      panel("files"),
      fields("desktop.settings.part.logs", ["l0.os.log.level", "l0.os.telemetry.enabled"]),
    ],
  },
};

/** 화면에 보이는 키 전부와 그 구역. 같은 키가 두 구역에 들지 않는다(시험이 지킨다) */
export const SECTION_OF_KEY: ReadonlyMap<SettingKey, SettingsSectionId> = new Map(
  SETTINGS_SECTION_IDS.flatMap((id) =>
    SETTINGS_SECTIONS[id].parts.flatMap((part) =>
      part.kind === "fields" ? part.keys.map((key) => [key, id] as const) : [],
    ),
  ),
);

/** 옛 탭이 가리키던 구역. 옛 탭의 주된 내용이 옮겨 간 자리다 */
const SECTION_OF_TAB: Readonly<Record<SettingsTab, SettingsSectionId>> = {
  overview: "general",
  models: "models",
  budgets: "models",
  providers: "models",
  secrets: "secrets",
  permissions: "permissions",
  sandbox: "sandbox",
  sessions: "sessions",
  tools: "tools",
  plugins: "plugins",
  execution: "execution",
  appearance: "general",
  advanced: "data",
};

/**
 * 설정 점프가 열 구역. 키가 화면에 있으면 그 키의 구역이고, 아니면 받은 구역(옛 탭이면 그 탭이 옮겨 간 구역)이다.
 */
export function sectionOfJump(
  target: SettingsJumpTarget,
  key: SettingKey | null,
): SettingsSectionId {
  const byKey = key === null ? undefined : SECTION_OF_KEY.get(key);
  if (byKey !== undefined) return byKey;
  return isSettingsSectionId(target) ? target : SECTION_OF_TAB[target];
}

/** 구역을 내비 순서로. 묶음 순서 다음 구역 표 순서다 */
export const SECTION_ORDER: readonly SettingsSectionId[] = SETTINGS_GROUPS.flatMap((group) =>
  SETTINGS_SECTION_IDS.filter((id) => SETTINGS_SECTIONS[id].group === group.id),
);

/** 내비에서 한 칸 옮긴 구역. 끝에서 멈춘다 */
export function sectionStep(current: SettingsSectionId, delta: 1 | -1): SettingsSectionId {
  const index = SECTION_ORDER.indexOf(current);
  const next = SECTION_ORDER[Math.min(SECTION_ORDER.length - 1, Math.max(0, index + delta))];
  return next ?? current;
}

/** 키 하나의 항목을 view-model에서 찾는 표. 화면에 보이는 키만 담는다 */
export function shownFieldsOf(
  tabs: readonly { readonly fields: readonly FieldVM[] }[],
): ReadonlyMap<SettingKey, FieldVM> {
  const map = new Map<SettingKey, FieldVM>();
  for (const tab of tabs) {
    for (const field of tab.fields) {
      if (SECTION_OF_KEY.has(field.key)) map.set(field.key, field);
    }
  }
  return map;
}

/** 구역의 항목 부분을 view-model 항목으로 채운다. 값을 아직 모르는(정의가 없는) 키는 빠진다 */
export function partFieldsOf(
  part: Extract<SectionPart, { readonly kind: "fields" }>,
  shown: ReadonlyMap<SettingKey, FieldVM>,
): readonly FieldVM[] {
  return part.keys.flatMap((key) => {
    const field = shown.get(key);
    return field === undefined ? [] : [field];
  });
}

function matches(field: FieldVM, needle: string): boolean {
  return [field.label, field.key, field.help ?? ""].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

/** 찾기 결과 한 묶음: 구역 하나와 그 안에서 맞은 항목 */
export interface SectionMatch {
  readonly section: SettingsSectionId;
  readonly fields: readonly FieldVM[];
}

/**
 * 찾는 글이 이름·키·설명에 든 항목을 구역 순서로 묶는다. 화면에 보이는 키만 본다. 글이 비면 빈 목록이다.
 */
export function searchSectionsOf(
  shown: ReadonlyMap<SettingKey, FieldVM>,
  query: string,
): readonly SectionMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return SECTION_ORDER.flatMap((id) => {
    const found = SETTINGS_SECTIONS[id].parts.flatMap((part) =>
      part.kind === "fields" ? partFieldsOf(part, shown).filter((f) => matches(f, needle)) : [],
    );
    return found.length === 0 ? [] : [{ section: id, fields: found }];
  });
}

/**
 * 찾는 글이 구역 이름이나 그 구역 카드 머리에 든 구역(DP-86 [결정: 2026-11-11 사용자]). 항목 찾기는 스키마 항목만 보므로
 * 패널만 있는 구역(알림, 단축키)은 이름으로만 찾힌다. 결과 맨 위 "구역" 묶음이 이 목록이다. `text`는 문구 id를 화면 글로 바꾼다.
 */
export function sectionHitsOf(
  query: string,
  text: (id: MessageId) => string,
): readonly SettingsSectionId[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return SECTION_ORDER.filter((id) => {
    const spec = SETTINGS_SECTIONS[id];
    const titles = spec.parts.flatMap((part) =>
      part.kind === "fields" && part.title !== null ? [text(part.title)] : [],
    );
    return [text(spec.label), ...titles].some((hay) => hay.toLowerCase().includes(needle));
  });
}
