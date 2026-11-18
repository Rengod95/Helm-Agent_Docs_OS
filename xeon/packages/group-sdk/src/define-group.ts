import { Bug, canonicalJson, parse } from "@fresnel/contracts";
import { checkGroupName, GROUP_NAME_PATTERN } from "@fresnel/contracts/services";
import { orchestrationOf } from "./util.ts";
import {
  isGroupExtension,
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
  GroupDef,
  GroupDefIssue,
  GroupDefIssueCode,
  GroupDefShape,
  GroupManifest,
  GroupModule,
  GroupModuleSettings,
  GroupSettingDefs,
  GroupSettingNamespace,
  NoSettings,
} from "./types.ts";
import { realHostAccess, wrap } from "./wrap.ts";

export type {
  GroupApi,
  GroupDef,
  GroupDefIssue,
  GroupDefIssueCode,
  GroupDefShape,
  GroupManifest,
  GroupModule,
  GroupModuleSettings,
  GroupSettingDefs,
  GroupSettingNamespace,
  GroupSettingValues,
  GroupStartDriveResult,
  NoSettings,
} from "./types.ts";
export type { StateMigrations } from "./state.ts";

export {
  checkGroupName,
  GROUP_NAME_PATTERN,
  RESERVED_GROUP_NAMES,
  type GroupNameError,
} from "@fresnel/contracts/services";

function isGroupManifest(manifest: ExtensionManifest): manifest is GroupManifest {
  return isGroupExtension(manifest) && orchestrationOf(manifest) !== undefined;
}

/**
 * 매니페스트 값을 검증해 GroupManifest로 좁힌다. .fresnel-plugin/plugin.json을 JSON import로 읽은 외부 그룹이 쓴다.
 * F validateManifest 오류, `group` 선언이나 L3 플러그인이 없으면 Bug를 던진다. 순수 함수
 */
export function groupManifest(value: unknown): GroupManifest {
  const result = validateManifest(value);
  const errors = result.issues.filter((found) => found.severity === "error");
  if (result.manifest === undefined || errors.length > 0) {
    throw new Bug(
      `groupManifest: invalid manifest: ${errors.map((found) => `${found.code} ${found.path}`).join(", ")}`,
    );
  }
  if (!isGroupManifest(result.manifest)) {
    throw new Bug(
      `groupManifest: ${result.manifest.name} needs a group declaration and a root plugin with layer L3 (group_missing_orchestration)`,
    );
  }
  return result.manifest;
}

// ── 정적 검증 ──────────────────────────────────────────────────────────────

function issue(code: GroupDefIssueCode, path: string, message: string): GroupDefIssue {
  return { severity: "error", code, path, message };
}

/** 순수 함수. validateManifest(F) 결과와 그룹 규칙을 함께 돌려준다 */
export function validateGroupDef(def: GroupDefShape): readonly (GroupDefIssue | ManifestIssue)[] {
  const manifest = withComposition(def.manifest, def.composition);
  const found: (GroupDefIssue | ManifestIssue)[] = [...validateManifest(manifest).issues];
  const declared = def.manifest.group?.composition;
  if (
    def.composition !== undefined &&
    declared !== undefined &&
    canonicalJson(declared) !== canonicalJson(def.composition)
  ) {
    found.push(
      issue(
        "composition_conflict",
        "/composition",
        "def.composition differs from manifest.group.composition: declare it in one place",
      ),
    );
  }

  if (!isGroupManifest(manifest)) {
    found.push(
      issue(
        "group_missing_orchestration",
        "/manifest/group",
        'a group manifest needs a group declaration and a root plugin (no id) with layer "L3"',
      ),
    );
  }
  if (!checkGroupName(manifest.name).ok) {
    found.push(
      issue(
        "group_name",
        "/manifest/name",
        `group name "${manifest.name}" must match ${GROUP_NAME_PATTERN} and cannot be a reserved name`,
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
  if (composition === undefined || manifest.group === undefined) return manifest;
  return { ...manifest, group: { ...manifest.group, composition } };
}

/** defineGroup이 돌려준 객체. isGroupModule이 이 집합으로 판별한다 */
const builtGroups = new WeakSet<object>();

/** value가 이 모듈 인스턴스의 defineGroup이 만든 GroupModule이면 참이다. 같은 모양의 손으로 쓴 객체는 거짓이다 */
export function isGroupModule(value: unknown): value is GroupModule {
  return typeof value === "object" && value !== null && builtGroups.has(value);
}

/** 정의를 검증하고 GroupModule을 만든다. 오류가 있으면 Bug를 던진다(§3.3). setup은 실행하지 않는다 */
export function defineGroup<S = never, const D extends GroupSettingDefs = NoSettings>(
  def: GroupDef<S, D>,
): GroupModule {
  const errors = validateGroupDef(def).filter((found) => found.severity === "error");
  if (errors.length > 0) {
    throw new Bug(
      `defineGroup(${def.manifest.name}): ${errors.map((found) => `${found.code} ${found.path}`).join("; ")}`,
    );
  }
  // 구성 선언은 매니페스트 사본에 채운다(X-16). 매니페스트 상수 자체는 바꾸지 않는다
  const filled = withComposition(def.manifest, def.composition);
  if (!isGroupManifest(filled)) {
    throw new Bug(`defineGroup(${def.manifest.name}): manifest is not a group manifest`);
  }
  const entry: ExtensionEntry = ({ register }) => {
    const registrationDef: RegistrationDef<S> = def.state === undefined ? {} : { state: def.state };
    register(def.manifest.name, registrationDef, (api) =>
      def.setup(wrap(api, def, realHostAccess)),
    );
  };
  const version = def.state?.version ?? 0;
  const group: GroupModule = {
    manifest: filled,
    entry,
    ...(def.settings === undefined ? {} : { settings: settingsOf(def.settings) }),
    stateUpcasters: stateUpcasters(version, def.migrations),
    stateVersion: version,
  };
  builtGroups.add(group);
  return group;
}

function settingsOf<D extends GroupSettingDefs>(
  group: SettingGroup<GroupSettingNamespace, D>,
): GroupModuleSettings {
  return { namespace: group.namespace, defs: Object.values<SettingDef>(group.defs) };
}
