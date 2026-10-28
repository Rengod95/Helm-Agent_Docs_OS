import { AGENTS_SETTING_DEFS } from "@xeon/core-agents";
import { CONTEXT_SETTING_DEFS } from "@xeon/core-context";
import { MODELS_SETTING_DEFS } from "@xeon/core-models";
import { LOOP_SETTING_DEFS } from "@xeon/core-loop";
import { PERSISTENCE_SETTING_DEFS } from "@xeon/core-persistence";
import { tasksSettings } from "@xeon/core-tasks";
import { TOOLS_SETTING_DEFS } from "@xeon/core-tools";
import {
  buildCatalog,
  type CatalogGroupInput,
  type CatalogIssue,
  type SettingCatalog,
  type SettingDef,
  type SettingDefInput,
  type SettingGroup,
  type SettingNamespace,
} from "@xeon/contracts/settings";
import { DIALOG_SETTING_DEFS } from "@xeon/cap-dialog";
import { KNOWLEDGE_SETTING_DEFS } from "@xeon/cap-knowledge";
import { MCP_SETTING_DEFS } from "@xeon/cap-mcp";
import { WEB_SETTING_DEFS } from "@xeon/cap-web";
import { WORK_SETTING_DEFS } from "@xeon/cap-work";
import { WORKSPACE_SETTING_DEFS } from "@xeon/cap-workspace";
import { helmManifest, helmSettings } from "@xeon/group-helm";
import { learningSettings } from "@xeon/group-learning";
import { groupKitSettings } from "@xeon/group-kit";
import {
  loadingTrustSettings,
  operationsSettings,
  primitivesSettings,
  reservedExtensionSettings,
} from "@xeon/ext-host";
import { EXEC_SETTING_DEFS } from "@xeon/platform-exec";
import { OS_SETTING_DEFS } from "@xeon/platform-os";
import { PROCESS_SETTING_DEFS } from "@xeon/platform-process";
import { SANDBOX_SETTING_DEFS } from "@xeon/platform-sandbox";
import { SECRETS_SETTING_DEFS } from "@xeon/platform-secrets";
import { STORE_SETTING_DEFS } from "@xeon/platform-store";
import { hostSettings } from "../settings.ts";

// L4.host-service.spec §4.1 5단계. 모든 패키지의 설정 그룹을 한 카탈로그로 합친다. 이 파일은 assemble.ts의 일부다:
// 아래 층 패키지를 import하는 조립 루트 코드(DR-14 예외 2).

type AppGroup = SettingGroup<SettingNamespace, Readonly<Record<string, SettingDefInput>>>;

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
 * 외부 확장과 앱 설정을 뺀, 코어 패키지가 선언한 설정 그룹. `xeon config schema --core-only`와 schema/ 커밋본의 원천이다.
 * 선언을 아직 내놓지 않은 패키지의 키는 없다.
 */
export function coreSettingGroups(): readonly CatalogGroupInput[] {
  return [
    ofGroup("ext-host", primitivesSettings),
    ofGroup("ext-host", operationsSettings),
    ofGroup("ext-host", loadingTrustSettings),
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
    ofDefs("cap-dialog", "l2.dialog", DIALOG_SETTING_DEFS),
    ofGroup("group-kit", groupKitSettings),
    ofGroup("group-helm", helmSettings),
    ofGroup("group-learning", learningSettings),
    ofDefs("group-helm", "ext.helm", reservedExtensionSettings(helmManifest, "user").defs),
    ofGroup("host", hostSettings),
  ];
}

export type CatalogBuild =
  | { readonly ok: true; readonly catalog: SettingCatalog }
  | { readonly ok: false; readonly issues: readonly CatalogIssue[] };

/** 코어 그룹에 앱이 넘긴 그룹(l4.cli.* 등)을 더해 카탈로그를 만든다. 중복 키 같은 코어 문제는 시작 거부다 */
export function buildEngineCatalog(extra: readonly AppGroup[] = []): CatalogBuild {
  return buildCatalog([...coreSettingGroups(), ...extra.map((group) => ofGroup("app", group))]);
}
