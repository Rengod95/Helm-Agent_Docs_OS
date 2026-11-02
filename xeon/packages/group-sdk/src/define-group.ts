import { Bug, canonicalJson, err, ok, parse, type Result } from "@fresnel/contracts";
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
  NoSettings,
} from "./types.ts";
export type { StateMigrations } from "./state.ts";

/** 확장 id 규칙(review.decisions-2 U-18). 소문자, 숫자, 하이픈. 밑줄은 쓰지 않는다 */
export const GROUP_NAME_PATTERN: string = "^[a-z][a-z0-9-]{1,31}$";

/**
 * 그룹 이름 예약 목록의 정본. 네 묶음을 합친다.
 * RESERVED_EXT_IDS(eng.context-map §5.4), F.extensions.spec §4.7 name_reserved의 grp·x·fresnel,
 * L2 도메인 이름(_routing/routes.yaml layout L2), 그룹 명령·설정 값과 겹치는 이름.
 * 설치된 확장 이름과의 충돌은 이 상수에 넣지 않는다. validateManifestSet의 name_conflict로 거부한다.
 */
export const RESERVED_GROUP_NAMES: readonly string[] = [
  "core",
  "cap",
  "xh",
  "sys",
  "p",
  "ext",
  "x",
  "grp",
  "fresnel",
  "workspace",
  "mcp",
  "web",
  "knowledge",
  "work",
  "dialog",
  "artifacts",
  "schedule",
  "auto",
  "all",
  "none",
  "group",
  "groups",
  "kit",
];

/** checkGroupName이 돌려주는 실패. reason은 이름 형식 위반(pattern)인지 예약 이름인지(reserved)를 가른다 */
export interface GroupNameError {
  readonly kind: "group_name";
  readonly reason: "pattern" | "reserved";
  readonly name: string;
}

const GROUP_NAME_REGEX = new RegExp(GROUP_NAME_PATTERN);

/**
 * 그룹 이름을 검사한다(L3.slots.spec §3.3.4, 규칙 R2). GROUP_NAME_PATTERN과 RESERVED_GROUP_NAMES만 쓴다.
 * 설치된 확장 이름과의 충돌은 여기서 보지 않는다(validateManifestSet의 name_conflict). 순수 함수다
 */
export function checkGroupName(name: string): Result<string, GroupNameError> {
  if (!GROUP_NAME_REGEX.test(name)) return err({ kind: "group_name", reason: "pattern", name });
  if (RESERVED_GROUP_NAMES.includes(name))
    return err({ kind: "group_name", reason: "reserved", name });
  return ok(name);
}

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
