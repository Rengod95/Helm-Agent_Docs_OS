import { join } from "node:path";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, TurnIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { checkSettingWrite, type ScopeStack } from "@fresnel/contracts/settings";
import type { RegistrationInfo } from "@fresnel/ext-host";
import type {
  CacheImpact,
  CommonGetResult,
  CommonInput,
  CommonPutParams,
  CommonSet,
  DropsDrive,
  PermissionChange,
  ProfilePluginCost,
  PluginRef,
  Profile,
  ProfileCloneParams,
  ProfileDefaultForResult,
  ProfileDefaultResetParams,
  ProfileDefaultResetResult,
  ProfileDeleteResult,
  ProfileInput,
  ProfileIssue,
  ProfileListResult,
  ProfilePreviewResult,
  ProfilePutResult,
  ProfileRemovePluginParams,
  ProfileRemovePluginResult,
  ProfileSetting,
  TestRunMarker,
  ToolsChanged,
  Unsubscribe,
} from "@fresnel/contracts/wire";
import type {
  PluginEditApplied,
  PluginEditFailure,
  ProfilePortFailure,
  ProfilePreviewRequest,
  ProfileTestRunPort,
} from "../../handlers/m4/profile-test-run.ts";
import { decodeTestRunDrafts } from "../measure/test-run-marks.ts";
import {
  COMMON_ID,
  planPluginEdit,
  type PluginEditOutcome,
  type PluginEditRequest,
} from "./plugin-edit.ts";
import type { ProfileStoreSnapshot, ProfilesChange, ProfilesWritten } from "./profile-store.ts";
import { createProfileStore } from "./profile-store.ts";
import {
  factoryDefaultProfile,
  CRAFT_PROFILE_ID,
  craftProfile,
  DEFAULT_PROFILE_ID,
  NEVER_EDITED_ISO,
  PERMISSION_MODE_KEY,
  REQUIRED_BY_CORE,
} from "./profile-defaults.ts";
import {
  hasBlockingIssue,
  previousOf,
  type ProfilePrevious,
  validateProfile,
  type ProfileBody,
  type ProfileCatalog,
  type ProfileLibrary,
  type ProfileLibraryEntry,
} from "./profile-validate.ts";
import {
  pluginCostOf,
  toolsChangedOf,
  totalCostOf,
  UNKNOWN_COST,
  type ReadText,
} from "./profile-cost.ts";
import type { M4HostEnv, M4PortDeps } from "./deps.ts";
import type { PluginFact } from "./plugin-fact.ts";
import type { LegacyInputs } from "./profile-migrate.ts";

// ProfileTestRun 포트 구현(M5c §3.4, §4.2). 프로필 저장은 `profile-store.ts`, 검증은 `profile-validate.ts`가 한다.
// 이 파일은 저장된 내용을 읽고, 검증을 거쳐 쓰고, 미리 보기 값을 계산한다. 대화에 켜짐을 적용하지 않는다(E(T)는 나중 작업이다).

export interface ProfileTestRunPortDeps extends Pick<
  M4PortDeps,
  "traceRead" | "testRunControl" | "env" | "projects"
> {
  /** 설치된 플러그인의 매니페스트 사실. 확장 읽기 원천에서 온다 */
  readonly pluginFacts: () => readonly PluginFact[];
  /**
   * 검토 대기 항목이 가리키는 플러그인 이름(검토본이 없는 것 포함). 프로필 검증은 이 이름을 `plugin_not_reviewed`로 본다
   * (M5c §4.2.7). 읽지 못하면 빈 목록이다(호출 쪽이 기록한다)
   */
  readonly pendingNames: () => Promise<readonly string[]>;
  /** 선언된 재료 파일을 읽는다(비용 추정). 운영은 `readTextFile`이다 */
  readonly readText: ReadText;
}

const EMPTY_BODY: ProfileBody = { plugins: [], settings: [], startDrive: null };
const NO_LAYERS: ScopeStack = [];
const EXT_KEY = /^ext\.([^.]+)\./u;

/** `ext.<name>.<key>`의 소유 플러그인. 코어 키는 null */
function ownerOf(key: string): string | null {
  const match = EXT_KEY.exec(key);
  return match?.[1] ?? null;
}

/** 관리 범위가 이 플러그인의 켜짐(`ext.<name>.enabled`)을 거짓으로 잠갔는가(M5c §4.1.10) */
function managedOff(env: M4HostEnv, plugin: string): boolean {
  const managed = env.settings.layers(undefined).find((layer) => layer.scope === "managed");
  return managed?.values.get(`ext.${plugin}.enabled`) === false;
}

/** 같은 키가 여러 번 나오면 마지막 값이 이긴다 */
function lastValueOf(settings: readonly ProfileSetting[], key: string): unknown {
  let value: unknown = undefined;
  for (const setting of settings) if (setting.key === key) value = setting.value;
  return value;
}

/** 저장된 목록에 기본 프로필을 더한다. 기본이 저장되어 있지 않으면 공장 값이다(§4.1.2) */
function effectiveProfiles(stored: readonly Profile[], factory: Profile): readonly Profile[] {
  return stored.some((profile) => profile.id === DEFAULT_PROFILE_ID)
    ? stored
    : [factory, ...stored];
}

/** 개발 모드(replay·benchmark·core diff 실행 허용) 판정(M5c §3). `l3.authoring.devMode`가 참인가. 키가 아직 카탈로그에 없으면 거짓이다 */
export function isDevMode(settingValue: (key: string) => unknown): boolean {
  return settingValue("l3.authoring.devMode") === true;
}

function isoNow(clockMs: number): string {
  return new Date(clockMs).toISOString();
}

/**
 * 검증 라이브러리. 설치된 플러그인은 검토본이 있는 것으로 본다. 검토 대기뿐인 이름(`pending`)은 `plugin_not_reviewed`다(M5c §4.2.7).
 * `overlay`는 지금 승인하는 후보다. 승인 전이라도 검토본이 있는 것으로 보고 그 사실을 쓴다(§4.7.3, 승격 전 검사)
 */
function libraryOf(
  env: M4HostEnv,
  facts: readonly PluginFact[],
  pending: ReadonlySet<string>,
  overlay: PluginFact | null,
): ProfileLibrary {
  return {
    lookup(name): ProfileLibraryEntry | undefined {
      const fact =
        overlay !== null && overlay.name === name
          ? overlay
          : facts.find((item) => item.name === name);
      if (fact === undefined) {
        if (!pending.has(name)) return undefined;
        return {
          name,
          reviewed: false,
          replaces: [],
          drives: false,
          unmet: false,
          requiredKeys: [],
        };
      }
      const infos: readonly RegistrationInfo[] = env
        .registrations()
        .filter((info) => info.extension === name);
      return {
        name,
        reviewed: true,
        replaces: fact.replaces,
        drives: fact.drives,
        unmet: infos.some((info) => info.waiting.length > 0),
        requiredKeys: fact.requiredKeys,
      };
    },
  };
}

/** 카탈로그 조회. `names`가 null이면 시크릿 존재를 모르므로 존재하는 것으로 본다(경고를 내지 않는다) */
function catalogOf(env: M4HostEnv, names: ReadonlySet<string> | null): ProfileCatalog {
  return {
    lookup(key) {
      const def = env.catalog.get(key);
      if (def === undefined) return undefined;
      return {
        key,
        allowedScopes: [...def.allowedScopes],
        secret: def.secret === true,
        owner: ownerOf(key),
        restart: def.runtimeChange === "restart",
        checkValue(value) {
          // 쓰기 검사와 같은 함수다. 범위·잠금은 위에서 따로 보므로 빈 층을 넘긴다
          const verdict = checkSettingWrite(env.catalog, NO_LAYERS, key, "profile", value);
          if (verdict.ok) return { ok: true };
          return {
            ok: false,
            reason: verdict.kind === "settings.secretValue" ? "secret_literal" : "invalid",
          };
        },
      };
    },
    secretExists: (name) => names === null || names.has(name),
    managedDisabled: (plugin) => managedOff(env, plugin),
    unavailable: (plugin) => env.stopped(plugin) || managedOff(env, plugin),
  };
}

/** 사용자 범위의 설정 값에서 옮김 입력을 만든다(§7.2). 옛 `ext.<name>.enabled`와 권한 모드를 읽는다 */
function legacyInputsOf(env: M4HostEnv): LegacyInputs {
  const user = env.settings.layers(undefined).find((layer) => layer.scope === "user");
  const userEnabled = new Map<string, boolean>();
  if (user !== undefined) {
    for (const [key, value] of user.values) {
      const match = EXT_KEY.exec(key);
      if (match !== null && key.endsWith(".enabled") && typeof value === "boolean") {
        userEnabled.set(match[1] ?? "", value);
      }
    }
  }
  const mode = user?.values.get(PERMISSION_MODE_KEY);
  return {
    userEnabled,
    // 옮김의 기본 켜짐은 공장 기본 플러그인과 같다(코어가 아닌 기본 켜짐, §7.2)
    defaultEnabled: env.defaultPlugins(),
    permissionMode: typeof mode === "string" ? mode : undefined,
    profileAllows: (key) => env.catalog.get(key)?.allowedScopes.includes("profile") === true,
  };
}

/**
 * 이전 목록에 있었는데 새 목록에서 빠진 코어 필수 단위의 이름(M5c §4.1.17). 이전 목록에 없던 단위는 거절하지 않는다.
 * 프로필이 처음부터 그 단위를 적지 않았으면 빠진 것이 아니다
 */
function droppedRequiredOf(
  before: readonly PluginRef[],
  after: readonly PluginRef[],
): string | undefined {
  const kept = new Set(after.map((ref) => ref.name));
  return before.find((ref) => REQUIRED_BY_CORE.has(ref.name) && !kept.has(ref.name))?.name;
}

function sameNames(left: readonly PluginRef[], right: readonly PluginRef[]): boolean {
  return left.length === right.length && left.every((ref, at) => right[at]?.name === ref.name);
}

/** 해소된 목록의 플러그인별 정적 비용. 사실이 없는 플러그인은 unknown이다 */
function costsOf(
  plugins: readonly PluginRef[],
  facts: readonly PluginFact[],
  readText: ReadText,
): Promise<readonly ProfilePluginCost[]> {
  return Promise.all(
    plugins.map(async (ref) => {
      const fact = facts.find((item) => item.name === ref.name);
      const cost = fact === undefined ? UNKNOWN_COST : await pluginCostOf(fact.declared, readText);
      return { plugin: ref.name, cost };
    }),
  );
}

/** 숨은 `craft` 프로필은 공통 묶음을 받지 않는다(§4.8.5 [제안]). 다른 프로필에는 공통 묶음을 그대로 준다 */
const NO_COMMON: CommonSet = { plugins: [], settings: [], updatedAt: NEVER_EDITED_ISO, rev: 0 };
function commonOf(profileId: string, common: CommonSet): CommonSet {
  return profileId === CRAFT_PROFILE_ID ? NO_COMMON : common;
}

/**
 * 대화가 저장한 프로필 id를 목록에서 찾는다. 저장한 id가 없거나 목록에 없으면 기본이다(§4.1.1). `craft`는 저장 목록에 없어도 유효하다
 */
function effectiveIdOf(saved: string | null, stored: ReadonlySet<string>): string {
  if (saved === null) return DEFAULT_PROFILE_ID;
  return saved === CRAFT_PROFILE_ID || stored.has(saved) ? saved : DEFAULT_PROFILE_ID;
}

function resolvedOf(body: ProfileBody, common: CommonSet): PluginRef[] {
  const names = new Set<string>();
  for (const ref of [...common.plugins, ...body.plugins]) names.add(ref.name);
  return [...names].map((name) => ({ name }));
}

function idsOf(profiles: readonly Profile[]): ReadonlySet<string> {
  return new Set(profiles.map((profile) => profile.id));
}

function findProfile(
  stored: readonly Profile[],
  id: string,
  factory: Profile,
): Profile | undefined {
  // 숨은 `craft`는 저장하지 않는다. 목록에는 나오지 않고 `get`과 해소에서만 찾는다
  if (id === CRAFT_PROFILE_ID) return craftProfile();
  return effectiveProfiles(stored, factory).find((profile) => profile.id === id);
}

/** 고정 초안이 하나라도 든 기록인가. 표지의 `kind = draft`를 정한다(M5c §4.8.1). 읽지 못한 기록은 초안이 없는 것으로 본다 */
function draftedOf(json: string | null | undefined): boolean {
  const read = decodeTestRunDrafts(json ?? null);
  return read.ok && read.value.drafts.length > 0;
}

/** 드래프트 승인이 `auto`인 기록인가. 표지의 `draftApproval`을 정한다(§4.8.1 항목 10). 읽지 못한 기록은 `ask`로 본다 */
function autoApprovedOf(json: string | null | undefined): boolean {
  const read = decodeTestRunDrafts(json ?? null);
  return read.ok && read.value.approval === "auto";
}

const EMPTY_COMMON: CommonSet = { plugins: [], settings: [], updatedAt: "", rev: 0 };

/** 프로필 검증기. `previous`는 저장 전에도 있던 항목이다(없으면 전부 새 항목) */
type ProfileCheck = (
  body: ProfileBody,
  common: CommonSet,
  previous?: ProfilePrevious,
) => readonly ProfileIssue[];

/** 경고로 넘긴 없는 플러그인 이름(`plugin_unknown`, 중복 없음) */
function missingNamesOf(issues: readonly ProfileIssue[]): readonly string[] {
  return [
    ...new Set(
      issues.flatMap((issue) =>
        issue.code === "plugin_unknown" && issue.plugin !== undefined ? [issue.plugin] : [],
      ),
    ),
  ];
}

/** 선택 필드 `missingPlugins`는 있을 때만 싣는다(정확한 선택 속성 규칙) */
function missingFieldOf(names: readonly string[]): { readonly missingPlugins?: readonly string[] } {
  return names.length === 0 ? {} : { missingPlugins: names };
}

export function createProfileTestRunPort(deps: ProfileTestRunPortDeps): ProfileTestRunPort {
  const { env } = deps;
  /** 기본 공장 값. 플러그인 목록은 조립이 준 기본 설치 플러그인이다(코어가 아닌 내장 가운데 기본 켜짐과 번들, §4.1.2) */
  const factory = (): Profile => factoryDefaultProfile(env.defaultPlugins());
  const store = createProfileStore({
    path: join(env.configDir, "profiles.json"),
    migrationLogPath: join(env.stateDir, "migration.log"),
    fileLock: env.fileLock,
    clock: env.clock,
    signal: env.signal,
    legacy: () => legacyInputsOf(env),
  });
  // Test run 대화 표지. 메모리에 두고 같은 표지를 측정 저장소의 `tr_thread`에도 적는다(규칙 32). 재시작 뒤 메모리가 비면 저장된 표지로 되살린다
  const markers = new Map<ThreadId, TestRunMarker>();
  /** 표지를 찾는다. 메모리에 없으면 저장된 표지를 읽어 메모리에 옮긴다 */
  function markerOf(threadId: ThreadId): TestRunMarker | undefined {
    const known = markers.get(threadId);
    if (known !== undefined) return known;
    const stored = deps.env.testRunMarks?.recall(threadId);
    if (stored === undefined) return undefined;
    const restored: TestRunMarker = {
      profileId: stored.testBaseProfile,
      target: stored.testTarget,
      paused: false,
      ...(draftedOf(stored.draftJson) ? { kind: "draft", draft: true } : {}),
      ...(stored.runGroupId === null ? {} : { runGroupId: stored.runGroupId }),
      ...(autoApprovedOf(stored.draftJson) ? { draftApproval: "auto" } : {}),
    };
    markers.set(threadId, restored);
    return restored;
  }

  /**
   * 검증기를 만든다. 시크릿 이름과 플러그인 사실은 쓰기 잠금 밖에서 한 번 읽는다(검증 함수는 동기다).
   * 저장된 목록을 바꾸는 계산은 이 함수가 돌려준 검증기를 잠금 안에서 쓴다.
   */
  async function checksOf(overlay: PluginFact | null = null): Promise<ProfileCheck> {
    const names = await env.secretNames();
    const pending = new Set(await deps.pendingNames());
    const lib = libraryOf(env, deps.pluginFacts(), pending, overlay);
    const catalog = catalogOf(env, names);
    return (body, common, previous) => validateProfile(body, common, lib, catalog, previous);
  }

  /**
   * 승인 계산에 쓸 값: 검사 함수와 바뀔 프로필의 계산. 계산은 저장된 것을 읽은 스냅샷에서 한다(잠금 안에서도 같은 함수를 쓴다)
   */
  function planEdit(
    request: PluginEditRequest,
    snapshot: ProfileStoreSnapshot,
    validate: ProfileCheck,
  ): Result<PluginEditOutcome, PluginEditFailure> {
    const planned = planPluginEdit({
      profiles: effectiveProfiles(snapshot.profiles, factory()),
      common: snapshot.common,
      request,
      validate,
      updatedAt: isoNow(env.clock.now()),
    });
    if (!planned.ok) return err({ kind: "plugin_invalid", issues: planned.error.issues });
    return ok(planned.value);
  }

  /**
   * 이 프로필을 참조하는 열린 대화 수(M5c §4.1.14). 대화가 저장한 프로필 id가 `stored`(저장된 프로필 id 목록)에 없으면
   * 기본을 쓰는 것으로 센다(§4.1.1). 지우는 경우 `stored`는 지우기 전 목록이다.
   */
  function threadsUsing(profileId: string, stored: ReadonlySet<string>): number {
    let count = 0;
    for (const saved of env.openThreadProfiles()) {
      if (effectiveIdOf(saved, stored) === profileId) count += 1;
    }
    return count;
  }

  /**
   * 이 프로필의 목록으로 바꾸면 주도권 스택에서 내려갈 프레임을 가진 열린 대화 수(§4.3.7, §4.1.13). 그 프로필을 참조하는 대화만 센다.
   * 프레임을 쥔 플러그인이 새 목록에 없거나 오류로 멈췄거나 관리 잠금으로 꺼졌으면 그 프레임은 내려간다. 없으면 null
   */
  function dropsDriveOf(
    profileId: string,
    stored: ReadonlySet<string>,
    next: readonly PluginRef[],
  ): DropsDrive | null {
    const kept = new Set(
      next
        .filter((ref) => !env.stopped(ref.name) && !managedOff(env, ref.name))
        .map((ref) => ref.name),
    );
    let threadCount = 0;
    for (const threadId of env.openThreadIds()) {
      const effective = effectiveIdOf(env.threadProfileId(threadId), stored);
      if (effective !== profileId) continue;
      if (env.driveFramePlugins(threadId).some((plugin) => !kept.has(plugin))) threadCount += 1;
    }
    return threadCount === 0 ? null : { threadCount };
  }

  /**
   * 활성 목록의 도구 이름(§4.2.8). 선언이 없는 플러그인은 아무것도 더하지 않는다. 오류로 멈춘 플러그인과 관리 잠금은
   * E(T)에서 빠지므로 뺀다.
   */
  function toolNamesOf(
    refs: readonly PluginRef[],
    facts: readonly PluginFact[],
  ): ReadonlySet<string> {
    const names = new Set<string>();
    for (const ref of refs) {
      if (env.stopped(ref.name) || managedOff(env, ref.name)) continue;
      const fact = facts.find((item) => item.name === ref.name);
      for (const tool of fact?.declared.tools ?? []) names.add(tool.name);
    }
    return names;
  }

  /** 대화가 지금 참조하는 프로필의 해소 목록. 없는 프로필을 가리키면 `default`로 읽는다(§4.1.1) */
  function threadPluginsOf(
    stored: readonly Profile[],
    threadId: ThreadId,
    common: CommonSet,
  ): readonly PluginRef[] {
    const id = env.threadProfileId(threadId) ?? DEFAULT_PROFILE_ID;
    const profile =
      findProfile(stored, id, factory()) ??
      findProfile(stored, DEFAULT_PROFILE_ID, factory()) ??
      factory();
    return resolvedOf(profile, commonOf(profile.id, common));
  }

  /**
   * 바뀜을 잴 기준 목록. 대화가 있으면 그 대화가 지금 참조하는 프로필, 없으면 같은 id의 저장된 프로필이다.
   * 기준이 없으면(대화 없이 아직 저장하지 않은 새 id를 볼 때) undefined다.
   */
  function baselineOf(
    stored: readonly Profile[],
    id: string,
    common: CommonSet,
    threadId: ThreadId | undefined,
  ): readonly PluginRef[] | undefined {
    if (threadId !== undefined) return threadPluginsOf(stored, threadId, common);
    const saved = findProfile(stored, id, factory());
    return saved === undefined ? undefined : resolvedOf(saved, commonOf(saved.id, common));
  }

  /**
   * 캐시 영향(§4.3.7). 도구 변화가 없으면 `none`이다. 도구가 바뀌면 대화의 캐시 정책이 정한다. 대화가 없거나 정책을
   * 읽지 못하면 값이 없다(기본값을 꾸며 내지 않는다)
   */
  function cacheImpactOf(
    toolsChanged: ToolsChanged | undefined,
    threadId: ThreadId | undefined,
  ): CacheImpact | undefined {
    if (toolsChanged === undefined) return "none";
    if (threadId === undefined) return undefined;
    const policy = env.cachePolicyOf?.(threadId);
    if (policy === undefined) return undefined;
    return policy.midConversationToolChanges ? "tool_change_append" : "readvertise";
  }

  /** 권한 모드가 바뀌는 경우의 `from`, `to`. `to`는 공통 묶음과 프로필 가운데 프로필 쪽 값이 이긴다(§4.2.7) */
  function permissionOf(
    body: ProfileBody,
    common: CommonSet,
    threadId: ThreadId | undefined,
  ): PermissionChange | undefined {
    const to = lastValueOf([...common.settings, ...body.settings], PERMISSION_MODE_KEY);
    if (typeof to !== "string") return undefined;
    const from = env.settingValue(PERMISSION_MODE_KEY, threadId);
    if (typeof from !== "string" || from === to) return undefined;
    return { from, to };
  }

  return {
    errors: env.errors,
    async list(): Promise<Result<ProfileListResult, ProfilePortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return snapshot;
      return ok({
        profiles: effectiveProfiles(snapshot.value.profiles, factory()),
        common: snapshot.value.common,
        rev: snapshot.value.rev,
      });
    },
    async get(id): Promise<Result<Profile, ProfilePortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) {
        // 파일이 깨져도 기본 프로필은 공장 값으로 쓴다(M5c §5)
        if (id === DEFAULT_PROFILE_ID && snapshot.error.kind === "corrupt") return ok(factory());
        return snapshot;
      }
      const found = findProfile(snapshot.value.profiles, id, factory());
      return found === undefined ? err({ kind: "not_found", id }) : ok(found);
    },
    async missingPlugins(id: string): Promise<Result<readonly string[], ProfilePortFailure>> {
      const snapshot = await store.read();
      // 파일이 깨져도 기본 프로필은 공장 값으로 읽는다(`get`과 같다). 공통 묶음은 알 수 없어 비어 있는 것으로 본다
      if (!snapshot.ok) {
        if (id !== DEFAULT_PROFILE_ID || snapshot.error.kind !== "corrupt") return snapshot;
        const issuesOf = await checksOf();
        const base = factory();
        return ok(missingNamesOf(issuesOf(base, EMPTY_COMMON, previousOf(base, EMPTY_COMMON))));
      }
      const found = findProfile(snapshot.value.profiles, id, factory());
      if (found === undefined) return err({ kind: "not_found", id });
      const issuesOf = await checksOf();
      const { common } = snapshot.value;
      return ok(missingNamesOf(issuesOf(found, common, previousOf(found, common))));
    },
    async put(
      input: ProfileInput,
      baseRev: number | null,
    ): Promise<Result<ProfilePutResult, ProfilePortFailure>> {
      if (input.id === CRAFT_PROFILE_ID) return err({ kind: "builtin_protected", id: input.id });
      const issuesOf = await checksOf();
      const done = await store.transact<ProfilePutResult, ProfilePortFailure>((snapshot) => {
        const existing = snapshot.profiles.find((profile) => profile.id === input.id);
        // 기본 프로필은 저장되지 않았으면 공장 값 rev 0이다. 처음 저장할 때 null도 받는다
        const storedRev =
          existing !== undefined ? existing.rev : input.id === DEFAULT_PROFILE_ID ? 0 : null;
        const firstDefault =
          existing === undefined && input.id === DEFAULT_PROFILE_ID && baseRev === null;
        if (storedRev !== baseRev && !firstDefault) {
          return err({ kind: "conflict" as const, id: input.id, rev: storedRev, baseRev });
        }
        // 지금 유효한 목록(저장본 또는 공장 값)에서 코어 필수 단위가 빠지면 거절한다(§4.1.17)
        const previous = findProfile(snapshot.profiles, input.id, factory());
        const dropped =
          previous === undefined ? undefined : droppedRequiredOf(previous.plugins, input.plugins);
        if (dropped !== undefined)
          return err({ kind: "required_by_core" as const, plugin: dropped });
        const profile: Profile = {
          id: input.id,
          title: input.title,
          builtin: input.id === DEFAULT_PROFILE_ID,
          plugins: input.plugins,
          settings: input.settings,
          startDrive: input.startDrive,
          updatedAt: isoNow(env.clock.now()),
          rev: (storedRev ?? 0) + 1,
        };
        // 저장 전에도 들어 있던 없는 플러그인은 경고다(AGE-34). 첫 저장이면 `previous`가 없어 전부 새 항목이다
        const issues = issuesOf(
          profile,
          snapshot.common,
          previous === undefined ? undefined : previousOf(previous, snapshot.common),
        );
        if (hasBlockingIssue(issues)) return err({ kind: "invalid" as const, issues });
        const next =
          existing === undefined
            ? [...snapshot.profiles, profile]
            : snapshot.profiles.map((item) => (item.id === input.id ? profile : item));
        return ok({
          profiles: next,
          common: snapshot.common,
          value: {
            profile,
            issues: issues.filter((issue) => issue.severity === "warning"),
            ...missingFieldOf(missingNamesOf(issues)),
          },
        });
      });
      if (!done.ok) return done;
      return ok(done.value.value);
    },
    async remove(id): Promise<Result<ProfileDeleteResult, ProfilePortFailure>> {
      if (id === DEFAULT_PROFILE_ID || id === CRAFT_PROFILE_ID)
        return err({ kind: "builtin_protected", id });
      // 지우기 전 목록으로 잴 때 이 프로필을 쓰던 대화를 센다
      const before = await store.read();
      if (!before.ok) return before;
      const beforeIds = idsOf(before.value.profiles);
      const done = await store.transact<undefined, ProfilePortFailure>((snapshot) => {
        if (!snapshot.profiles.some((profile) => profile.id === id))
          return err({ kind: "not_found" as const, id });
        return ok({
          profiles: snapshot.profiles.filter((profile) => profile.id !== id),
          common: snapshot.common,
          value: undefined,
        });
      });
      if (!done.ok) return done;
      return ok({ rev: done.value.rev, reassignedThreads: threadsUsing(id, beforeIds) });
    },
    async checkPluginEdit(request: PluginEditRequest): Promise<Result<void, PluginEditFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return snapshot;
      const validate = await checksOf(request.kind === "remove" ? null : request.plugin);
      const planned = planEdit(request, snapshot.value, validate);
      return planned.ok ? ok(undefined) : planned;
    },
    async applyPluginEdit(
      request: PluginEditRequest,
    ): Promise<Result<PluginEditApplied, PluginEditFailure>> {
      const validate = await checksOf(request.kind === "remove" ? null : request.plugin);
      const snapshot = await store.read();
      if (!snapshot.ok) return snapshot;
      const first = planEdit(request, snapshot.value, validate);
      if (!first.ok) return first;
      if (first.value.changed.length === 0 && first.value.common === null)
        return ok({ profileIds: [], missingPlugins: first.value.missingPlugins });
      // 잠금 안에서 다시 계산한다. 그사이 저장이 바뀌었으면 검사가 다시 돈다
      const done = await store.transact<PluginEditApplied, PluginEditFailure>((locked) => {
        const planned = planEdit(request, locked, validate);
        if (!planned.ok) return err(planned.error);
        const changed = planned.value.changed;
        const byId = new Map(changed.map((profile) => [profile.id, profile] as const));
        const replaced = locked.profiles.map((profile) => byId.get(profile.id) ?? profile);
        const added = changed.filter(
          (profile) => !locked.profiles.some((item) => item.id === profile.id),
        );
        const ids = [
          ...changed.map((profile) => profile.id),
          ...(planned.value.common === null ? [] : [COMMON_ID]),
        ];
        return ok({
          profiles: [...replaced, ...added],
          common: planned.value.common ?? locked.common,
          value: { profileIds: ids, missingPlugins: planned.value.missingPlugins },
        });
      });
      if (!done.ok) return done;
      return ok(done.value.value);
    },
    async clone(
      params: ProfileCloneParams,
    ): Promise<Result<{ readonly profile: Profile }, ProfilePortFailure>> {
      if (params.newId === DEFAULT_PROFILE_ID || params.newId === CRAFT_PROFILE_ID)
        return err({ kind: "builtin_protected", id: params.newId });
      const issuesOf = await checksOf();
      const done = await store.transact<Profile, ProfilePortFailure>((snapshot) => {
        const eff = effectiveProfiles(snapshot.profiles, factory());
        const source = eff.find((profile) => profile.id === params.id);
        if (source === undefined) return err({ kind: "not_found" as const, id: params.id });
        const taken = eff.find((profile) => profile.id === params.newId);
        if (taken !== undefined) {
          return err({
            kind: "conflict" as const,
            id: params.newId,
            rev: taken.rev,
            baseRev: null,
          });
        }
        const profile: Profile = {
          id: params.newId,
          title: params.title,
          builtin: false,
          plugins: source.plugins,
          settings: source.settings,
          startDrive: source.startDrive,
          updatedAt: isoNow(env.clock.now()),
          rev: 1,
        };
        const issues = issuesOf(profile, snapshot.common);
        if (hasBlockingIssue(issues)) return err({ kind: "invalid" as const, issues });
        return ok({
          profiles: [...snapshot.profiles, profile],
          common: snapshot.common,
          value: profile,
        });
      });
      if (!done.ok) return done;
      return ok({ profile: done.value.value });
    },
    async commonGet(): Promise<Result<CommonGetResult, ProfilePortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return snapshot;
      const issuesOf = await checksOf();
      return ok({
        common: snapshot.value.common,
        issues: issuesOf(
          EMPTY_BODY,
          snapshot.value.common,
          previousOf(undefined, snapshot.value.common),
        ),
      });
    },
    async commonPut(params: CommonPutParams): Promise<Result<CommonGetResult, ProfilePortFailure>> {
      const input: CommonInput = params.common;
      const issuesOf = await checksOf();
      const done = await store.transact<CommonGetResult, ProfilePortFailure>((snapshot) => {
        if (snapshot.common.rev !== params.baseRev) {
          return err({
            kind: "conflict" as const,
            id: "common",
            rev: snapshot.common.rev,
            baseRev: params.baseRev,
          });
        }
        const dropped = droppedRequiredOf(snapshot.common.plugins, input.plugins);
        if (dropped !== undefined)
          return err({ kind: "required_by_core" as const, plugin: dropped });
        const next: CommonSet = {
          plugins: input.plugins,
          settings: input.settings,
          updatedAt: isoNow(env.clock.now()),
          rev: snapshot.common.rev + 1,
        };
        const issues = issuesOf(EMPTY_BODY, next, previousOf(undefined, snapshot.common));
        if (hasBlockingIssue(issues)) return err({ kind: "invalid" as const, issues });
        return ok({ profiles: snapshot.profiles, common: next, value: { common: next, issues } });
      });
      if (!done.ok) return done;
      return ok(done.value.value);
    },
    async preview(
      request: ProfilePreviewRequest,
    ): Promise<Result<ProfilePreviewResult, ProfilePortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return snapshot;
      const { source, threadId } = request;
      let body: ProfileBody;
      let id: string;
      if (source.kind === "stored") {
        const found = findProfile(snapshot.value.profiles, source.id, factory());
        if (found === undefined) return err({ kind: "not_found", id: source.id });
        body = found;
        id = found.id;
      } else {
        body = source.draft;
        id = source.draft.id;
      }
      const common = commonOf(id, snapshot.value.common);
      const issuesOf = await checksOf();
      // 저장된 프로필과 같은 id의 미리 보기는 저장 전 값에서 이미 있던 항목을 경고로 본다(`put`과 같은 규칙, AGE-34)
      const stored = findProfile(snapshot.value.profiles, id, factory());
      const issues = issuesOf(body, common, previousOf(stored, snapshot.value.common));
      const missingRequired: { plugin: string; key: string }[] = [];
      for (const issue of issues) {
        if (
          issue.code === "required_unset" &&
          issue.plugin !== undefined &&
          issue.key !== undefined
        ) {
          missingRequired.push({ plugin: issue.plugin, key: issue.key });
        }
      }
      const resolved = resolvedOf(body, common);
      const facts = deps.pluginFacts();
      const byPlugin = await costsOf(resolved, facts, deps.readText);
      const permission = permissionOf(body, common, threadId);
      // 기준이 없으면 도구 변화와 캐시 영향을 싣지 않는다. 기준이 있고 바뀜이 없으면 도구 변화는 생략하고 캐시 영향은 none이다
      const before = baselineOf(snapshot.value.profiles, id, common, threadId);
      const toolsChanged =
        before === undefined
          ? undefined
          : toolsChangedOf(toolNamesOf(before, facts), toolNamesOf(resolved, facts));
      const cacheImpact = before === undefined ? undefined : cacheImpactOf(toolsChanged, threadId);
      return ok({
        resolved,
        issues,
        cost: { total: totalCostOf(byPlugin), byPlugin },
        missingRequired,
        threadsUsing: threadsUsing(id, idsOf(snapshot.value.profiles)),
        ...(permission === undefined ? {} : { permission }),
        ...(toolsChanged === undefined ? {} : { toolsChanged }),
        ...(cacheImpact === undefined ? {} : { cacheImpact }),
        dropsDrive: dropsDriveOf(id, idsOf(snapshot.value.profiles), resolved),
      });
    },
    async defaultFor(
      workspace: string | undefined,
    ): Promise<Result<ProfileDefaultForResult, ProfilePortFailure>> {
      // §4.4.8: 같은 폴더의, 없으면 같은 프로젝트의 가장 최근 대화가 지금 참조하는 프로필이다. 없으면 기본이다
      const picked = await deps.projects.recentThread(workspace);
      if (!picked.ok) return err({ kind: "project", failure: picked.error });
      const candidate = picked.value?.profileId ?? null;
      if (candidate === null) return ok({ profileId: DEFAULT_PROFILE_ID });
      // 지워졌거나 없는 프로필 id는 읽지 않고 기본으로 돌아간다
      const snapshot = await store.read();
      if (!snapshot.ok) return err(snapshot.error);
      const exists = snapshot.value.profiles.some((profile) => profile.id === candidate);
      return ok({ profileId: exists ? candidate : DEFAULT_PROFILE_ID });
    },
    async removePlugin(
      params: ProfileRemovePluginParams,
    ): Promise<Result<ProfileRemovePluginResult, ProfilePortFailure>> {
      if (params.id === CRAFT_PROFILE_ID) return err({ kind: "builtin_protected", id: params.id });
      const issuesOf = await checksOf();
      const done = await store.transact<
        {
          readonly before: Profile;
          readonly profile: Profile;
          readonly common: CommonSet;
          readonly known: ReadonlySet<string>;
        },
        ProfilePortFailure
      >((snapshot) => {
        const current = findProfile(snapshot.profiles, params.id, factory());
        if (current === undefined) return err({ kind: "not_found" as const, id: params.id });
        if (current.rev !== params.baseRev) {
          return err({
            kind: "conflict" as const,
            id: params.id,
            rev: current.rev,
            baseRev: params.baseRev,
          });
        }
        if (!current.plugins.some((ref) => ref.name === params.plugin)) {
          if (snapshot.common.plugins.some((ref) => ref.name === params.plugin)) {
            return err({ kind: "common_plugin" as const, plugin: params.plugin });
          }
          return err({ kind: "plugin_not_in_profile" as const, plugin: params.plugin });
        }
        if (REQUIRED_BY_CORE.has(params.plugin)) {
          return err({ kind: "required_by_core" as const, plugin: params.plugin });
        }
        // 그 플러그인의 설정 값도 함께 뺀다. 남겨 두면 소유 플러그인이 없어 저장이 막힌다(§4.2.2)
        const profile: Profile = {
          ...current,
          plugins: current.plugins.filter((ref) => ref.name !== params.plugin),
          settings: current.settings.filter((setting) => ownerOf(setting.key) !== params.plugin),
          startDrive: current.startDrive === params.plugin ? null : current.startDrive,
          updatedAt: isoNow(env.clock.now()),
          rev: current.rev + 1,
        };
        // 이 프로필이 이미 가리키던 없는 플러그인(다른 것)이 플러그인을 빼는 저장을 막지 않는다(AGE-34)
        const issues = issuesOf(profile, snapshot.common, previousOf(current, snapshot.common));
        if (hasBlockingIssue(issues)) return err({ kind: "invalid" as const, issues });
        const next = snapshot.profiles.some((item) => item.id === profile.id)
          ? snapshot.profiles.map((item) => (item.id === profile.id ? profile : item))
          : [...snapshot.profiles, profile];
        return ok({
          profiles: next,
          common: snapshot.common,
          value: {
            before: current,
            profile,
            common: snapshot.common,
            known: idsOf(snapshot.profiles),
          },
        });
      });
      if (!done.ok) return done;
      const { before, profile, common, known } = done.value.value;
      const permission = permissionOf(profile, common, undefined);
      // 지우기 전과 뒤의 저장된 상태를 잰다(대화를 고르지 않으므로 캐시 영향은 싣지 않는다)
      const facts = deps.pluginFacts();
      const toolsChanged = toolsChangedOf(
        toolNamesOf(resolvedOf(before, common), facts),
        toolNamesOf(resolvedOf(profile, common), facts),
      );
      return ok({
        profile,
        preview: {
          threadsUsing: threadsUsing(profile.id, known),
          ...(permission === undefined ? {} : { permission }),
          ...(toolsChanged === undefined ? {} : { toolsChanged }),
          dropsDrive: dropsDriveOf(profile.id, known, resolvedOf(profile, common)),
        },
      });
    },
    async defaultReset(
      params: ProfileDefaultResetParams,
    ): Promise<Result<ProfileDefaultResetResult, ProfilePortFailure>> {
      const snapshot = await store.read();
      if (!snapshot.ok) return snapshot;
      const current =
        findProfile(snapshot.value.profiles, DEFAULT_PROFILE_ID, factory()) ?? factory();
      const reference = factory();
      const changed = {
        plugins: !sameNames(current.plugins, reference.plugins),
        settings: JSON.stringify(current.settings) !== JSON.stringify(reference.settings),
      };
      const count = threadsUsing(DEFAULT_PROFILE_ID, idsOf(snapshot.value.profiles));
      if (params.preview === true) return ok({ profile: current, changed, threadsUsing: count });
      const done = await store.transact<undefined, ProfilePortFailure>((stored) =>
        ok({
          // 저장된 기본 행을 지운다. 다음 읽기에서 공장 값이 된다(§4.1.2)
          profiles: stored.profiles.filter((profile) => profile.id !== DEFAULT_PROFILE_ID),
          common: stored.common,
          value: undefined,
        }),
      );
      if (!done.ok) return done;
      return ok({ profile: reference, changed, threadsUsing: count });
    },
    onProfilesChanged(listener: (change: ProfilesChange) => void): Unsubscribe {
      return store.onChange(listener);
    },
    onProfilesWritten(listener: (written: ProfilesWritten) => void): Unsubscribe {
      return store.onWritten(listener);
    },
    lookupThread(raw) {
      const parsed = parse(ThreadIdSchema, raw);
      if (!parsed.ok) return ok(undefined);
      const exists = env.threadExists(parsed.value);
      if (!exists.ok) return exists;
      return ok(exists.value ? parsed.value : undefined);
    },
    traceTurn(threadId, rawTurnId) {
      if (!deps.traceRead.enabled()) return { traceEnabled: false, retained: false, entries: [] };
      const turnId = parse(TurnIdSchema, rawTurnId);
      const found = turnId.ok ? deps.traceRead.turn(threadId, turnId.value) : undefined;
      return found ?? { traceEnabled: true, retained: false, entries: [] };
    },
    testRunMarker: (threadId) => markerOf(threadId),
    registerTestRun(threadId, profileId, runGroupId, draftsJson) {
      markers.set(threadId, {
        profileId,
        target: null,
        paused: false,
        ...(draftedOf(draftsJson ?? null) ? { kind: "draft", draft: true } : {}),
        ...(runGroupId === undefined ? {} : { runGroupId }),
        ...(autoApprovedOf(draftsJson ?? null) ? { draftApproval: "auto" } : {}),
      });
      deps.env.testRunMarks?.remember(threadId, profileId, "test", runGroupId, draftsJson);
    },
    controlTestRun(threadId, op) {
      const marker = markerOf(threadId);
      if (marker === undefined) return err({ kind: "not_a_test_run" });
      const done = deps.testRunControl[op](threadId);
      if (done.ok) markers.set(threadId, { ...marker, paused: done.value.paused });
      return done;
    },
    testRunPhase(threadId) {
      if (markerOf(threadId) === undefined) return err({ kind: "not_a_test_run" });
      return deps.testRunControl.phase(threadId);
    },
  };
}
