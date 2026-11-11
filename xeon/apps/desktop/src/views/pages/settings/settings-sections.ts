import { t, type MessageId } from "@fresnel/client/i18n";
import type { FieldVM, SettingsView } from "@fresnel/client/settings";
import type { SettingsTab } from "@fresnel/contracts/settings";

// 설정 화면의 구역과 항목이 드는 구역을 정하는 순수 모델. 설정 화면에는 이 앱만 줄 수 있는 것만 둔다.
// 턴당 최대 단계, 추론 매개변수, 예산처럼 모델 제공자나 플러그인이 정할 값은 화면에서 뺀다.
// 허용 목록 방식이다. `sectionOfField`의 목록에 없는 키는 모두 `null`이라 화면에서 빠진다(새 키가 생겨도 기본은 숨김).
// 뺀 항목의 엔진 키와 파일 값은 그대로이고, "파일로 보기" 편집기로는 계속 고칠 수 있다.

/** 구역 id. 엔진 탭 id를 그대로 쓰고 "connection"만 더한다. 모델·예산·샌드박스는 내비 구역이 아니고 그 항목은 다른 구역으로 옮긴다 */
export type SettingsSection = SettingsTab | "connection";

/** 내비에 그리는 구역. `SECTION_ORDER`의 원소다 */
export type ShownSettingsSection =
  | "overview"
  | "providers"
  | "secrets"
  | "permissions"
  | "tools"
  | "plugins"
  | "connection"
  | "execution"
  | "sessions"
  | "appearance"
  | "advanced";

/** 내비의 구역 순서. 빈 구역은 `sectionsShownOf`가 거른다(개요는 항상 보인다) */
export const SECTION_ORDER: readonly ShownSettingsSection[] = [
  "overview",
  "providers",
  "secrets",
  "permissions",
  "tools",
  "plugins",
  "connection",
  "execution",
  "sessions",
  "appearance",
  "advanced",
];

const SECTION_LABEL_ID: Readonly<Record<ShownSettingsSection, MessageId>> = {
  overview: "desktop.settings.section.overview",
  providers: "desktop.settings.section.providers",
  secrets: "desktop.settings.section.secrets",
  permissions: "desktop.settings.section.permissions",
  tools: "desktop.settings.section.tools",
  plugins: "desktop.settings.section.plugins",
  connection: "desktop.settings.section.connection",
  execution: "desktop.settings.section.execution",
  sessions: "desktop.settings.section.sessions",
  appearance: "desktop.settings.section.appearance",
  advanced: "desktop.settings.section.advanced",
};

/** 구역의 화면 이름. 엔진 탭 이름(`TAB_SPECS`)을 쓰지 않는다 */
export function sectionLabelOf(section: ShownSettingsSection): string {
  return t(SECTION_LABEL_ID[section]);
}

const SHOWN: readonly SettingsSection[] = SECTION_ORDER;

/** 내비에 그리는 구역인가. 옛 탭 이름인 모델, 예산, 샌드박스는 구역이 아니다 */
export function isShownSection(section: SettingsSection): section is ShownSettingsSection {
  return SHOWN.includes(section);
}

/** 모델과 계정 구역. 기본 모델과 허용·거부 모델은 옛 모델 탭에서, 계정과 제공자는 옛 제공자 탭에서 온다 */
const PROVIDER_KEYS: ReadonlySet<string> = new Set([
  "l1.models.default",
  "l1.models.allowedModels",
  "l1.models.deniedModels",
  "l1.models.accounts",
  "l1.models.providers",
]);

/** 시크릿 키 이름 앞부분과 그 가운데 임대 키의 앞부분. 임대 키는 허용 목록 밖이라 뺀다 */
const SECRET_PREFIX = "l0.secrets.";
const SECRET_LEASE_PREFIX = "l0.secrets.lease.";

/** 연결과 서비스 구역. 이 기기의 서비스 켜기와 원격 서비스 주소다 */
const CONNECTION_KEYS: ReadonlySet<string> = new Set([
  "l0.process.service.enabled",
  "l0.process.service.remote",
  // 원격 웹 게이트웨이와 호스트 서비스 한도도 연결과 서비스에 든다
  "l4.remote.web.enabled",
  "l4.remote.web.listen",
  "l4.remote.web.listenTls",
  "l4.remote.web.hosts",
  "l4.remote.web.tlsCert",
  "l4.remote.web.tlsKey",
]);

/** 권한과 샌드박스 구역에서 뺀 키. 검사 주기는 엔진이 정할 값이다 */
const PERMISSION_EXCLUDED_KEYS: ReadonlySet<string> = new Set(["l0.sandbox.selfTestIntervalMin"]);

/** 도구와 MCP 구역. 서버 표와 검색 순서는 도구 패널이 그린다(`panelOwnedOf`) */
const TOOLS_KEYS: ReadonlySet<string> = new Set([
  "l2.mcp.servers",
  "l2.mcp.allowedServers",
  "l2.mcp.deniedServers",
  "l2.mcp.managedOnly",
  "l2.mcp.approvalMode",
  "l2.mcp.importMcpJson",
  "l2.mcp.sandbox.projectSource",
  "l2.mcp.sandbox.userSource",
  "l2.web.policy.allow",
  "l2.web.policy.ask",
  "l2.web.policy.deny",
  "l2.web.policy.unseenUrl",
  "l2.web.policy.allowPrivateNetwork",
  "l2.web.policy.robots",
  "l2.web.search.order",
  "l2.web.browse.order",
  "l2.web.browse.allowFileUpload",
  "l2.web.browse.allowJavascriptExec",
  "l2.web.browse.allowNamedProfiles",
  "l2.dialog.commands.shellInjection",
]);

/** 플러그인 구역의 공통 항목. 확장 켜짐 스위치(`ext.<이름>.enabled`)는 키 모양으로 따로 고른다 */
const PLUGIN_KEYS: ReadonlySet<string> = new Set([
  "x.operations.hookDefs",
  "x.operations.hookOrder",
  "x.operations.hookDisabled",
  "x.operations.hookEnvAllow",
  "x.loading-trust.defaultProjectTrust",
  "x.loading-trust.paths",
  "x.ui.apps",
  "x.ui.allowProjectApps",
  "x.operations.safeMode.default",
  "x.operations.trace.enabled",
  "x.operations.trace.storeRequestBody",
  "l3.authoring.devMode",
]);

const EXECUTION_KEYS: ReadonlySet<string> = new Set([
  "l0.exec.shell",
  "l0.exec.envAllowlist.extra",
  "l0.process.lockFallback.default",
  "l2.schedule.entries.directCreate",
]);

const SESSION_KEYS: ReadonlySet<string> = new Set([
  "l1.persistence.retention.maxAgeDays",
  "l1.persistence.retention.maxCount",
  "l1.persistence.autoResume",
  "l2.knowledge.search.includeHiddenDefault",
  "l2.knowledge.memory.enabled",
  "l2.knowledge.skills.enabled",
  "l2.knowledge.search.enabled",
]);

const APPEARANCE_KEYS: ReadonlySet<string> = new Set([
  "l4.ui.locale",
  "l4.desktop.window.closeBehavior",
  "l2.dialog.status.segments",
  "l2.dialog.notify.backgroundCompleted",
]);

const ADVANCED_KEYS: ReadonlySet<string> = new Set([
  "l0.os.log.level",
  "l0.os.telemetry.enabled",
  "l0.os.dirs.override",
]);

const EXT_ENABLED_KEY = /^ext\.[^.]+\.enabled$/;

/** 확장 켜짐 키(`ext.<이름>.enabled`)인가. 플러그인 패널이 스위치로 그린다 */
export function isExtEnabledKey(key: string): boolean {
  return EXT_ENABLED_KEY.test(key);
}

/**
 * 항목이 드는 구역. 목록에 맞는 항목만 구역이 있고, 나머지는 `null`이라 화면에서 뺀다.
 * 순서가 중요하다. 모델과 계정 키, 시크릿 키, 연결 키가 먼저 정해지고, 권한·샌드박스 탭 항목이 그다음이다.
 */
export function sectionOfField(field: FieldVM): ShownSettingsSection | null {
  const key = field.key;
  if (PROVIDER_KEYS.has(key)) return "providers";
  // 임대 키는 시크릿 탭에 있어도 뺀다(허용 목록의 예외)
  if (key.startsWith(SECRET_LEASE_PREFIX)) return null;
  if (key.startsWith(SECRET_PREFIX) || field.tab === "secrets") return "secrets";
  if (CONNECTION_KEYS.has(key)) return "connection";
  if (field.tab === "permissions" || field.tab === "sandbox") {
    return PERMISSION_EXCLUDED_KEYS.has(key) ? null : "permissions";
  }
  if (TOOLS_KEYS.has(key)) return "tools";
  if (PLUGIN_KEYS.has(key) || isExtEnabledKey(key)) return "plugins";
  if (EXECUTION_KEYS.has(key)) return "execution";
  if (SESSION_KEYS.has(key)) return "sessions";
  if (APPEARANCE_KEYS.has(key)) return "appearance";
  if (ADVANCED_KEYS.has(key)) return "advanced";
  return null;
}

/** 구역에 드는 항목. 모든 탭의 항목을 탭 순서와 항목 순서대로 모은다 */
export function fieldsOfSection(
  view: SettingsView,
  section: ShownSettingsSection,
): readonly FieldVM[] {
  return view.tabs
    .flatMap((tab) => tab.fields)
    .filter((field) => sectionOfField(field) === section);
}

/**
 * 내비에 보일 구역. 개요는 항상 보인다. 나머지는 항목이 있거나 패널이 있는 구역만 남기고, 순서는 `SECTION_ORDER`다.
 * 값을 아직 못 읽었으면(`view`가 없음) 모든 구역을 보인다.
 */
export function sectionsShownOf(
  view: SettingsView | null,
  hasPanel: (section: ShownSettingsSection) => boolean,
): readonly ShownSettingsSection[] {
  if (view === null) return SECTION_ORDER;
  return SECTION_ORDER.filter(
    (section) =>
      section === "overview" || hasPanel(section) || fieldsOfSection(view, section).length > 0,
  );
}

/**
 * 설정 점프가 가리는 구역. 키가 구역에 드는 항목이면 그 구역이다(옛 탭 이름이 와도 맞는다). 아니면 탭 이름이 내비 구역이면 그 구역,
 * 둘 다 아니면 개요다.
 */
export function jumpSectionOf(
  jump: { readonly tab: SettingsSection; readonly key: string | null },
  view: SettingsView | null,
): ShownSettingsSection {
  const field =
    view === null || jump.key === null
      ? undefined
      : view.tabs.flatMap((tab) => tab.fields).find((candidate) => candidate.key === jump.key);
  const fromKey = field === undefined ? null : sectionOfField(field);
  if (fromKey !== null) return fromKey;
  if (isShownSection(jump.tab)) return jump.tab;
  return "overview";
}
