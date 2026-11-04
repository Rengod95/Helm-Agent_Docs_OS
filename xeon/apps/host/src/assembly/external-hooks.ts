import {
  createHookRunner,
  HOOK_SOURCE_TIER,
  HOOK_SOURCES,
  HOOK_UNIT_LOAD_INDEX_BASE,
  hookUnitName,
  mergeHookDefs,
  type ExtHost,
  type HandlerOutcomeRecord,
  type HookRunner,
  type HookSource,
  type HookUnitSpec,
  type MergedHooks,
  type PortLookup,
  type Tier,
} from "@fresnel/ext-host";
import { sequentially } from "../util.ts";
import { ProcessPortKey } from "@fresnel/contracts/extensions";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { ScopeStack } from "@fresnel/contracts/settings";

// 외부 훅 연결(X.operations.spec §4.7). 설정 층에서 훅 정의를 읽고, `fresnel.process`로 실행한다

export const HOOK_DEFS_KEY = "x.operations.hookDefs";

/** 범위별 `hookDefs` 값. 작업 폴더·로컬 층은 폴더 신뢰가 판정된 뒤에만 층 스택에 있다(settings-store) */
export function hookDefsOf(layers: ScopeStack): MergedHooks {
  const values: { [S in HookSource]?: unknown } = {};
  for (const layer of layers) {
    if (
      layer.scope === "managed" ||
      layer.scope === "user" ||
      layer.scope === "project" ||
      layer.scope === "local"
    ) {
      const value = layer.values.get(HOOK_DEFS_KEY);
      if (value !== undefined) values[layer.scope] = value;
    }
  }
  return mergeHookDefs(values, { managed: true, user: true, project: true, local: true });
}

/** 문자열 배열 설정 값. 배열이 아니면 빈 목록, 문자열이 아닌 원소는 버린다 */
export function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export interface ExternalHooksDeps {
  readonly layers: (threadId: ThreadId | undefined) => ScopeStack;
  readonly ports: PortLookup;
  readonly workspaceOf: (threadId: ThreadId) => string | undefined;
  readonly homeDir: () => string;
  readonly parentEnv: () => Readonly<Record<string, string | undefined>>;
  readonly savedDisabled: () => readonly string[];
  readonly envAllow: () => readonly string[];
  readonly budgetMs: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  readonly report: (record: HandlerOutcomeRecord) => void;
  readonly log: (line: string) => void;
}

/** 단위를 싣고 뺄 때 tier 표에 알린다(조립이 `operations.tiers`를 넘긴다) */
interface HookTierSink {
  set(name: string, tier: Tier): void;
  delete(name: string): void;
}

export interface ExternalHooks {
  readonly runner: HookRunner;
  /**
   * 안전 모드가 아니면 지금 보이는 훅(관리·사용자 범위)마다 단위를 싣는다. 안전 모드에서는 아무것도 싣지 않는다.
   * 이후 `sync`가 설정과 폴더 신뢰의 변화를 따라 단위를 넣고 뺀다
   */
  install(ext: ExtHost, safeMode: boolean, tiers: HookTierSink): Promise<readonly string[]>;
  /**
   * 훅 정의가 바뀌었을 수 있을 때 부른다(설정 변경, 작업 폴더 신뢰 결정, thread의 작업 폴더 설정을 읽은 뒤).
   * `threadId`가 있으면 그 thread에 적용되는 작업 폴더·로컬 훅도 싣는다. 없으면 이미 본 thread들을 다시 읽는다.
   * 설치 전이나 안전 모드에서는 아무 일도 하지 않는다. 호출은 차례로 처리한다
   */
  sync(threadId?: ThreadId): Promise<void>;
  /** thread에 적용되는 훅(화면 목록용) */
  hooksFor(threadId: ThreadId | undefined): MergedHooks;
}

/** 단위가 필요한 훅 하나. 같은 id는 먼저 본 시점의 것을 쓴다 */
interface WantedUnit {
  readonly spec: HookUnitSpec;
  readonly tier: Tier;
  /** 단위를 다시 실을지 가리는 값(지점, tier, 순번) */
  readonly signature: string;
}

const GLOBAL_VIEW = "global";

/** 한 시점의 훅 목록에서 단위 목록을 만든다. 순번은 범위 안의 자리라서 다른 범위의 훅이 늘어도 밀리지 않는다 */
function wantedOf(hooks: MergedHooks): WantedUnit[] {
  const perSource = new Map<HookSource, number>();
  return hooks.hooks.map((hook) => {
    const position = perSource.get(hook.source) ?? 0;
    perSource.set(hook.source, position + 1);
    const rank = HOOK_SOURCES.indexOf(hook.source);
    const loadIndex = HOOK_UNIT_LOAD_INDEX_BASE + rank * 10_000 + position;
    const tier = HOOK_SOURCE_TIER[hook.source];
    return {
      spec: { id: hook.def.id, point: hook.def.point, loadIndex },
      tier,
      signature: `${hook.def.point}|${tier}|${loadIndex}`,
    };
  });
}

export function createExternalHooks(deps: ExternalHooksDeps): ExternalHooks {
  const hooksFor = (threadId: ThreadId | undefined): MergedHooks =>
    hookDefsOf(deps.layers(threadId));
  const runner = createHookRunner({
    process: () => deps.ports.get(ProcessPortKey),
    hooks: (threadId) => hooksFor(isId("thr", threadId) ? threadId : undefined).hooks,
    savedDisabled: deps.savedDisabled,
    projectDir: (threadId) => (isId("thr", threadId) ? deps.workspaceOf(threadId) : undefined),
    home: deps.homeDir,
    parentEnv: deps.parentEnv,
    envAllow: deps.envAllow,
    budgetMs: deps.budgetMs,
    setTimer: deps.setTimer,
    now: deps.now,
    report: deps.report,
    log: deps.log,
  });

  const state: {
    ext: ExtHost | undefined;
    tiers: HookTierSink | undefined;
    /** 싣은 단위: 훅 id → 신호 */
    installed: Map<string, string>;
    /** 본 시점들(전역과 thread별). thread별에는 그 thread의 작업 폴더·로컬 훅이 든다 */
    views: Map<string, readonly WantedUnit[]>;
    queue: Promise<void>;
  } = {
    ext: undefined,
    tiers: undefined,
    installed: new Map(),
    views: new Map(),
    queue: Promise.resolve(),
  };

  /** 본 시점을 합쳐 필요한 단위를 정하고 싣거나 뺀다 */
  async function reconcile(): Promise<readonly string[]> {
    const { ext, tiers } = state;
    if (ext === undefined || tiers === undefined) return [];
    const wanted = new Map<string, WantedUnit>();
    for (const view of state.views.values()) {
      for (const unit of view) if (!wanted.has(unit.spec.id)) wanted.set(unit.spec.id, unit);
    }
    const stale = [...state.installed].filter(([id, signature]) => {
      const unit = wanted.get(id);
      return unit === undefined || unit.signature !== signature;
    });
    await sequentially(stale, async ([id]) => {
      await ext.uninstall(hookUnitName(id));
      tiers.delete(hookUnitName(id));
      state.installed.delete(id);
    });
    const loaded: string[] = [];
    await sequentially([...wanted], async ([id, unit]) => {
      if (state.installed.has(id)) return;
      const name = hookUnitName(id);
      tiers.set(name, unit.tier);
      const result = await ext.install(runner.unitOf(unit.spec));
      const failed = result.setups.some((setup) => setup.status === "failed");
      if (result.entryError !== undefined || failed) {
        tiers.delete(name);
        deps.log(`external hooks: ${name} did not start`);
        return;
      }
      state.installed.set(id, unit.signature);
      loaded.push(name);
    });
    return loaded;
  }

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = state.queue.then(work);
    state.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    runner,
    hooksFor,
    install(ext, safeMode, tiers) {
      if (safeMode) return Promise.resolve([]);
      return enqueue(async () => {
        state.ext = ext;
        state.tiers = tiers;
        state.views.set(GLOBAL_VIEW, wantedOf(hooksFor(undefined)));
        return reconcile();
      });
    },
    sync(threadId) {
      return enqueue(async () => {
        if (state.ext === undefined) return;
        state.views.set(GLOBAL_VIEW, wantedOf(hooksFor(undefined)));
        if (threadId !== undefined) state.views.set(threadId, wantedOf(hooksFor(threadId)));
        for (const key of state.views.keys()) {
          if (key === GLOBAL_VIEW) continue;
          if (isId("thr", key)) state.views.set(key, wantedOf(hooksFor(key)));
        }
        await reconcile();
      });
    },
  };
}
