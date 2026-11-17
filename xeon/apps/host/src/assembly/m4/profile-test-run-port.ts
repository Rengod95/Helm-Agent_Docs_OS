import { join } from "node:path";
import { err, ok, parse, type Result } from "@fresnel/contracts";
import { ThreadIdSchema, TurnIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { checkSettingWrite, type ScopeStack } from "@fresnel/contracts/settings";
import type { RegistrationInfo } from "@fresnel/ext-host";
import type {
  CommonGetResult,
  CommonInput,
  CommonPutParams,
  CommonSet,
  PermissionChange,
  ProfilePluginCost,
  PluginRef,
  Profile,
  ProfileCloneParams,
  ProfileCostFigures,
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
  Unsubscribe,
} from "@fresnel/contracts/wire";
import type {
  ProfilePortFailure,
  ProfilePreviewRequest,
  ProfileTestRunPort,
} from "../../handlers/m4/profile-test-run.ts";
import type { ProfilesChange, ProfilesWritten } from "./profile-store.ts";
import { createProfileStore } from "./profile-store.ts";
import {
  factoryDefaultProfile,
  DEFAULT_PROFILE_ID,
  PERMISSION_MODE_KEY,
} from "./profile-defaults.ts";
import {
  hasBlockingIssue,
  validateProfile,
  type ProfileBody,
  type ProfileCatalog,
  type ProfileLibrary,
  type ProfileLibraryEntry,
} from "./profile-validate.ts";
import type { M4HostEnv, M4PortDeps } from "./deps.ts";
import type { LegacyInputs } from "./profile-migrate.ts";

// ProfileTestRun 포트 구현(M5c §3.4, §4.2). 프로필 저장은 `profile-store.ts`, 검증은 `profile-validate.ts`가 한다.
// 이 파일은 저장된 내용을 읽고, 검증을 거쳐 쓰고, 미리 보기 값을 계산한다. 대화에 켜짐을 적용하지 않는다(E(T)는 나중 작업이다).

/** 플러그인 하나의 매니페스트 사실. 라이브러리가 검증에 쓴다 */
export interface PluginFact {
  readonly name: string;
  /** 대체하는 내장 도구(`PluginDecl.replaces`를 모두 모은 것) */
  readonly replaces: readonly string[];
  /** 시작 Drive를 등록할 수 있는가(`PluginDecl.drives`) */
  readonly drives: boolean;
  /** 필수 설정 키(`userConfig`의 `required` 항목) */
  readonly requiredKeys: readonly string[];
}

export interface ProfileTestRunPortDeps extends Pick<
  M4PortDeps,
  "traceRead" | "testRunControl" | "env" | "projects"
> {
  /** 설치된 플러그인의 매니페스트 사실. 확장 읽기 원천에서 온다 */
  readonly pluginFacts: () => readonly PluginFact[];
}

/** 비용을 셀 수 없을 때의 값. 정적 추정이 아직 없다(카드 비용은 나중 작업) */
const UNKNOWN_COST: ProfileCostFigures = {
  always: null,
  drive: null,
  onDemand: null,
  toolCount: null,
  basis: "unknown",
};

const EMPTY_BODY: ProfileBody = { plugins: [], settings: [], driver: null };
const NO_LAYERS: ScopeStack = [];
const EXT_KEY = /^ext\.([^.]+)\./u;

/** `ext.<name>.<key>`의 소유 플러그인. 코어 키는 null */
function ownerOf(key: string): string | null {
  const match = EXT_KEY.exec(key);
  return match?.[1] ?? null;
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

function libraryOf(env: M4HostEnv, facts: readonly PluginFact[]): ProfileLibrary {
  return {
    lookup(name): ProfileLibraryEntry | undefined {
      const fact = facts.find((item) => item.name === name);
      if (fact === undefined) return undefined;
      const infos: readonly RegistrationInfo[] = env
        .registrations()
        .filter((info) => info.extension === name);
      return {
        name,
        // 검토함이 들어오기 전까지 설치된 확장은 검토된 것으로 본다(설치 승인 경로가 검토를 대신했다)
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
    managedDisabled(plugin) {
      const managed = env.settings.layers(undefined).find((layer) => layer.scope === "managed");
      return managed?.values.get(`ext.${plugin}.enabled`) === false;
    },
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

function sameNames(left: readonly PluginRef[], right: readonly PluginRef[]): boolean {
  return left.length === right.length && left.every((ref, at) => right[at]?.name === ref.name);
}

function unknownCostByPlugin(plugins: readonly PluginRef[]): readonly ProfilePluginCost[] {
  return plugins.map((ref) => ({ plugin: ref.name, cost: UNKNOWN_COST }));
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
  return effectiveProfiles(stored, factory).find((profile) => profile.id === id);
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
    };
    markers.set(threadId, restored);
    return restored;
  }

  /**
   * 검증기를 만든다. 시크릿 이름과 플러그인 사실은 쓰기 잠금 밖에서 한 번 읽는다(검증 함수는 동기다).
   * 저장된 목록을 바꾸는 계산은 이 함수가 돌려준 검증기를 잠금 안에서 쓴다.
   */
  async function checksOf(): Promise<
    (body: ProfileBody, common: CommonSet) => readonly ProfileIssue[]
  > {
    const names = await env.secretNames();
    const lib = libraryOf(env, deps.pluginFacts());
    const catalog = catalogOf(env, names);
    return (body, common) => validateProfile(body, common, lib, catalog);
  }

  /**
   * 이 프로필을 참조하는 열린 대화 수(M5c §4.1.14). 대화가 저장한 프로필 id가 `stored`(저장된 프로필 id 목록)에 없으면
   * 기본을 쓰는 것으로 센다(§4.1.1). 지우는 경우 `stored`는 지우기 전 목록이다.
   */
  function threadsUsing(profileId: string, stored: ReadonlySet<string>): number {
    let count = 0;
    for (const saved of env.openThreadProfiles()) {
      const effective = saved !== null && stored.has(saved) ? saved : DEFAULT_PROFILE_ID;
      if (effective === profileId) count += 1;
    }
    return count;
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
    async put(
      input: ProfileInput,
      baseRev: number | null,
    ): Promise<Result<ProfilePutResult, ProfilePortFailure>> {
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
        const profile: Profile = {
          id: input.id,
          title: input.title,
          builtin: input.id === DEFAULT_PROFILE_ID,
          plugins: input.plugins,
          settings: input.settings,
          driver: input.driver,
          updatedAt: isoNow(env.clock.now()),
          rev: (storedRev ?? 0) + 1,
        };
        const issues = issuesOf(profile, snapshot.common);
        if (hasBlockingIssue(issues)) return err({ kind: "invalid" as const, issues });
        const next =
          existing === undefined
            ? [...snapshot.profiles, profile]
            : snapshot.profiles.map((item) => (item.id === input.id ? profile : item));
        return ok({
          profiles: next,
          common: snapshot.common,
          value: { profile, issues: issues.filter((issue) => issue.severity === "warning") },
        });
      });
      if (!done.ok) return done;
      return ok(done.value.value);
    },
    async remove(id): Promise<Result<ProfileDeleteResult, ProfilePortFailure>> {
      if (id === DEFAULT_PROFILE_ID) return err({ kind: "builtin_protected", id });
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
    async clone(
      params: ProfileCloneParams,
    ): Promise<Result<{ readonly profile: Profile }, ProfilePortFailure>> {
      if (params.newId === DEFAULT_PROFILE_ID)
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
          driver: source.driver,
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
        issues: issuesOf(EMPTY_BODY, snapshot.value.common),
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
        const next: CommonSet = {
          plugins: input.plugins,
          settings: input.settings,
          updatedAt: isoNow(env.clock.now()),
          rev: snapshot.common.rev + 1,
        };
        const issues = issuesOf(EMPTY_BODY, next);
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
      const common = snapshot.value.common;
      const issuesOf = await checksOf();
      const issues = issuesOf(body, common);
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
      const permission = permissionOf(body, common, threadId);
      return ok({
        resolved,
        issues,
        cost: { total: UNKNOWN_COST, byPlugin: unknownCostByPlugin(resolved) },
        missingRequired,
        threadsUsing: threadsUsing(id, idsOf(snapshot.value.profiles)),
        ...(permission === undefined ? {} : { permission }),
        // 드라이브 프레임과 도구 목록은 아직 이 호스트가 셀 수 없다(E(T)와 Drive 프레임은 나중 작업). 그래서 이 값들을 싣지 않는다
        dropsDrive: null,
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
      const issuesOf = await checksOf();
      const done = await store.transact<
        {
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
        // 그 플러그인의 설정 값도 함께 뺀다. 남겨 두면 소유 플러그인이 없어 저장이 막힌다(§4.2.2)
        const profile: Profile = {
          ...current,
          plugins: current.plugins.filter((ref) => ref.name !== params.plugin),
          settings: current.settings.filter((setting) => ownerOf(setting.key) !== params.plugin),
          driver: current.driver === params.plugin ? null : current.driver,
          updatedAt: isoNow(env.clock.now()),
          rev: current.rev + 1,
        };
        const issues = issuesOf(profile, snapshot.common);
        if (hasBlockingIssue(issues)) return err({ kind: "invalid" as const, issues });
        const next = snapshot.profiles.some((item) => item.id === profile.id)
          ? snapshot.profiles.map((item) => (item.id === profile.id ? profile : item))
          : [...snapshot.profiles, profile];
        return ok({
          profiles: next,
          common: snapshot.common,
          value: { profile, common: snapshot.common, known: idsOf(snapshot.profiles) },
        });
      });
      if (!done.ok) return done;
      const { profile, common, known } = done.value.value;
      const permission = permissionOf(profile, common, undefined);
      return ok({
        profile,
        preview: {
          threadsUsing: threadsUsing(profile.id, known),
          ...(permission === undefined ? {} : { permission }),
          dropsDrive: null,
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
    registerTestRun(threadId, profileId) {
      markers.set(threadId, { profileId, target: null, paused: false });
      deps.env.testRunMarks?.remember(threadId, profileId);
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
