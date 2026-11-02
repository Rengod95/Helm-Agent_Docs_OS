import { assertNever, err, ok } from "@fresnel/contracts";
import {
  effectiveLayer,
  HOOKS,
  isGroupExtension,
  pluginsOf,
  type ExtensionManifest,
  type HookName,
  type PluginEntry,
  type RegistrationStatus,
} from "@fresnel/contracts/extensions";
import type { GroupStatus } from "@fresnel/contracts/services";
import {
  resolveSetting,
  type ScopeStack,
  type SettingCatalog,
  type SettingScope,
} from "@fresnel/contracts/settings";
import type {
  CapabilityBinding,
  EnabledSource,
  ExtBindingEdge,
  ExtDiagnostic,
  ExtHealthEntry,
  ExtListEntry,
  ExtListPlugin,
  GroupDriveLockResult,
  GroupMetricsFull,
  GroupPromotionResult,
  GroupStatusWire,
  HookEntry,
  SafeModeCause,
  SettingWriter,
} from "@fresnel/contracts/wire";
import type { ExtReadPort, ExtReadResult } from "../../handlers/m4/ext-read.ts";
import type { M4PortDeps } from "./deps.ts";

// ExtRead 포트 구현(`spec-deltas/t-wa.md` §1). 원천은 `ExtReadSources`가 돌려주는 읽기 값이고(조립 루트가 로더, 실패 장부,
// `GroupService`, 설정 엔진을 얇게 감싸 넘긴다), 이 파일은 그 값을 wire 모양으로 옮긴다. 값을 새로 계산하지 않는다(§2 1번).
// 원천이 없는 호스트(`createExtReadPort(deps)`)는 확장이 없는 것처럼 읽는다.

interface SafeModeState {
  readonly active: boolean;
  /** `host.status.safeModeCause`와 같은 원인. 안전 모드가 아니면 null */
  readonly cause: SafeModeCause | null;
}

/** 확장 하나의 로더 상태와 매니페스트. 안전 모드로 싣지 않은 확장도 찾아냈다면 `loaded: false`로 올린다 */
export interface ExtensionRecord {
  readonly manifest: ExtensionManifest;
  readonly location: string;
  readonly requestedGrade: string;
  readonly effectiveGrade: string;
  readonly tier: string | null;
  readonly loaded: boolean;
  readonly diagnostics: readonly ExtDiagnostic[];
}

/** 실패 장부 한 확장의 읽기(`ext.health`). 장부 키는 `ext:<이름>`이다 */
interface ExtHealthStats {
  readonly consecutiveFailures: number;
  readonly windowFailures: number;
  readonly windowMs: number;
  readonly lastFailureAt: string | null;
  readonly lastError: string | null;
}

interface SettingExplainSource {
  readonly catalog: SettingCatalog;
  readonly layers: (threadId: string) => ScopeStack;
  /** 프로필·Test run 맥락이 그 값을 쓴 쪽이면 그 맥락. 없으면 undefined(T-WB가 채운다) */
  readonly writerContext?: (
    key: string,
    threadId: string,
  ) => { readonly writer: "profile" | "testRun"; readonly profileId?: string } | undefined;
}

export interface ExtReadSources {
  safeMode(): SafeModeState;
  /** Hook의 예산 등급과 유효 예산(ms). X.operations §4.2.2 표와 설정 `x.operations.budget.*`의 값 */
  budget(hook: HookName): { readonly budgetClass: string; readonly budgetMs: number };
  threadKnown(threadId: string, signal: AbortSignal): Promise<boolean>;
  extensions(): readonly ExtensionRecord[];
  /** 호스트의 Registration 상태(전역 기본값) */
  registrations(): readonly { readonly id: string; readonly status: RegistrationStatus }[];
  /** 그 대화에서의 Registration 상태. 대화가 열려 있지 않으면 undefined */
  threadStatus(threadId: string, registrationId: string): RegistrationStatus | undefined;
  /** `managed ?? thread ?? project ?? user ?? default`에서 이긴 층(T-REG §7 2번) */
  enabledSource(registrationId: string, threadId: string | undefined): EnabledSource;
  /** `ext.<이름>.enabled`가 managed 범위에서 잠겼는가 */
  managedLocked(name: string): boolean;
  health(name: string): ExtHealthStats;
  autoDisabled(name: string): boolean;
  /** `AutoDisabler.reenable(ext:<이름>)`. 장부를 비우고 켜기를 요청한다 */
  reenable(name: string): void;
  /** 로더 핫 리로드. 진단 위치(`file:line`)를 돌려준다 */
  reload(name: string, signal: AbortSignal): Promise<readonly ExtDiagnostic[]>;
  /** `GroupService.list()` */
  groups(): readonly GroupStatus[];
  /** 그룹 하나의 전체 지표. 모르는 그룹은 undefined, 계측이 꺼져 있으면 null */
  groupMetrics(id: string, since: string | undefined): GroupMetricsFull | null | undefined;
  /** 학습 그룹의 승격 후보 읽기. 학습 그룹이 꺼져 있으면 빈 후보 */
  promotion(threadIds: readonly string[] | undefined): GroupPromotionResult;
  driveLock(threadId: string): GroupDriveLockResult;
  settings: SettingExplainSource;
}

const NO_SETTINGS: SettingExplainSource = { catalog: new Map(), layers: () => [] };

/** 원천이 없을 때. 확장과 그룹이 없는 호스트처럼 읽힌다 */
export const EMPTY_EXT_READ_SOURCES: ExtReadSources = {
  safeMode: () => ({ active: false, cause: null }),
  budget: (hook) => ({ budgetClass: HOOKS[hook].fold, budgetMs: 0 }),
  threadKnown: () => Promise.resolve(true),
  extensions: () => [],
  registrations: () => [],
  threadStatus: () => undefined,
  enabledSource: () => "default",
  managedLocked: () => false,
  health: () => ({
    consecutiveFailures: 0,
    windowFailures: 0,
    windowMs: 0,
    lastFailureAt: null,
    lastError: null,
  }),
  autoDisabled: () => false,
  reenable: () => {},
  reload: () => Promise.resolve([]),
  groups: () => [],
  groupMetrics: () => undefined,
  promotion: () => ({ throughSeq: 0, threads: 0, candidates: [] }),
  driveLock: () => ({
    holder: null,
    leaseEpoch: 0,
    activeDriver: null,
    limits: { turns: 0, spawns: 0, tokens: null },
    used: { turns: 0, spawns: 0, tokens: 0 },
    candidates: [],
    lastRejected: null,
  }),
  settings: NO_SETTINGS,
};

function isHookName(name: string): name is HookName {
  return Object.hasOwn(HOOKS, name);
}

function unknownExtension(name: string): ExtReadResult<never> {
  return err({ kind: "unknown_extension", name });
}

function representative(entries: readonly PluginEntry[]): PluginEntry | undefined {
  return entries.find((entry) => entry.root) ?? entries[0];
}

function writerOf(scope: SettingScope | null): SettingWriter {
  switch (scope) {
    case null:
      return "default";
    case "launch":
      return "session";
    case "managed":
    case "user":
    case "project":
    case "local":
      return "user";
    default:
      return assertNever(scope, "SettingScope");
  }
}

function statusOf(
  registrationId: string,
  loaded: boolean,
  infos: ReadonlyMap<string, RegistrationStatus>,
): RegistrationStatus {
  if (!loaded) return "disabled";
  return infos.get(registrationId) ?? "disabled";
}

export function createExtReadPort(
  deps: Pick<M4PortDeps, "traceRead">,
  sources: ExtReadSources = EMPTY_EXT_READ_SOURCES,
): ExtReadPort {
  function entryOf(
    record: ExtensionRecord,
    infos: ReadonlyMap<string, RegistrationStatus>,
    threadId: string | undefined,
    safe: SafeModeState,
  ): ExtListEntry {
    const manifest = record.manifest;
    const entries = pluginsOf(manifest);
    const plugins: ExtListPlugin[] = entries.map((entry) => {
      const thread =
        threadId === undefined ? undefined : sources.threadStatus(threadId, entry.registrationId);
      return {
        registrationId: entry.registrationId,
        ...(entry.decl.id === undefined ? {} : { id: entry.decl.id }),
        layer: entry.decl.layer,
        status: statusOf(entry.registrationId, record.loaded, infos),
        ...(thread === undefined ? {} : { thread }),
        inGroup: entry.inGroup,
        enabledSource: sources.enabledSource(entry.registrationId, threadId),
      };
    });
    const head = plugins.find((plugin) => plugin.id === undefined) ?? plugins[0];
    if (head === undefined) throw new Error("a manifest always has a plugin");
    return {
      name: manifest.name,
      displayName: manifest.displayName ?? manifest.name,
      layer: effectiveLayer(manifest),
      isGroup: isGroupExtension(manifest),
      version: manifest.version,
      location: record.location,
      requestedGrade: record.requestedGrade,
      effectiveGrade: record.effectiveGrade,
      tier: record.tier,
      status: head.status,
      ...(head.thread === undefined ? {} : { registration: head.thread }),
      ...(head.enabledSource === undefined ? {} : { enabledSource: head.enabledSource }),
      plugins,
      diagnostics: record.diagnostics,
      autoDisabled: sources.autoDisabled(manifest.name),
      safeModeExcluded: !record.loaded && safe.active ? (safe.cause ?? "flag") : null,
      hookCount: entries.reduce((sum, entry) => sum + entry.decl.hooks.length, 0),
    };
  }

  function statusMap(): ReadonlyMap<string, RegistrationStatus> {
    return new Map(sources.registrations().map((info) => [info.id, info.status]));
  }

  async function checkThread(
    threadId: string | undefined,
    signal: AbortSignal,
  ): Promise<ExtReadResult<void>> {
    if (threadId === undefined) return ok(undefined);
    if (await sources.threadKnown(threadId, signal)) return ok(undefined);
    return err({ kind: "unknown_thread", threadId });
  }

  function findRecord(name: string): ExtensionRecord | undefined {
    return sources.extensions().find((record) => record.manifest.name === name);
  }

  /** 능력 id별로 제공자와 소비자를 모은다. 범위(semver) 대조는 하지 않고 id가 같은 제공자를 짝으로 본다 */
  function bindingsOf(
    infos: ReadonlyMap<string, RegistrationStatus>,
    threadId: string | undefined,
  ): readonly CapabilityBinding[] {
    const statusFor = (registrationId: string): RegistrationStatus =>
      (threadId === undefined ? undefined : sources.threadStatus(threadId, registrationId)) ??
      infos.get(registrationId) ??
      "disabled";
    const table = new Map<
      string,
      {
        provider: { registrationId: string; version: string } | null;
        consumers: { registrationId: string; relation: "requires" | "optional" }[];
      }
    >();
    const slot = (capability: string) => {
      const found = table.get(capability);
      if (found !== undefined) return found;
      const created = { provider: null, consumers: [] };
      table.set(capability, created);
      return created;
    };
    for (const record of sources.extensions()) {
      for (const entry of pluginsOf(record.manifest)) {
        for (const provided of entry.decl.provides ?? []) {
          const row = slot(provided.id);
          if (row.provider === null || statusFor(entry.registrationId) === "enabled") {
            row.provider = { registrationId: entry.registrationId, version: provided.version };
          }
        }
        for (const need of entry.decl.requires ?? []) {
          slot(need.id).consumers.push({
            registrationId: entry.registrationId,
            relation: "requires",
          });
        }
        for (const want of entry.decl.optional ?? []) {
          slot(want.id).consumers.push({
            registrationId: entry.registrationId,
            relation: "optional",
          });
        }
      }
    }
    return [...table.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([capability, row]) => ({
        capability,
        provider: row.provider,
        consumers: row.consumers,
        unmet:
          row.provider === null &&
          row.consumers.some((consumer) => consumer.relation === "requires"),
      }));
  }

  function edgesOf(
    record: ExtensionRecord,
    infos: ReadonlyMap<string, RegistrationStatus>,
  ): readonly ExtBindingEdge[] {
    const table = bindingsOf(infos, undefined);
    const edges: ExtBindingEdge[] = [];
    for (const entry of pluginsOf(record.manifest)) {
      for (const provided of entry.decl.provides ?? []) {
        edges.push({
          registrationId: entry.registrationId,
          capability: provided.id,
          relation: "provides",
          peer: null,
          satisfied: true,
        });
      }
      const wants = [
        ...(entry.decl.requires ?? []).map((need) => ({
          id: need.id,
          relation: "requires" as const,
        })),
        ...(entry.decl.optional ?? []).map((want) => ({
          id: want.id,
          relation: "optional" as const,
        })),
      ];
      for (const want of wants) {
        const provider = table.find((row) => row.capability === want.id)?.provider ?? null;
        edges.push({
          registrationId: entry.registrationId,
          capability: want.id,
          relation: want.relation,
          peer: provider?.registrationId ?? null,
          satisfied: provider !== null,
        });
      }
    }
    return edges;
  }

  const port: ExtReadPort = {
    async list(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      const infos = statusMap();
      const safe = sources.safeMode();
      return ok({
        extensions: sources
          .extensions()
          .map((record) => entryOf(record, infos, params.threadId, safe)),
      });
    },

    get(params) {
      const record = findRecord(params.name);
      if (record === undefined) return Promise.resolve(unknownExtension(params.name));
      const infos = statusMap();
      const hooks = pluginsOf(record.manifest).flatMap((entry) =>
        entry.decl.hooks.map((hook) => ({
          registrationId: entry.registrationId,
          hook,
          ...sources.budget(hook),
        })),
      );
      return Promise.resolve(
        ok({
          entry: entryOf(record, infos, undefined, sources.safeMode()),
          manifest: { ...record.manifest },
          hooks,
          bindings: edgesOf(record, infos),
        }),
      );
    },

    reenable(params) {
      if (sources.safeMode().active) return Promise.resolve(err({ kind: "safe_mode_active" }));
      if (findRecord(params.name) === undefined) {
        return Promise.resolve(unknownExtension(params.name));
      }
      if (sources.managedLocked(params.name)) {
        return Promise.resolve(err({ kind: "managed_locked", name: params.name }));
      }
      sources.reenable(params.name);
      return Promise.resolve(ok({ appliesAt: "nextStepBoundary", diagnostics: [] }));
    },

    async reload(params, signal) {
      if (sources.safeMode().active) return err({ kind: "safe_mode_active" });
      if (findRecord(params.name) === undefined) return unknownExtension(params.name);
      return ok({
        appliesAt: "nextStepBoundary",
        diagnostics: await sources.reload(params.name, signal),
      });
    },

    async health(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      const records =
        params.name === undefined
          ? sources.extensions()
          : sources.extensions().filter((record) => record.manifest.name === params.name);
      if (params.name !== undefined && records.length === 0) return unknownExtension(params.name);
      const health: ExtHealthEntry[] = records.map((record) => {
        const stats = sources.health(record.manifest.name);
        const head = representative(pluginsOf(record.manifest));
        return {
          name: record.manifest.name,
          registrationId: head?.registrationId ?? record.manifest.name,
          consecutiveFailures: stats.consecutiveFailures,
          windowFailures: stats.windowFailures,
          windowMs: stats.windowMs,
          autoDisabled: sources.autoDisabled(record.manifest.name),
          lastFailureAt: stats.lastFailureAt,
          lastError: stats.lastError,
        };
      });
      return ok({ health });
    },

    async timings(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      const record = findRecord(params.name);
      if (record === undefined) return unknownExtension(params.name);
      const mine = new Set(pluginsOf(record.manifest).map((entry) => entry.registrationId));
      const measured = deps.traceRead.timings({});
      return ok({
        traceEnabled: measured.traceEnabled,
        timings: measured.timings.filter((timing) => mine.has(timing.registrationId)),
      });
    },

    async bindings(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      return ok({ capabilities: bindingsOf(statusMap(), params.threadId) });
    },

    async groupList(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      const groups: GroupStatusWire[] = sources.groups().map((group) => {
        const scope =
          params.threadId === undefined
            ? group.scope
            : (sources.threadStatus(params.threadId, group.id) ?? group.scope);
        return {
          id: group.id,
          displayName: group.displayName,
          scope,
          pendingToggle: group.pendingToggle,
          usesDrive: group.usesDrive,
          drive: group.drive,
          lastError:
            group.lastError === null
              ? null
              : { kind: group.lastError.kind, message: group.lastError.message },
          metrics: group.metrics,
        };
      });
      return ok({ groups });
    },

    async groupMetrics(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      const metrics = sources.groupMetrics(params.id, params.since);
      if (metrics === undefined) return err({ kind: "unknown_group", id: params.id });
      return ok({ id: params.id, metrics, since: params.since ?? null });
    },

    groupPromotion(params) {
      return Promise.resolve(ok(sources.promotion(params.threadIds)));
    },

    async groupDriveLock(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      return ok(sources.driveLock(params.threadId));
    },

    hooks() {
      const registrations = new Map<string, Set<string>>();
      for (const record of sources.extensions()) {
        for (const entry of pluginsOf(record.manifest)) {
          for (const hook of entry.decl.hooks) {
            const found = registrations.get(hook) ?? new Set<string>();
            found.add(entry.registrationId);
            registrations.set(hook, found);
          }
        }
      }
      const rows: HookEntry[] = [];
      for (const [hook, owners] of registrations) {
        if (!isHookName(hook)) continue;
        rows.push(hookRow(hook, owners));
      }
      return Promise.resolve(ok({ hooks: rows.toSorted((a, b) => (a.hook < b.hook ? -1 : 1)) }));
    },

    async settingExplain(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      const def = sources.settings.catalog.get(params.key);
      if (def === undefined) return err({ kind: "unknown_setting", key: params.key });
      const { setting } = resolveSetting(def, sources.settings.layers(params.threadId));
      const scope = setting.source.scope === "default" ? null : setting.source.scope;
      const context = sources.settings.writerContext?.(params.key, params.threadId);
      return ok({
        key: params.key,
        value: setting.value,
        winningScope: scope,
        writer: context?.writer ?? writerOf(scope),
        ...(context?.profileId === undefined ? {} : { profileId: context.profileId }),
      });
    },
  };
  return port;
}

function hookRow(hook: HookName, owners: ReadonlySet<string>): HookEntry {
  const decl = HOOKS[hook];
  return {
    hook,
    fold: decl.fold,
    handlers: owners.size,
    registrations: [...owners].toSorted(),
    external: decl.pi === undefined,
  };
}
