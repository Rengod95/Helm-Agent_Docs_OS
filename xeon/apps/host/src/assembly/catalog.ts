import { defineManifest } from "@fresnel/contracts/extensions";
import { AGENTS_SETTING_DEFS } from "@fresnel/core-agents";
import { CONTEXT_SETTING_DEFS } from "@fresnel/core-context";
import { MODELS_SETTING_DEFS } from "@fresnel/core-models";
import { LOOP_SETTING_DEFS } from "@fresnel/core-loop";
import { PERSISTENCE_SETTING_DEFS } from "@fresnel/core-persistence";
import { tasksSettings } from "@fresnel/core-tasks";
import { TOOLS_SETTING_DEFS } from "@fresnel/core-tools";
import {
  buildCatalog,
  type CatalogGroupInput,
  type CatalogIssue,
  type SettingCatalog,
  type SettingDef,
  type SettingDefInput,
  type SettingGroup,
  type SettingNamespace,
} from "@fresnel/contracts/settings";
import { DIALOG_SETTING_DEFS } from "@fresnel/cap-dialog";
import { SCHEDULE_SETTING_DEFS } from "@fresnel/cap-schedule";
import { KNOWLEDGE_SETTING_DEFS } from "@fresnel/cap-knowledge";
import { ARTIFACTS_SETTING_DEFS } from "@fresnel/cap-artifacts";
import { MCP_SETTING_DEFS } from "@fresnel/cap-mcp";
import { WEB_SETTING_DEFS } from "@fresnel/cap-web";
import { WORK_SETTING_DEFS } from "@fresnel/cap-work";
import { WORKSPACE_SETTING_DEFS } from "@fresnel/cap-workspace";
import { accountRotationManifest, accountRotationSettings } from "@fresnel/group-account-rotation";
import { helmManifest, helmSettings } from "@fresnel/group-helm";
import { learningManifest, learningSettings } from "@fresnel/group-learning";
import {
  providerAnthropicOauthManifest,
  providerAnthropicOauthSettings,
} from "@fresnel/group-provider-anthropic-oauth";
import { groupSdkSettings } from "@fresnel/group-sdk";
import {
  loadingTrustSettings,
  operationsSettings,
  primitivesSettings,
  reservedExtensionSettings,
  uiSettings,
} from "@fresnel/ext-host";
import { EXEC_SETTING_DEFS } from "@fresnel/platform-exec";
import { OS_SETTING_DEFS } from "@fresnel/platform-os";
import { PROCESS_SETTING_DEFS } from "@fresnel/platform-process";
import { SANDBOX_SETTING_DEFS } from "@fresnel/platform-sandbox";
import { SECRETS_SETTING_DEFS } from "@fresnel/platform-secrets";
import { STORE_SETTING_DEFS } from "@fresnel/platform-store";
import { authoringManifest, authoringSettings } from "@fresnel/plugin-builder";
import { hostSettings } from "../settings.ts";

// L4.host-service.spec §4.1 5단계. 모든 패키지의 설정 그룹을 한 카탈로그로 합친다. 이 파일은 assemble.ts의 일부다:
// 아래 층 패키지를 import하는 조립 루트 코드(DR-14 예외 2).

type AppGroup = SettingGroup<SettingNamespace, Readonly<Record<string, SettingDefInput>>>;

/** 호스트가 싣는 내장 확장 단위(`builtinUnits`)의 이름, 표시 이름, 층. 예약 키 `ext.<이름>.enabled`를 정적 카탈로그에 올리는 데 쓴다 */
const BUILTIN_EXTENSIONS: readonly {
  readonly name: string;
  readonly displayName: string;
  readonly layer: "L1" | "L2" | "plugin";
}[] = [
  { name: "core-persistence", displayName: "Session persistence", layer: "L1" },
  { name: "core-tasks", displayName: "Task engine", layer: "L1" },
  { name: "core-models", displayName: "Model gateway", layer: "L1" },
  { name: "core-context", displayName: "Context", layer: "L1" },
  { name: "core-tools", displayName: "Tool runtime", layer: "L1" },
  { name: "core-loop", displayName: "Agent loop", layer: "L1" },
  { name: "host-groups", displayName: "Group service", layer: "plugin" },
  { name: "core-agents", displayName: "Subagents", layer: "L1" },
  { name: "cap-workspace", displayName: "Workspace tools", layer: "L2" },
  { name: "cap-dialog", displayName: "Dialog", layer: "L2" },
  { name: "cap-artifacts", displayName: "Artifacts and reviews", layer: "L2" },
  { name: "host-dialog-bridge", displayName: "Dialog bridge", layer: "L2" },
  { name: "cap-work", displayName: "Work management", layer: "L2" },
  { name: "cap-mcp", displayName: "MCP client", layer: "L2" },
  { name: "cap-web", displayName: "Web tools", layer: "L2" },
  { name: "cap-knowledge", displayName: "Knowledge and memory", layer: "L2" },
  { name: "host-dialog-area-bridge", displayName: "Dialog area bridge", layer: "L2" },
  { name: "host-proposals-bridge", displayName: "Proposals bridge", layer: "L2" },
  { name: "cap-schedule", displayName: "Schedules", layer: "L2" },
];

/** 내장 확장의 예약 키 그룹. 파일 스키마, `config list`, 설정 화면이 같은 키 집합을 보도록 정적 카탈로그에 넣는다(X10) */
function builtinExtensionKeyGroups(): readonly CatalogGroupInput[] {
  const manifests = [
    ...BUILTIN_EXTENSIONS.map((unit) =>
      defineManifest({
        schemaVersion: 2,
        name: unit.name,
        version: "0.1.0",
        displayName: unit.displayName,
        description: unit.displayName,
        entry: "./src/index.ts",
        trust: { level: "builtin" },
        plugins: [{ layer: unit.layer === "plugin" ? "plugin" : unit.layer, hooks: [] }],
      }),
    ),
    // 설정 정의의 label은 영어 대체 문구다(한글은 locale 카탈로그에만 둔다)
    { ...learningManifest, displayName: "Learning" },
    authoringManifest,
  ];
  return manifests.map((manifest) => {
    const group = reservedExtensionSettings(manifest, "builtin");
    return ofDefs("builtin-extensions", group.namespace, group.defs);
  });
}

function ofGroup(owner: string, group: AppGroup): CatalogGroupInput {
  return { owner, namespace: group.namespace, defs: Object.values<SettingDef>(group.defs) };
}

function ofDefs(
  owner: string,
  namespace: SettingNamespace,
  defs: readonly SettingDef[],
): CatalogGroupInput {
  return { owner, namespace, defs };
}

/**
 * 외부 확장과 앱 설정을 뺀, 코어 패키지가 선언한 설정 그룹. `fresnel config schema --core-only`와 schema/ 커밋본의 원천이다.
 * 선언을 아직 내놓지 않은 패키지의 키는 없다.
 */
export function coreSettingGroups(): readonly CatalogGroupInput[] {
  return [
    ofGroup("ext-host", primitivesSettings),
    ofGroup("ext-host", operationsSettings),
    ofGroup("ext-host", loadingTrustSettings),
    ofGroup("ext-host", uiSettings),
    ofDefs("platform-os", "l0.os", OS_SETTING_DEFS),
    ofDefs("platform-store", "l0.store", STORE_SETTING_DEFS),
    ofDefs("platform-exec", "l0.exec", EXEC_SETTING_DEFS),
    ofDefs("platform-secrets", "l0.secrets", SECRETS_SETTING_DEFS),
    ofDefs("platform-process", "l0.process", PROCESS_SETTING_DEFS),
    ofDefs("platform-sandbox", "l0.sandbox", SANDBOX_SETTING_DEFS),
    ofDefs("core-persistence", "l1.persistence", PERSISTENCE_SETTING_DEFS),
    ofDefs("core-tools", "l1.tools", TOOLS_SETTING_DEFS),
    ofDefs("core-context", "l1.context", CONTEXT_SETTING_DEFS),
    ofDefs("core-agents", "l1.agents", AGENTS_SETTING_DEFS),
    ofDefs("core-models", "l1.models", MODELS_SETTING_DEFS),
    ofDefs("core-loop", "l1.loop", LOOP_SETTING_DEFS),
    ofGroup("core-tasks", tasksSettings),
    ofDefs("cap-workspace", "l2.workspace", WORKSPACE_SETTING_DEFS),
    ofDefs("cap-web", "l2.web", WEB_SETTING_DEFS),
    ofDefs("cap-knowledge", "l2.knowledge", KNOWLEDGE_SETTING_DEFS),
    ofDefs("cap-mcp", "l2.mcp", MCP_SETTING_DEFS),
    ofDefs("cap-work", "l2.work", WORK_SETTING_DEFS),
    ofDefs("cap-artifacts", "l2.artifacts", ARTIFACTS_SETTING_DEFS),
    ofDefs("cap-dialog", "l2.dialog", DIALOG_SETTING_DEFS),
    ofDefs("cap-schedule", "l2.schedule", SCHEDULE_SETTING_DEFS),
    ofGroup("group-sdk", groupSdkSettings),
    ofGroup("group-helm", helmSettings),
    ofGroup("group-learning", learningSettings),
    ofDefs("group-helm", "ext.helm", reservedExtensionSettings(helmManifest, "user").defs),
    // 기본 꺼짐 계정 회전 플러그인(기본 플러그인 목록에 든다). 예약 키 enabled·isolation은 X.loading-trust §4.5.2가 정한 모양이다
    ofGroup("group-account-rotation", accountRotationSettings),
    ofDefs(
      "group-account-rotation",
      "ext.account-rotation",
      reservedExtensionSettings(accountRotationManifest, "user").defs,
    ),
    // 위장 provider 플러그인(기본 꺼짐, 기본 목록에 없다). 키가 카탈로그에 없으면 설정 쓰기가 settings.unknownKey로 거부된다
    ofGroup("group-provider-anthropic-oauth", providerAnthropicOauthSettings),
    ofDefs(
      "group-provider-anthropic-oauth",
      "ext.provider-anthropic-oauth",
      reservedExtensionSettings(providerAnthropicOauthManifest, "user").defs,
    ),
    // 제작 그룹의 설정(개발 모드, 기본 꺼짐). 소유는 plugin-builder다(L3.authoring.spec §6)
    ofGroup("plugin-builder", authoringSettings),
    ofGroup("host", hostSettings),
    ...builtinExtensionKeyGroups(),
  ];
}

export type CatalogBuild =
  | { readonly ok: true; readonly catalog: SettingCatalog }
  | { readonly ok: false; readonly issues: readonly CatalogIssue[] };

/** 코어 그룹에 앱이 넘긴 그룹(l4.cli.* 등)을 더해 카탈로그를 만든다. 중복 키 같은 코어 문제는 시작 거부다 */
export function buildEngineCatalog(extra: readonly AppGroup[] = []): CatalogBuild {
  return buildCatalog([...coreSettingGroups(), ...extra.map((group) => ofGroup("app", group))]);
}
