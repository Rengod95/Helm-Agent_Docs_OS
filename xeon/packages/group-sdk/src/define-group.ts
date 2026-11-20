import { Bug, canonicalJson, parse } from "@fresnel/contracts";
import { checkOrchestrationName, ORCHESTRATION_NAME_PATTERN } from "@fresnel/contracts/services";
import { orchestrationOf } from "./util.ts";
import {
  isOrchestrationExtension,
  type CompositionDecl,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type ManifestIssue,
  type RegistrationDef,
} from "@fresnel/contracts/extensions";
import type { SettingDef, SettingGroup } from "@fresnel/contracts/settings";
import { stateUpcasters } from "./state.ts";
import type {
  OrchestrationDef,
  OrchestrationDefIssue,
  OrchestrationDefIssueCode,
  OrchestrationDefShape,
  OrchestrationManifest,
  OrchestrationModule,
  OrchestrationModuleSettings,
  OrchestrationSettingDefs,
  OrchestrationSettingNamespace,
  NoSettings,
} from "./types.ts";
import { realHostAccess, wrap } from "./wrap.ts";

export type {
  OrchestrationApi,
  OrchestrationDef,
  OrchestrationDefIssue,
  OrchestrationDefIssueCode,
  OrchestrationDefShape,
  OrchestrationManifest,
  OrchestrationModule,
  OrchestrationModuleSettings,
  OrchestrationSettingDefs,
  OrchestrationSettingNamespace,
  OrchestrationSettingValues,
  OrchestrationStartDriveResult,
  NoSettings,
  RunScriptOptions,
} from "./types.ts";
export type { StateMigrations } from "./state.ts";

export {
  checkOrchestrationName,
  ORCHESTRATION_NAME_PATTERN,
  RESERVED_ORCHESTRATION_NAMES,
  type OrchestrationNameError,
} from "@fresnel/contracts/services";

function isOrchestrationManifest(manifest: ExtensionManifest): manifest is OrchestrationManifest {
  return isOrchestrationExtension(manifest) && orchestrationOf(manifest) !== undefined;
}

/**
 * 매니페스트 값을 검증해 GroupManifest로 좁힌다. .fresnel-plugin/plugin.json을 JSON import로 읽은 외부 그룹이 쓴다.
 * F validateManifest 오류, `group` 선언이나 L3 플러그인이 없으면 Bug를 던진다. 순수 함수
 */
export function orchestrationManifest(value: unknown): OrchestrationManifest {
  const result = validateManifest(value);
  const errors = result.issues.filter((found) => found.severity === "error");
  if (result.manifest === undefined || errors.length > 0) {
    throw new Bug(
      `orchestrationManifest: invalid manifest: ${errors.map((found) => `${found.code} ${found.path}`).join(", ")}`,
    );
  }
  if (!isOrchestrationManifest(result.manifest)) {
    throw new Bug(
      `orchestrationManifest: ${result.manifest.name} needs a group declaration and a root plugin with layer L3 (orchestration_missing)`,
    );
  }
  return result.manifest;
}

// ── 정적 검증 ──────────────────────────────────────────────────────────────

function issue(
  code: OrchestrationDefIssueCode,
  path: string,
  message: string,
): OrchestrationDefIssue {
  return { severity: "error", code, path, message };
}

/** 순수 함수. validateManifest(F) 결과와 그룹 규칙을 함께 돌려준다 */
export function validateOrchestrationDef(
  def: OrchestrationDefShape,
): readonly (OrchestrationDefIssue | ManifestIssue)[] {
  const manifest = withComposition(def.manifest, def.composition);
  const found: (OrchestrationDefIssue | ManifestIssue)[] = [...validateManifest(manifest).issues];
  const declared = def.manifest.orchestration?.composition;
  if (
    def.composition !== undefined &&
    declared !== undefined &&
    canonicalJson(declared) !== canonicalJson(def.composition)
  ) {
    found.push(
      issue(
        "composition_conflict",
        "/composition",
        "def.composition differs from manifest.orchestration.composition: declare it in one place",
      ),
    );
  }

  if (!isOrchestrationManifest(manifest)) {
    found.push(
      issue(
        "orchestration_missing",
        "/manifest/orchestration",
        'a group manifest needs a group declaration and a root plugin (no id) with layer "L3"',
      ),
    );
  }
  if (!checkOrchestrationName(manifest.name).ok) {
    found.push(
      issue(
        "orchestration_name",
        "/manifest/name",
        `group name "${manifest.name}" must match ${ORCHESTRATION_NAME_PATTERN} and cannot be a reserved name`,
      ),
    );
  }
  if (def.settings !== undefined) {
    const expected =
      manifest.trust?.level === "builtin" ? `l3.${manifest.name}` : `ext.${manifest.name}`;
    if (def.settings.namespace !== expected) {
      found.push(
        issue(
          "settings_namespace",
          "/settings/namespace",
          `settings namespace must be ${expected} but is ${def.settings.namespace}`,
        ),
      );
    }
  }

  const { state, migrations } = def;
  if (state === undefined) {
    if (migrations !== undefined) {
      found.push(
        issue("state_version", "/migrations", "migrations need a state declaration to migrate"),
      );
    }
    return found;
  }
  if (!Number.isInteger(state.version) || state.version < 1) {
    found.push(
      issue("state_version", "/state/version", "state.version must be an integer of 1 or more"),
    );
  } else {
    for (let from = 1; from < state.version; from += 1) {
      if (migrations?.[from] === undefined) {
        found.push(
          issue(
            "state_migration_missing",
            `/migrations/${from}`,
            `state.version is ${state.version} but migrations[${from}] is missing`,
          ),
        );
      }
    }
  }
  if (!parse(state.schema, state.initial).ok) {
    found.push(
      issue("state_initial_invalid", "/state/initial", "state.initial does not match state.schema"),
    );
  }
  return found;
}

/** `def.composition`을 매니페스트 `group.composition`에 채운 사본. 선언이 없거나 `group`이 없으면 그대로다 */
function withComposition(
  manifest: ExtensionManifest,
  composition: CompositionDecl | undefined,
): ExtensionManifest {
  if (composition === undefined || manifest.orchestration === undefined) return manifest;
  return { ...manifest, orchestration: { ...manifest.orchestration, composition } };
}

/** defineGroup이 돌려준 객체. isGroupModule이 이 집합으로 판별한다 */
const builtGroups = new WeakSet<object>();

/** value가 이 모듈 인스턴스의 defineGroup이 만든 GroupModule이면 참이다. 같은 모양의 손으로 쓴 객체는 거짓이다 */
export function isOrchestrationModule(value: unknown): value is OrchestrationModule {
  return typeof value === "object" && value !== null && builtGroups.has(value);
}

/** 정의를 검증하고 GroupModule을 만든다. 오류가 있으면 Bug를 던진다(§3.3). setup은 실행하지 않는다 */
export function defineOrchestration<
  S = never,
  const D extends OrchestrationSettingDefs = NoSettings,
>(def: OrchestrationDef<S, D>): OrchestrationModule {
  const errors = validateOrchestrationDef(def).filter((found) => found.severity === "error");
  if (errors.length > 0) {
    throw new Bug(
      `defineOrchestration(${def.manifest.name}): ${errors.map((found) => `${found.code} ${found.path}`).join("; ")}`,
    );
  }
  // 구성 선언은 매니페스트 사본에 채운다(X-16). 매니페스트 상수 자체는 바꾸지 않는다
  const filled = withComposition(def.manifest, def.composition);
  if (!isOrchestrationManifest(filled)) {
    throw new Bug(`defineOrchestration(${def.manifest.name}): manifest is not a group manifest`);
  }
  const entry: ExtensionEntry = ({ register }) => {
    const registrationDef: RegistrationDef<S> = def.state === undefined ? {} : { state: def.state };
    register(def.manifest.name, registrationDef, (api) =>
      def.setup(wrap(api, def, realHostAccess)),
    );
  };
  const version = def.state?.version ?? 0;
  const group: OrchestrationModule = {
    manifest: filled,
    entry,
    ...(def.settings === undefined ? {} : { settings: settingsOf(def.settings) }),
    stateUpcasters: stateUpcasters(version, def.migrations),
    stateVersion: version,
  };
  builtGroups.add(group);
  return group;
}

function settingsOf<D extends OrchestrationSettingDefs>(
  group: SettingGroup<OrchestrationSettingNamespace, D>,
): OrchestrationModuleSettings {
  return { namespace: group.namespace, defs: Object.values<SettingDef>(group.defs) };
}
