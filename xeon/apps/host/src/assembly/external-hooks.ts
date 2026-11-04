import {
  createHookRunner,
  HOOK_SOURCES,
  hookUnitName,
  mergeHookDefs,
  startupFilter,
  type ExtHost,
  type ExtensionUnit,
  type HandlerOutcomeRecord,
  type HookRunner,
  type HookSource,
  type MergedHooks,
  type PortLookup,
} from "@fresnel/ext-host";
import { ProcessPortKey } from "@fresnel/contracts/extensions";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import { sequentially } from "../util.ts";
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

export interface ExternalHooks {
  readonly runner: HookRunner;
  /** 안전 모드가 아니면 범위별 단위 넷을 싣는다. 싣지 않은 범위는 돌려주지 않는다 */
  install(ext: ExtHost, safeMode: boolean): Promise<readonly string[]>;
  /** thread에 적용되는 훅(화면 목록용) */
  hooksFor(threadId: ThreadId | undefined): MergedHooks;
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
  return {
    runner,
    hooksFor,
    async install(ext, safeMode) {
      const units = new Map<string, ExtensionUnit>(
        runner.units().map((unit) => [unit.manifest.name, unit]),
      );
      const filtered = startupFilter(
        HOOK_SOURCES.map((source) => ({
          kind: "hook" as const,
          name: hookUnitName(source),
          tier: "user" as const,
        })),
        { safeMode: { active: safeMode }, disabled: [] },
      );
      const loaded: string[] = [];
      await sequentially(filtered.load, async (candidate) => {
        const unit = units.get(candidate.name);
        if (unit === undefined) return;
        const result = await ext.install(unit);
        const failed = result.setups.some((setup) => setup.status === "failed");
        if (result.entryError !== undefined || failed) {
          deps.log(`external hooks: ${candidate.name} did not start`);
          return;
        }
        loaded.push(candidate.name);
      });
      return loaded;
    },
  };
}
