import { Bug, canonicalJson, parse } from "@fresnel/contracts";
import { checkOrchestrationName, ORCHESTRATION_NAME_PATTERN } from "@fresnel/contracts/services";
import { orchestrationOf } from "./util.ts";
import {
  isOrchestrationExtension,
  pluginsOf,
  registrationIdOf,
  type CompositionDecl,
  validateManifest,
  type ExtensionEntry,
  type ExtensionManifest,
  type ManifestIssue,
  type PluginDecl,
  type RegistrationDef,
  type StateDecl,
} from "@fresnel/contracts/extensions";
import type { SettingDef, SettingGroup } from "@fresnel/contracts/settings";
import { stateUpcasters, type StateMigrations } from "./state.ts";
import type {
  OrchestrationDef,
  OrchestrationDefIssue,
  OrchestrationDefIssueCode,
  OrchestrationDefShape,
  OrchestrationManifest,
  OrchestrationMember,
  OrchestrationMemberDef,
  OrchestrationMemberShape,
  OrchestrationModule,
  OrchestrationModuleSettings,
  OrchestrationSettingDefs,
  OrchestrationSettingNamespace,
  NoSettings,
  PluginDef,
  PluginModule,
} from "./types.ts";
import { realHostAccess, wrap, type WrapDef } from "./wrap.ts";

export type {
  OrchestrationApi,
  OrchestrationDef,
  OrchestrationDefIssue,
  OrchestrationDefIssueCode,
  OrchestrationDefShape,
  OrchestrationManifest,
  OrchestrationMember,
  OrchestrationMemberDef,
  OrchestrationMemberShape,
  OrchestrationModule,
  OrchestrationModuleSettings,
  OrchestrationStartDriveResult,
  PluginDef,
  PluginModule,
  OrchestrationSettingDefs,
  OrchestrationSettingNamespace,
  OrchestrationSettingValues,
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
 * 매니페스트 값을 검증해 OrchestrationManifest로 좁힌다. .fresnel-plugin/plugin.json을 JSON import로 읽은 외부 플러그인이 쓴다.
 * F validateManifest 오류, `orchestration` 선언이나 L3 루트 플러그인이 없으면 Bug를 던진다. 순수 함수
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
      `orchestrationManifest: ${result.manifest.name} needs an orchestration declaration and a root plugin with layer L3 (orchestration_missing)`,
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

/**
 * 구성원 플러그인 목록(plugins[] 순서). id가 있는 플러그인이고, `orchestration.members`가 있으면 그 안에 든 것만이다.
 * 뿌리 플러그인(id 없음)은 구성원이 아니다
 */
function membersOf(
  manifest: ExtensionManifest,
): readonly { readonly id: string; readonly decl: PluginDecl }[] {
  return pluginsOf(manifest).flatMap((entry) =>
    entry.decl.id === undefined || !entry.inOrchestration
      ? []
      : [{ id: entry.decl.id, decl: entry.decl }],
  );
}

/**
 * 상태 선언 검사. 뿌리는 prefix가 ""이고 구성원은 "/members/<id>"다. 두 자리가 같은 규칙을 쓴다.
 * state가 없는데 migrations가 있으면 `state_version`이다
 */
function stateIssuesOf(
  prefix: string,
  state: StateDecl<unknown> | undefined,
  migrations: StateMigrations | undefined,
): OrchestrationDefIssue[] {
  if (state === undefined) {
    return migrations === undefined
      ? []
      : [
          issue(
            "state_version",
            `${prefix}/migrations`,
            "migrations need a state declaration to migrate",
          ),
        ];
  }
  const found: OrchestrationDefIssue[] = [];
  if (!Number.isInteger(state.version) || state.version < 1) {
    found.push(
      issue(
        "state_version",
        `${prefix}/state/version`,
        "state.version must be an integer of 1 or more",
      ),
    );
  } else {
    for (let from = 1; from < state.version; from += 1) {
      if (migrations?.[from] === undefined) {
        found.push(
          issue(
            "state_migration_missing",
            `${prefix}/migrations/${from}`,
            `state.version is ${state.version} but migrations[${from}] is missing`,
          ),
        );
      }
    }
  }
  if (!parse(state.schema, state.initial).ok) {
    found.push(
      issue(
        "state_initial_invalid",
        `${prefix}/state/initial`,
        "state.initial does not match state.schema",
      ),
    );
  }
  return found;
}

/**
 * 구성원 검사. 정의의 키는 구성원 id여야 하고(member_unknown), 매니페스트가 선언한 구성원마다 정의가 있어야 한다(member_missing).
 * 정의가 있는 구성원은 뿌리와 같은 상태 규칙을 받는다(경로 `/members/<id>/...`)
 */
function memberIssuesOf(
  manifest: ExtensionManifest,
  members: Readonly<Record<string, OrchestrationMemberShape>> | undefined,
): OrchestrationDefIssue[] {
  const declared = membersOf(manifest).map((member) => member.id);
  const defined: Readonly<Record<string, OrchestrationMemberShape>> = members ?? {};
  const found: OrchestrationDefIssue[] = [];
  for (const [id, member] of Object.entries(defined)) {
    const path = `/members/${id}`;
    if (!declared.includes(id)) {
      found.push(
        issue("member_unknown", path, `member ${id} is not a member plugin of the manifest`),
      );
      continue;
    }
    found.push(...stateIssuesOf(path, member.state, member.migrations));
  }
  for (const id of declared) {
    if (defined[id] === undefined) {
      found.push(
        issue(
          "member_missing",
          `/members/${id}`,
          `member ${id} is declared in the manifest but has no definition in members`,
        ),
      );
    }
  }
  return found;
}

/** 순수 함수. validateManifest(F) 결과와 플러그인 규칙을 함께 돌려준다 */
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
        'an orchestration manifest needs an orchestration declaration and a root plugin (no id) with layer "L3"',
      ),
    );
  }
  if (!checkOrchestrationName(manifest.name).ok) {
    found.push(
      issue(
        "orchestration_name",
        "/manifest/name",
        `plugin name "${manifest.name}" must match ${ORCHESTRATION_NAME_PATTERN} and cannot be a reserved name`,
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

  found.push(...stateIssuesOf("", def.state, def.migrations));
  found.push(...memberIssuesOf(manifest, def.members));
  return found;
}

/** `def.composition`을 매니페스트 `orchestration.composition`에 채운 사본. 선언이 없거나 `orchestration`이 없으면 그대로다 */
function withComposition(
  manifest: ExtensionManifest,
  composition: CompositionDecl | undefined,
): ExtensionManifest {
  if (composition === undefined || manifest.orchestration === undefined) return manifest;
  return { ...manifest, orchestration: { ...manifest.orchestration, composition } };
}

/** defineOrchestration이 돌려준 객체. isOrchestrationModule이 이 집합으로 판별한다 */
const builtGroups = new WeakSet<object>();

/** defineOrchestrationMember가 돌려준 값. defineOrchestration이 손으로 쓴 구성원을 가려낸다 */
const builtMembers = new WeakSet<object>();

/** value가 이 모듈 인스턴스의 defineOrchestration이 만든 OrchestrationModule이면 참이다. 같은 모양의 손으로 쓴 객체는 거짓이다 */
export function isOrchestrationModule(value: unknown): value is OrchestrationModule {
  return typeof value === "object" && value !== null && builtGroups.has(value);
}

/**
 * 구성원 정의를 만든다. 상태 선언과 setup을 감싸며 setup은 실행하지 않는다. 검사는 뿌리와 함께 `defineOrchestration`이 한다.
 * 구성원의 상태는 자기 Registration에만 속하고, setup은 뿌리와 같은 OrchestrationApi를 받는다
 */
export function defineOrchestrationMember<S = never>(
  def: OrchestrationMemberDef<S>,
): OrchestrationMember {
  const member: OrchestrationMember = {
    ...(def.state === undefined ? {} : { state: def.state }),
    ...(def.migrations === undefined ? {} : { migrations: def.migrations }),
    mount: (register, registrationId, manifest, plugin) => {
      const registrationDef: RegistrationDef<S> =
        def.state === undefined ? {} : { state: def.state };
      const wrapDef: WrapDef<S, NoSettings> = {
        manifest,
        plugin,
        ...(def.state === undefined ? {} : { state: def.state }),
        ...(def.migrations === undefined ? {} : { migrations: def.migrations }),
      };
      register(registrationId, registrationDef, (api) =>
        def.setup(wrap(api, wrapDef, realHostAccess)),
      );
    },
  };
  builtMembers.add(member);
  return member;
}

/** 정의를 검증하고 OrchestrationModule을 만든다. 오류가 있으면 Bug를 던진다(§3.3). setup은 실행하지 않는다 */
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
  const members: Readonly<Record<string, OrchestrationMember>> = def.members ?? {};
  if (!Object.values(members).every((member) => builtMembers.has(member))) {
    throw new Bug(
      `defineOrchestration(${def.manifest.name}): members must be made by defineOrchestrationMember`,
    );
  }
  // 구성 선언은 매니페스트 사본에 채운다(X-16). 매니페스트 상수 자체는 바꾸지 않는다
  const filled = withComposition(def.manifest, def.composition);
  if (!isOrchestrationManifest(filled)) {
    throw new Bug(
      `defineOrchestration(${def.manifest.name}): manifest is not an orchestration manifest`,
    );
  }
  const entry: ExtensionEntry = ({ register, manifest: loaded }) => {
    // 호스트가 준 이름으로 등록한다. 설치된 플러그인은 매니페스트 이름과 같고, 초안(Test run)은 내부 이름(`d<해시>-<이름>`)이다.
    // 파일의 이름으로 등록하면 초안에서 `registration_unknown_plugin`으로 던진다(F-10, F-47)
    const live = loaded.name === filled.name ? filled : { ...filled, name: loaded.name };
    const liveDef = loaded.name === def.manifest.name ? def : { ...def, manifest: live };
    const registrationDef: RegistrationDef<S> = def.state === undefined ? {} : { state: def.state };
    register(loaded.name, registrationDef, (api) => def.setup(wrap(api, liveDef, realHostAccess)));
    // 구성원은 뿌리 뒤에 plugins[] 순서로 등록한다. 정의가 없는 구성원은 검사가 막았다
    for (const member of membersOf(live)) {
      const defined = members[member.id];
      if (defined === undefined) {
        throw new Bug(
          `defineOrchestration(${def.manifest.name}): member ${member.id} has no definition`,
        );
      }
      defined.mount(register, registrationIdOf(live, member.id), live, member.decl);
    }
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

/**
 * 매니페스트 값을 검증해 `ExtensionManifest`로 돌려준다. 구성원이 없는 보통 플러그인(`definePlugin`)의 `.fresnel-plugin/plugin.json`을 읽을 때 쓴다.
 * 매니페스트 오류, `orchestration` 선언, id 없는 L3 루트 플러그인 없음이면 Bug를 던진다. 순수 함수
 */
export function pluginManifest(value: unknown): ExtensionManifest {
  const result = validateManifest(value);
  const errors = result.issues.filter((found) => found.severity === "error");
  if (result.manifest === undefined || errors.length > 0) {
    throw new Bug(
      `pluginManifest: invalid manifest: ${errors.map((found) => `${found.code} ${found.path}`).join(", ")}`,
    );
  }
  const shape = pluginShapeIssues(result.manifest);
  if (shape.length > 0) {
    throw new Bug(
      `pluginManifest: ${result.manifest.name}: ${shape.map((found) => found.code).join(", ")}`,
    );
  }
  return result.manifest;
}

function pluginShapeIssues(manifest: ExtensionManifest): OrchestrationDefIssue[] {
  const found: OrchestrationDefIssue[] = [];
  if (isOrchestrationExtension(manifest)) {
    found.push(
      issue(
        "plugin_orchestration_declared",
        "/manifest/orchestration",
        "a plain plugin has no orchestration declaration; use defineOrchestration for a plugin with members",
      ),
    );
  }
  if (orchestrationOf(manifest) === undefined) {
    found.push(
      issue(
        "plugin_root_missing",
        "/manifest/plugins",
        'a plain plugin needs a root plugin (no id) with layer "L3"',
      ),
    );
  }
  return found;
}

/** 순수 함수. `definePlugin` 정의의 검사 결과다 */
export function validatePluginDef(
  def: Pick<PluginDef<unknown>, "manifest" | "state" | "migrations"> & {
    readonly settings?: { readonly namespace: string };
  },
): readonly (OrchestrationDefIssue | ManifestIssue)[] {
  const found: (OrchestrationDefIssue | ManifestIssue)[] = [
    ...validateManifest(def.manifest).issues,
  ];
  found.push(...pluginShapeIssues(def.manifest));
  if (!checkOrchestrationName(def.manifest.name).ok) {
    found.push(
      issue(
        "orchestration_name",
        "/manifest/name",
        `plugin name "${def.manifest.name}" must match ${ORCHESTRATION_NAME_PATTERN} and cannot be a reserved name`,
      ),
    );
  }
  if (def.settings !== undefined) {
    const expected =
      def.manifest.trust?.level === "builtin"
        ? `l3.${def.manifest.name}`
        : `ext.${def.manifest.name}`;
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
  found.push(...stateIssuesOf("", def.state, def.migrations));
  return found;
}

/**
 * 구성원이 없는 보통 플러그인을 정의한다(화면용 메서드와 모델 도구를 함께 내는 앱 플러그인 등). 매니페스트에 `orchestration` 선언이 없으므로
 * 캔버스와 목록에서 Drive나 구성원 플러그인으로 분류되지 않는다. 등록 API(`registerMethod`, `registerTool`, `registerCommand`)는 `defineOrchestration`과 같다.
 * 오류가 있으면 Bug를 던진다. setup은 실행하지 않는다
 */
export function definePlugin<S = never, const D extends OrchestrationSettingDefs = NoSettings>(
  def: PluginDef<S, D>,
): PluginModule {
  const errors = validatePluginDef(def).filter((found) => found.severity === "error");
  if (errors.length > 0) {
    throw new Bug(
      `definePlugin(${def.manifest.name}): ${errors.map((found) => `${found.code} ${found.path}`).join("; ")}`,
    );
  }
  const entry: ExtensionEntry = ({ register, manifest: loaded }) => {
    // 호스트가 준 이름으로 등록한다. 초안(Test run)은 내부 이름(`d<해시>-<이름>`)으로 실린다(defineOrchestration과 같다. F-10, F-47)
    const liveDef =
      loaded.name === def.manifest.name
        ? def
        : { ...def, manifest: { ...def.manifest, name: loaded.name } };
    const registrationDef: RegistrationDef<S> = def.state === undefined ? {} : { state: def.state };
    register(loaded.name, registrationDef, (api) => def.setup(wrap(api, liveDef, realHostAccess)));
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
