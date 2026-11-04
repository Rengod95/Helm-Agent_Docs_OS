import { assertNever, err, ok, type Result } from "@fresnel/contracts";
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
  ExtOrigin,
  ExtDiagnostic,
  ExtHealthEntry,
  ExtListEntry,
  ExtListPlugin,
  GroupDriveLockResult,
  GroupMetricsFull,
  GroupPromotionResult,
  GroupStatusWire,
  HookEntry,
  HookGuardRiskNote,
  HookHandlerRow,
  HookOrderEntry,
  HookOrderRef,
  HooksOrderPreviewResult,
  SafeModeCause,
  SettingWriter,
} from "@fresnel/contracts/wire";
import {
  checkOrder,
  hookOrderValue,
  hookIdOfUnit,
  previewOrder,
  TIERS,
  type GuardRiskNote,
  type HookOrderMap,
  type OrderPreview,
  type OrderRow,
  type PreviewRef,
  type PreviewRow,
} from "@fresnel/ext-host";
import type { ExtReadPort, ExtReadResult } from "../../handlers/m4/ext-read.ts";
import type { HostErrorMappers, ProfileWriteFailure } from "../../handlers/m4/profile-test-run.ts";
import type { M4HostEnv, M4PortDeps } from "./deps.ts";

// ExtRead 포트 구현(`spec-deltas/t-wa.md` §1). 원천은 `ExtReadSources`가 돌려주는 읽기 값이고(조립 루트가 로더, 실패 장부,
// `GroupService`, 설정 엔진을 얇게 감싸 넘긴다), 이 파일은 그 값을 wire 모양으로 옮긴다. 값을 새로 계산하지 않는다(§2 1번).
// 실제 원천은 `ext-read-sources.ts`가 만든다. `EMPTY_EXT_READ_SOURCES`는 시험 대역의 바탕이고 호스트 조립은 쓰지 않는다.

interface SafeModeState {
  readonly active: boolean;
  /** `host.status.safeModeCause`와 같은 원인. 안전 모드가 아니면 null */
  readonly cause: SafeModeCause | null;
}

/** 확장 하나의 로더 상태와 매니페스트. 안전 모드로 싣지 않은 확장도 찾아냈다면 `loaded: false`로 올린다 */
export interface ExtensionRecord {
  readonly manifest: ExtensionManifest;
  readonly location: string;
  /** 어디서 실렸는가: 호스트 내장 단위, 또는 로더가 찾은 위치 */
  readonly origin: ExtOrigin;
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
  /** 창 안 호출 수 */
  readonly windowCalls: number;
  /** 창이 덮는 시간(ms): 창 안 가장 오래된 호출부터 지금까지. 창이 비면 0 */
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

/** 훅별 순서 덮어쓰기의 읽기 원천. `OperationsPolicy.hookOrder`를 감싼다 */
interface HookOrderSource {
  /** 저장된 순서(설정 `x.operations.hookOrder`의 현재 값) */
  saved(): HookOrderMap;
  /** 디스패처가 지금 쓰는 순서 */
  applied(): HookOrderMap;
  /** 저장 값과 적용 값이 다르다. 다음 단계 경계에 적용된다 */
  pending(): boolean;
}

/** 설정 `x.operations.hookDefs`에서 읽은 외부 훅 하나(X.operations §4.7). 화면에 실제 id로 보인다 */
export interface ExternalHookView {
  readonly id: string;
  readonly point: HookName;
  readonly source: string;
  /** 정렬 순위(`TIERS`의 인덱스) */
  readonly tierRank: number;
  /** 실행하는 내장 단위의 Registration id */
  readonly unit: string;
}

export interface ExtReadSources {
  safeMode(): SafeModeState;
  /** 이 호스트에서 읽히는 외부 훅. 작업 폴더·로컬 범위는 thread 없이는 보이지 않는다 */
  externalHooks(threadId?: string): readonly ExternalHookView[];
  /** thread의 작업 폴더 설정을 읽어 둔다. 없으면 이미 읽힌 층만 쓴다 */
  prepareThread?(threadId: string): Promise<void>;
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
  /** "끌까요" 질문(결정 2026-11-04 사용자). 묻는 중이 아니면 null */
  keepOffQuestion(name: string): NonNullable<ExtListEntry["keepOffQuestion"]> | null;
  /** `AutoDisabler.reenable(ext:<이름>)`. 장부와 질문을 비우고 켜기를 요청한다("켜 두기" 답) */
  reenable(name: string): void;
  /** "끄기" 답. `AutoDisabler.answer(ext:<이름>, true)`가 auto_disable로 끈다 */
  disableConfirm(name: string): void;
  /** 외부 훅(`hook:<id>`)의 "끌까요" 질문. 묻는 중이 아니면 null */
  hookKeepOffQuestion(hook: string): NonNullable<HookEntry["keepOffQuestion"]> | null;
  /** 외부 훅이 이번 실행에서 자동으로 꺼졌나 */
  hookAutoDisabled(hook: string): boolean;
  /** 이번 실행에서 자동으로 꺼진 외부 훅 id들 */
  hookAutoDisabledIds(): readonly string[];
  /** 설정 `x.operations.hookDisabled`에 저장된 꺼진 훅 id들 */
  hookDisabledSaved(): readonly string[];
  /** 훅 "켜 두기" 답. 질문이 있으면 `answer(hook:<id>, false)`, 없으면 `reenable(hook:<id>)`다 */
  hookReenable(hook: string): void;
  /** 훅 "끄기" 답. `AutoDisabler.answer(hook:<id>, true)`다 */
  hookDisableConfirm(hook: string): void;
  /**
   * 로더 핫 리로드(X.loading-trust §4.4.4). 새 버전을 검사하고 단계 경계에서 바꾼다. 열린 thread가 실행 중이 아니면 이 호출이 돌아올 때 적용이 끝나 있다(`now`)
   * 실행 중인 turn이 있으면 그 step이 끝난 경계에 적용한다(`nextStepBoundary`). 검사 실패와 `now`일 때의 적용 실패는 진단으로 돌려준다
   */
  reload(
    name: string,
    signal: AbortSignal,
  ): Promise<{
    readonly appliesAt: "now" | "nextStepBoundary";
    readonly diagnostics: readonly ExtDiagnostic[];
  }>;
  /** `GroupService.list()` */
  groups(): readonly GroupStatus[];
  /** 그룹 하나의 전체 지표. 모르는 그룹은 undefined, 계측이 꺼져 있으면 null */
  groupMetrics(
    id: string,
    query: { readonly since: string | undefined; readonly threadId: string | undefined },
  ): Promise<GroupMetricsFull | null | undefined>;
  /** 승격 후보 읽기. 학습 그룹이 꺼져 있으면 빈 후보 */
  promotion(threadIds: readonly string[] | undefined): Promise<GroupPromotionResult>;
  driveLock(threadId: string): Promise<GroupDriveLockResult>;
  /** 호스트 핸들러 레지스트리의 실제 등록. 지점 이름 오름차순, 안에서는 디스패치 순서(`ExtReadView.handlers`) */
  hookHandlers(): readonly {
    readonly point: HookName;
    readonly registrationId: string;
    readonly extension: string;
    readonly tier: number;
    /** 기본 정렬의 둘째와 셋째 키(tier, loadIndex, seq). 순서 제안은 이 기본 순서에 얹힌다 */
    readonly loadIndex: number;
    readonly seq: number;
  }[];
  /** 훅별 순서 덮어쓰기(X.operations §4.1.5): 저장 값, 적용 중인 값, 저장 값과 적용 값이 다른가 */
  hookOrder(): HookOrderSource;
  /** ExtHost가 지금 바인딩한 기능 공급자(기능 id 오름차순) */
  boundCapabilities(): readonly {
    readonly capability: string;
    readonly provider: string;
    readonly version: string;
  }[];
  /** 호스트 전체의 Registration 상태와 마지막 오류 코드. 모든 scope가 나온다(켜진 것, 꺼진 것, setup에 실패한 것) */
  registrationErrors(): ReadonlyMap<string, string>;
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
    windowCalls: 0,
    windowMs: 0,
    lastFailureAt: null,
    lastError: null,
  }),
  autoDisabled: () => false,
  keepOffQuestion: () => null,
  reenable: () => {},
  disableConfirm: () => {},
  hookKeepOffQuestion: () => null,
  hookAutoDisabled: () => false,
  hookAutoDisabledIds: () => [],
  hookDisabledSaved: () => [],
  hookReenable: () => {},
  hookDisableConfirm: () => {},
  externalHooks: () => [],
  reload: () => Promise.resolve({ appliesAt: "nextStepBoundary", diagnostics: [] }),
  groups: () => [],
  groupMetrics: () => Promise.resolve(undefined),
  promotion: () => Promise.resolve({ throughSeq: 0, threads: 0, candidates: [] }),
  driveLock: () =>
    Promise.resolve({
      holder: null,
      leaseEpoch: 0,
      activeDriver: null,
      limits: { turns: 0, spawns: 0, tokens: null },
      used: { turns: 0, spawns: 0, tokens: 0 },
      candidates: [],
      lastRejected: null,
    }),
  hookHandlers: () => [],
  hookOrder: () => ({ saved: () => new Map(), applied: () => new Map(), pending: () => false }),
  boundCapabilities: () => [],
  registrationErrors: () => new Map(),
  settings: NO_SETTINGS,
};

/** 순서 덮어쓰기가 쓰는 환경: 설정 저장소의 쓰기와 되돌리기, 저장소 오류 옮기기. `M4HostEnv`의 부분이다 */
interface HookOrderEnv {
  readonly settings: Pick<M4HostEnv["settings"], "write" | "reset">;
  readonly errors: HostErrorMappers;
}

/** 순서 덮어쓰기를 저장하는 설정 키. 범위는 `user`다(X.operations §4.1.5) */
const HOOK_ORDER_KEY = "x.operations.hookOrder";

/** 꺼진 외부 훅 id를 저장하는 설정 키. 범위는 `user`이고 재시작 뒤에도 꺼진 채다(결정 2026-11-04 사용자) */
const HOOK_DISABLED_KEY = "x.operations.hookDisabled";

/** 같은 순서인가(둘 다 같은 자리에 같은 Registration id) */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 자동 끄기 면제 판정의 입력. guard 핸들러와 core tier는 면제다(X.operations §4.1.5). essential 확장의 표시는 원천에 없다 */
function previewRowOf(row: OrderRow): PreviewRow {
  return {
    ...row,
    exempt: row.tier === TIERS.indexOf("guard") || row.tier === TIERS.indexOf("core"),
  };
}

function orderRefOf(ref: PreviewRef): HookOrderRef {
  return { registrationId: ref.registrationId, extension: ref.extension, tier: ref.tier };
}

function guardRiskOf(note: GuardRiskNote): HookGuardRiskNote {
  return {
    registrationId: note.registrationId,
    extension: note.extension,
    mayBeSkipped: note.mayBeSkipped,
    losesFirstPosition: note.losesFirstPosition,
    by: note.by.map(orderRefOf),
  };
}

/**
 * 미리보기 결과를 wire 모양으로 옮긴다. 값은 새로 계산하지 않는다.
 * 저장을 막는 사유가 없으므로 `saveable`은 항상 참이다. guard의 위험은 `guardRisk`로 따로 알린다.
 */
function previewResultOf(preview: OrderPreview): HooksOrderPreviewResult {
  return {
    hook: preview.hook,
    order: [...preview.order],
    saveable: true,
    guardRisk: preview.guardRisk.map(guardRiskOf),
    skips: preview.skips.map((note) => ({
      registrationId: note.registrationId,
      extension: note.extension,
      reason: note.reason,
      by: note.by.map(orderRefOf),
    })),
    valueChanges: preview.valueChanges.map((note) => ({
      registrationId: note.registrationId,
      extension: note.extension,
      by: note.by.map(orderRefOf),
    })),
    autoDisable: preview.autoDisable.map((note) => ({
      registrationId: note.registrationId,
      extension: note.extension,
      affects: note.affects.map(orderRefOf),
    })),
  };
}

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
  deps: Pick<M4PortDeps, "traceRead"> & { readonly env: HookOrderEnv },
  sources: ExtReadSources,
): ExtReadPort {
  /**
   * 훅의 기본 순서 행(tier, loadIndex, seq). 순서 제안은 현재 적용 순서가 아니라 이 기본 순서에 얹힌다.
   * 저장된 순서는 적용 전이어도 기본 순서를 기준으로 검사한다.
   */
  function defaultRowsOf(hook: HookName): OrderRow[] {
    return sources
      .hookHandlers()
      .filter((handler) => handler.point === hook)
      .toSorted((a, b) => a.tier - b.tier || a.loadIndex - b.loadIndex || a.seq - b.seq)
      .map((handler) => ({
        registrationId: handler.registrationId,
        extension: handler.extension,
        tier: handler.tier,
      }));
  }

  /** 순서 전체를 설정 값으로 쓴다. 비면 설정을 지워 기본값(`{}`)으로 돌린다 */
  function writeOrder(map: HookOrderMap): Promise<Result<void, ProfileWriteFailure>> {
    return map.size === 0
      ? deps.env.settings.reset("user", HOOK_ORDER_KEY, undefined)
      : deps.env.settings.write("user", HOOK_ORDER_KEY, hookOrderValue(map), undefined);
  }

  /** 훅의 "끌까요" 질문과 꺼짐 표시. 해당하지 않는 필드는 싣지 않는다 */
  function hookStateOf(hook: string): Pick<HookEntry, "keepOffQuestion" | "autoDisabled"> {
    const question = sources.hookKeepOffQuestion(hook);
    const off = sources.hookAutoDisabled(hook) || sources.hookDisabledSaved().includes(hook);
    return {
      ...(question === null ? {} : { keepOffQuestion: question }),
      ...(off ? { autoDisabled: true } : {}),
    };
  }

  /** 꺼진 훅 id 목록을 설정 값으로 쓴다. 비면 설정을 지워 기본값(`[]`)으로 돌린다 */
  function writeHookDisabled(ids: readonly string[]): Promise<Result<void, ProfileWriteFailure>> {
    return ids.length === 0
      ? deps.env.settings.reset("user", HOOK_DISABLED_KEY, undefined)
      : deps.env.settings.write("user", HOOK_DISABLED_KEY, [...ids], undefined);
  }

  /** 질문이 있거나 꺼져 있거나 꺼짐이 저장된 훅인가. 아니면 답할 대상이 없다 */
  function hookKnown(hook: string): boolean {
    return (
      sources.hookKeepOffQuestion(hook) !== null ||
      sources.hookAutoDisabled(hook) ||
      sources.hookDisabledSaved().includes(hook)
    );
  }

  /** 묻는 중이면 `keepOffQuestion` 필드를 더한다. 아니면 필드를 싣지 않는다 */
  function keepOffOf(name: string): {
    readonly keepOffQuestion?: NonNullable<ExtListEntry["keepOffQuestion"]>;
  } {
    const question = sources.keepOffQuestion(name);
    return question === null ? {} : { keepOffQuestion: question };
  }

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
      origin: record.origin,
      requestedGrade: record.requestedGrade,
      effectiveGrade: record.effectiveGrade,
      tier: record.tier,
      status: head.status,
      ...(head.thread === undefined ? {} : { registration: head.thread }),
      ...(head.enabledSource === undefined ? {} : { enabledSource: head.enabledSource }),
      plugins,
      diagnostics: record.diagnostics,
      autoDisabled: sources.autoDisabled(manifest.name),
      ...keepOffOf(manifest.name),
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
  function bindingsOf(): readonly CapabilityBinding[] {
    const bound = new Map(sources.boundCapabilities().map((item) => [item.capability, item]));
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
        // 공급자는 ExtHost가 지금 실제로 바인딩한 확장의 것이다. 선언만 있고 바인딩되지 않은 기능은 공급자가 없다
        for (const provided of entry.decl.provides ?? []) {
          const row = slot(provided.id);
          const live = bound.get(provided.id);
          if (live !== undefined && live.provider === record.manifest.name) {
            row.provider = { registrationId: entry.registrationId, version: live.version };
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

  function edgesOf(record: ExtensionRecord): readonly ExtBindingEdge[] {
    const table = bindingsOf();
    const edges: ExtBindingEdge[] = [];
    for (const entry of pluginsOf(record.manifest)) {
      for (const provided of entry.decl.provides ?? []) {
        edges.push({
          registrationId: entry.registrationId,
          capability: provided.id,
          relation: "provides",
          peer: null,
          satisfied:
            table.find((row) => row.capability === provided.id)?.provider?.registrationId ===
            entry.registrationId,
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
          bindings: edgesOf(record),
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

    disableConfirm(params) {
      if (sources.safeMode().active) return Promise.resolve(err({ kind: "safe_mode_active" }));
      if (findRecord(params.name) === undefined) {
        return Promise.resolve(unknownExtension(params.name));
      }
      if (sources.managedLocked(params.name)) {
        return Promise.resolve(err({ kind: "managed_locked", name: params.name }));
      }
      sources.disableConfirm(params.name);
      return Promise.resolve(ok({ appliesAt: "nextStepBoundary", diagnostics: [] }));
    },

    async hookDisableConfirm(params) {
      if (sources.safeMode().active) return err({ kind: "safe_mode_active" });
      const hook = params.hook;
      if (!hookKnown(hook)) return err({ kind: "unknown_hook", hook });
      // 먼저 꺼짐을 설정에 쓴다. 쓰기가 실패하면 끄기를 요청하지 않는다(재시작 뒤에도 꺼진 채여야 한다)
      const saved = sources.hookDisabledSaved();
      if (!saved.includes(hook)) {
        const written = await writeHookDisabled([...saved, hook].toSorted(byText));
        if (!written.ok) {
          return err({ kind: "write_failed", key: HOOK_DISABLED_KEY, failure: written.error });
        }
      }
      sources.hookDisableConfirm(hook);
      return ok({ appliesAt: "nextStepBoundary", diagnostics: [] });
    },

    async hookReenable(params) {
      if (sources.safeMode().active) return err({ kind: "safe_mode_active" });
      const hook = params.hook;
      if (!hookKnown(hook)) return err({ kind: "unknown_hook", hook });
      const saved = sources.hookDisabledSaved();
      if (saved.includes(hook)) {
        const written = await writeHookDisabled(saved.filter((id) => id !== hook));
        if (!written.ok) {
          return err({ kind: "write_failed", key: HOOK_DISABLED_KEY, failure: written.error });
        }
      }
      sources.hookReenable(hook);
      return ok({ appliesAt: "nextStepBoundary", diagnostics: [] });
    },

    async reload(params, signal) {
      if (sources.safeMode().active) return err({ kind: "safe_mode_active" });
      if (findRecord(params.name) === undefined) return unknownExtension(params.name);
      return ok(await sources.reload(params.name, signal));
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
          windowCalls: stats.windowCalls,
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
      return ok({ capabilities: bindingsOf() });
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
      const metrics = await sources.groupMetrics(params.id, {
        since: params.since,
        threadId: params.threadId,
      });
      if (metrics === undefined) return err({ kind: "unknown_group", id: params.id });
      return ok({
        id: params.id,
        metrics,
        since: params.since ?? null,
        sinceIgnoredBy: sinceIgnoredBy(params.since),
      });
    },

    async groupPromotion(params) {
      return ok(await sources.promotion(params.threadIds));
    },

    async groupDriveLock(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      return ok(await sources.driveLock(params.threadId));
    },

    async hooks(params, signal) {
      const thread = await checkThread(params.threadId, signal);
      if (!thread.ok) return thread;
      if (params.threadId !== undefined) await sources.prepareThread?.(params.threadId);
      const infos = statusMap();
      const errors = sources.registrationErrors();
      const rowOf = (registrationId: string, extension: string, tier: number | null) => ({
        registrationId,
        extension,
        tier,
        status: infos.get(registrationId) ?? "disabled",
        error: errors.get(registrationId) ?? null,
      });
      const live = new Map<HookName, HookHandlerRow[]>();
      for (const handler of sources.hookHandlers()) {
        const rows = live.get(handler.point) ?? [];
        rows.push(rowOf(handler.registrationId, handler.extension, handler.tier));
        live.set(handler.point, rows);
      }
      // 외부 훅은 훅마다 단위(Registration)라서 위 `live`에 이미 있다(X.operations §4.7.4). 꺼진 훅은 꺼짐으로 보인다
      const external = sources.externalHooks(params.threadId);
      const disabledIds = new Set(sources.hookDisabledSaved());
      for (const rows of live.values()) {
        for (const [index, row] of rows.entries()) {
          const id = hookIdOfUnit(row.registrationId);
          if (id === undefined) continue;
          if (disabledIds.has(id) || sources.hookAutoDisabled(id)) {
            rows[index] = { ...row, status: "disabled" };
          }
        }
      }
      // 레지스트리에서 빠진 Registration(꺼졌거나 setup에 실패함)은 선언한 Hook을 뒤에 붙인다. Registration이 없는 확장은 없다
      const idle = new Map<HookName, HookHandlerRow[]>();
      for (const record of sources.extensions()) {
        for (const entry of pluginsOf(record.manifest)) {
          if (!infos.has(entry.registrationId)) continue;
          for (const hook of entry.decl.hooks) {
            if (!isHookName(hook)) continue;
            const registered = live
              .get(hook)
              ?.some((row) => row.registrationId === entry.registrationId);
            if (registered === true) continue;
            const rows = idle.get(hook) ?? [];
            rows.push(rowOf(entry.registrationId, record.manifest.name, null));
            idle.set(hook, rows);
          }
        }
      }
      const rows: HookEntry[] = [];
      for (const hook of new Set([...live.keys(), ...idle.keys()])) {
        const order = [
          ...(live.get(hook) ?? []),
          ...(idle.get(hook) ?? []).toSorted((a, b) =>
            a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0,
          ),
        ];
        rows.push(hookRow(hook, order));
      }
      // 외부 훅 줄: `hook`이 훅 id다. 질문과 꺼짐 표시는 여기에 붙는다(실패 장부 키 `hook:<id>`와 같은 값)
      const listed = new Set<string>();
      for (const hook of external) {
        listed.add(hook.id);
        const off =
          sources.hookDisabledSaved().includes(hook.id) || sources.hookAutoDisabled(hook.id);
        rows.push({
          hook: hook.id,
          fold: HOOKS[hook.point].fold,
          handlers: off ? 0 : 1,
          registrations: off ? [] : [hook.unit],
          external: true,
          point: hook.point,
          source: hook.source,
          ...hookStateOf(hook.id),
        });
      }
      // 정의가 지금 보이지 않는 훅(다른 작업 폴더의 훅 등)도 질문이나 꺼짐이 있으면 줄을 남긴다
      for (const id of new Set([
        ...sources.hookDisabledSaved(),
        ...sources.hookAutoDisabledIds(),
      ])) {
        if (listed.has(id)) continue;
        rows.push({
          hook: id,
          fold: "external",
          handlers: 0,
          registrations: [],
          external: true,
          ...hookStateOf(id),
        });
      }
      return ok({ hooks: rows.toSorted((a, b) => (a.hook < b.hook ? -1 : 1)) });
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

    errors: deps.env.errors,

    orderGet() {
      const order = sources.hookOrder();
      const saved = order.saved();
      const applied = order.applied();
      const hooks = new Set<HookName>([...saved.keys(), ...applied.keys()]);
      const rows: HookOrderEntry[] = [...hooks].toSorted(byText).map((hook) => {
        const savedIds = saved.get(hook) ?? [];
        const appliedIds = applied.get(hook) ?? [];
        return {
          hook,
          saved: [...savedIds],
          applied: [...appliedIds],
          pending: !sameOrder(savedIds, appliedIds),
        };
      });
      return Promise.resolve(ok({ hooks: rows }));
    },

    async orderSet(params) {
      const hook = params.hook;
      if (!isHookName(hook)) return err({ kind: "unknown_hook", hook });
      const order = checkOrder(params.order);
      const next = new Map<HookName, readonly string[]>(sources.hookOrder().saved());
      if (order.length === 0) next.delete(hook);
      else next.set(hook, order);
      const written = await writeOrder(next);
      if (!written.ok) {
        return err({ kind: "write_failed", key: HOOK_ORDER_KEY, failure: written.error });
      }
      return ok({ hook, saved: [...order], appliesAt: "nextStepBoundary" });
    },

    async orderReset(params) {
      const hook = params.hook;
      if (hook !== undefined && !isHookName(hook)) return err({ kind: "unknown_hook", hook });
      const saved = sources.hookOrder().saved();
      // 훅을 주면 그 훅만, 생략하면 저장된 훅 전부다. 저장된 값이 없는 훅은 지울 것이 없다
      const cleared: HookName[] =
        hook === undefined ? [...saved.keys()] : saved.has(hook) ? [hook] : [];
      if (cleared.length === 0) return ok({ hooks: [], appliesAt: "nextStepBoundary" });
      const next = new Map<HookName, readonly string[]>(saved);
      for (const name of cleared) next.delete(name);
      const written = await writeOrder(next);
      if (!written.ok) {
        return err({ kind: "write_failed", key: HOOK_ORDER_KEY, failure: written.error });
      }
      return ok({ hooks: cleared.toSorted(byText), appliesAt: "nextStepBoundary" });
    },

    orderPreview(params) {
      const hook = params.hook;
      if (!isHookName(hook)) return Promise.resolve(err({ kind: "unknown_hook", hook }));
      const rows = defaultRowsOf(hook).map(previewRowOf);
      const preview = previewOrder(hook, params.order, rows);
      return Promise.resolve(ok(previewResultOf(preview)));
    },
  };
  return port;
}

/** 이벤트에서 접는 지표(임대, drive 턴과 자식의 토큰·비용). `since`를 지킨다 */
const EVENT_METRICS: readonly string[] = [
  "leases",
  "leaseMs",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
];
/** 프로세스 메모리 카운터에서 오는 개수 지표. 프로세스가 뜬 뒤의 누계라 `since`를 지키지 못한다 */
const COUNTER_METRICS: readonly string[] = [
  "denies",
  "chainPatches",
  "handlerErrors",
  "posts",
  "spawns",
  "delegates",
  "commits",
  "records",
];

/** `since`가 없으면 없다. 시각으로 읽히지 않으면 아무 지표도 걸러지지 않으므로 전부다 */
function sinceIgnoredBy(since: string | undefined): readonly string[] {
  if (since === undefined) return [];
  return Number.isNaN(Date.parse(since)) ? [...EVENT_METRICS, ...COUNTER_METRICS] : COUNTER_METRICS;
}

function hookRow(hook: HookName, order: readonly HookHandlerRow[]): HookEntry {
  const decl = HOOKS[hook];
  const registered = order.filter((row) => row.tier !== null);
  return {
    hook,
    fold: decl.fold,
    handlers: registered.length,
    registrations: registered.map((row) => row.registrationId),
    external: decl.pi === undefined,
    order,
  };
}
