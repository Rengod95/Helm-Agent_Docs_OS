import { Bug, err, ok, parse, type Result } from "@xeon/contracts";
import {
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type ManifestIssue,
  type ScopeDef,
} from "@xeon/contracts/extensions";
import type { SettingDef, SettingGroup } from "@xeon/contracts/settings";
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
 * RESERVED_EXT_IDS(eng.context-map §5.4), F.extensions.spec §4.7 name_reserved의 grp·x·xeon,
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
  "xeon",
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
  return manifest.kind === "group" && manifest.layer === "L3";
}

/**
 * 매니페스트 값을 검증해 GroupManifest로 좁힌다. .xeon-plugin/plugin.json을 JSON import로 읽은 외부 그룹이 쓴다.
 * F validateManifest 오류, kind·layer 불일치면 Bug를 던진다. 순수 함수
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
      `groupManifest: ${result.manifest.name} must be kind "group" and layer "L3" (group_kind)`,
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
  const found: (GroupDefIssue | ManifestIssue)[] = [...validateManifest(def.manifest).issues];
  const { manifest } = def;

  if (manifest.kind !== "group" || manifest.layer !== "L3") {
    found.push(
      issue("group_kind", "/manifest/kind", 'a group manifest needs kind "group" and layer "L3"'),
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
  const entry: ExtensionEntry = ({ scope }) => {
    const scopeDef: ScopeDef<S> = def.state === undefined ? {} : { state: def.state };
    scope(def.manifest.name, scopeDef, (api) => def.setup(wrap(api, def, realHostAccess)));
  };
  const version = def.state?.version ?? 0;
  return {
    manifest: def.manifest,
    entry,
    ...(def.settings === undefined ? {} : { settings: settingsOf(def.settings) }),
    stateUpcasters: stateUpcasters(version, def.migrations),
    stateVersion: version,
  };
}

function settingsOf<D extends GroupSettingDefs>(
  group: SettingGroup<GroupSettingNamespace, D>,
): GroupModuleSettings {
  return { namespace: group.namespace, defs: Object.values<SettingDef>(group.defs) };
}
