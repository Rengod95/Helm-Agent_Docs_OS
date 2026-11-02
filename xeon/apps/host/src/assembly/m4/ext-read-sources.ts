import { join } from "node:path";
import { assertNever, parse, type Result } from "@fresnel/contracts";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import {
  HOOKS,
  type ExtensionManifest,
  type RegistrationStatus,
} from "@fresnel/contracts/extensions";
import {
  LeaseRejectedPayloadSchema,
  type DurableEventEnvelope,
  type ReadFailure,
} from "@fresnel/contracts/records";
import type { GroupStatus } from "@fresnel/contracts/services";
import { resolveSetting, type ScopeStack, type SettingCatalog } from "@fresnel/contracts/settings";
import type {
  EnabledSource,
  ExtDiagnostic,
  GroupMetricsFull,
  GroupPromotionResult,
  SafeModeCause,
} from "@fresnel/contracts/wire";
import {
  budgetClassOf,
  extReadViewOf,
  type ExtensionLoader,
  type ExtensionUnit,
  type ExtHost,
  type OperationsPolicy,
} from "@fresnel/ext-host";
import {
  buildPromotionReport,
  defaultMetricsRegistry,
  gatherPromotionInput,
  summarizeUsage,
  type GroupServiceWithUsage,
  type ScopeUsage,
} from "@fresnel/group-sdk";
import type { HostErrorMappers } from "../../handlers/m4/profile-test-run.ts";
import type { SettingsEngine } from "../settings-engine.ts";
import { operationsSource, primitivesSource } from "../settings-sources.ts";
import type { ExtensionRecord, ExtReadSources } from "./ext-read-port.ts";

// 확장 읽기 원천의 실제 구현(`ExtReadSources`). 호스트 조립이 쥔 값(확장 단위 목록, 로더, 운영 정책, 그룹 서비스, 설정 엔진)과 ext-host의
// 읽기 조회(`extReadViewOf`)를 얇게 감싸 넘긴다. 이 파일은 값을 새로 만들지 않고 원천이 가진 값을 읽는다. 조립 루트 코드(DR-14 예외 2).

/** 안전 모드 상태. 원인은 `host.status`가 안전 모드를 켠 쪽과 같다(`flag`는 시작 옵션, `user`는 설정 `x.operations.safeMode.default`) */
interface ExtReadSafeMode {
  readonly active: boolean;
  readonly cause: SafeModeCause | null;
}

/** 조립 루트(`assemble.ts`)가 넘기는 것: 엔진 포트가 올라오기 전에 있는 값 */
export interface ExtReadAssembly {
  readonly operations: Pick<OperationsPolicy, "ledger" | "autoDisabler">;
  readonly safeMode: ExtReadSafeMode;
  readonly extensions: () => readonly ExtensionRecord[];
  /** 그룹 서비스. `host-groups` 단위가 올라올 때 채워지고 그 전에는 없다 */
  readonly groupService: () => GroupServiceWithUsage | undefined;
}

/** 엔진 포트 조립(`ports.ts`)이 더하는 것 */
export interface ExtReadEnv {
  readonly ext: ExtHost;
  readonly settings: SettingsEngine;
  readonly threadExists: (threadId: ThreadId) => Result<boolean, ReadFailure>;
  readonly errors: Pick<HostErrorMappers, "ofStore">;
  readonly heldThreads: () => readonly ThreadId[];
  readonly activeThread: () => ThreadId | null;
}

function threadIdOf(value: string | undefined): ThreadId | undefined {
  return isId("thr", value) ? value : undefined;
}

function layersOf(settings: SettingsEngine, threadId: string | undefined): ScopeStack {
  return settings.layers(threadIdOf(threadId));
}

function enabledSourceOf(
  catalog: SettingCatalog,
  layers: ScopeStack,
  extension: string,
): EnabledSource {
  const def = catalog.get(`ext.${extension}.enabled`);
  if (def === undefined) return "default";
  const scope = resolveSetting(def, layers).setting.source.scope;
  switch (scope) {
    case "managed":
      return "managed";
    case "launch":
      return "thread";
    case "project":
    case "local":
      return "project";
    case "user":
      return "user";
    case "default":
      return "default";
    default:
      return assertNever(scope, "SettingScope");
  }
}

/** 확장 목록 한 줄의 재료: 호스트가 올린 내장 단위, 로더가 찾아낸 외부 확장, 로더의 진단 */
export interface ExtensionRecordsDeps {
  readonly units: () => readonly ExtensionUnit[];
  /** 외부 확장 로더가 찾아낸 매니페스트(싣지 못한 것 포함). 사용자 위치 `<config>/extensions/<이름>` 밑이다 */
  readonly external: () => readonly {
    readonly name: string;
    readonly manifest: ExtensionManifest;
  }[];
  readonly loader: () => ExtensionLoader | undefined;
  readonly tierOf: (name: string) => string | undefined;
  readonly userExtensionsDir: string;
}

/**
 * 확장 목록을 읽는다. 내장 단위는 위치가 `builtin`이고 항상 실려 있다(안전 모드도 내장은 싣는다). 외부 확장은 로더 상태가 `active`일 때만
 * 실려 있다. 로더가 모르는 외부 확장은 `untrusted`로 본다. 프로젝트 위치에서 싣는 확장은 매니페스트를 읽을 길이 없어 목록에 없다 [미결].
 */
export function createExtensionRecords(
  deps: ExtensionRecordsDeps,
): () => readonly ExtensionRecord[] {
  return () => {
    const builtins: ExtensionRecord[] = deps.units().map((unit) => ({
      manifest: unit.manifest,
      location: "builtin",
      requestedGrade: unit.manifest.trust?.level ?? "builtin",
      effectiveGrade: "builtin",
      // 내장 단위는 로더의 승인 표(`admit`)를 거치지 않는다. 정책은 표에 없는 확장을 내장 tier로 본다
      tier: deps.tierOf(unit.manifest.name) ?? "builtin",
      loaded: true,
      diagnostics: [],
    }));
    const loader = deps.loader();
    const infos = loader?.list() ?? [];
    const problems = loader?.diagnostics() ?? [];
    const external: ExtensionRecord[] = deps.external().map(({ name, manifest }) => {
      const info = infos.find((candidate) => candidate.name === name);
      const diagnostics: ExtDiagnostic[] = problems.flatMap((problem) =>
        problem.extension !== name || problem.severity === "info"
          ? []
          : [
              {
                severity: problem.severity,
                code: problem.code,
                message: problem.message,
                ...(problem.path === undefined ? {} : { file: problem.path }),
              },
            ],
      );
      return {
        manifest,
        location: join(deps.userExtensionsDir, name),
        requestedGrade: manifest.trust?.level ?? "user",
        effectiveGrade: info?.trust ?? "untrusted",
        tier: deps.tierOf(name) ?? null,
        loaded: info?.state === "active",
        diagnostics,
      };
    });
    return [...builtins, ...external];
  };
}

function withinSince(since: number | undefined): (event: DurableEventEnvelope) => boolean {
  return (event) => since === undefined || event.recordedAt >= since;
}

const NO_USAGE: ScopeUsage = {
  leases: 0,
  leaseMs: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
};

export function createExtReadSources(assembly: ExtReadAssembly, env: ExtReadEnv): ExtReadSources {
  const catalog = env.settings.catalog;
  const view = extReadViewOf(env.ext);
  const ledger = assembly.operations.ledger;

  const instrumented = (): boolean => env.settings.value("l3.group-sdk.instrumentation") !== false;

  function extensionOf(registrationId: string): string | undefined {
    return env.ext.registrations().find((info) => info.id === registrationId)?.extension;
  }

  /** 이 thread의 `lease.*`·`turn.*` 이벤트를 접은 scope별 사용량. 읽지 못한 thread는 건너뛴다(그룹 서비스 `refreshUsage`와 같다) */
  async function usageOf(
    id: string,
    threadIds: readonly ThreadId[],
    since: number | undefined,
  ): Promise<ScopeUsage> {
    const total = {
      leases: 0,
      leaseMs: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
    };
    const reads = await Promise.all(
      threadIds.map(async (threadId) => ({
        leases: await env.ext.queryEvents(threadId, { kindPrefix: "lease." }),
        turns: await env.ext.queryEvents(threadId, { kindPrefix: "turn." }),
      })),
    );
    for (const { leases, turns } of reads) {
      if (!leases.ok || !turns.ok) continue;
      const ordered = [...leases.value, ...turns.value]
        .filter(withinSince(since))
        .toSorted((a, b) => a.seq - b.seq);
      const usage = summarizeUsage(ordered).get(id) ?? NO_USAGE;
      total.leases += usage.leases;
      total.leaseMs += usage.leaseMs;
      total.input += usage.tokens.input;
      total.output += usage.tokens.output;
      total.cacheRead += usage.tokens.cacheRead;
      total.cacheWrite += usage.tokens.cacheWrite;
      total.costUsd += usage.costUsd;
    }
    return {
      leases: total.leases,
      leaseMs: total.leaseMs,
      tokens: {
        input: total.input,
        output: total.output,
        cacheRead: total.cacheRead,
        cacheWrite: total.cacheWrite,
      },
      costUsd: total.costUsd,
    };
  }

  return {
    safeMode: () => assembly.safeMode,
    budget(hook) {
      const budgetClass = budgetClassOf(HOOKS[hook]);
      return { budgetClass, budgetMs: operationsSource(env.settings).budgets()[budgetClass] };
    },
    threadKnown(threadId) {
      const id = threadIdOf(threadId);
      if (id === undefined) return Promise.resolve(false);
      const found = env.threadExists(id);
      if (!found.ok)
        return Promise.reject(env.errors.ofStore(found.error, "ext read thread check"));
      return Promise.resolve(found.value);
    },
    extensions: assembly.extensions,
    registrations: () =>
      env.ext.registrations().map((info) => ({ id: info.id, status: info.status })),
    threadStatus(threadId, registrationId): RegistrationStatus | undefined {
      const id = threadIdOf(threadId);
      return id === undefined ? undefined : view.threadStatus(id, registrationId);
    },
    enabledSource(registrationId, threadId) {
      const extension = extensionOf(registrationId);
      if (extension === undefined) return "default";
      return enabledSourceOf(catalog, layersOf(env.settings, threadId), extension);
    },
    managedLocked(name) {
      const def = catalog.get(`ext.${name}.enabled`);
      if (def === undefined) return false;
      return resolveSetting(def, env.settings.layers(undefined)).setting.locked;
    },
    health(name) {
      const stats = ledger.stats(`ext:${name}`);
      return {
        consecutiveFailures: stats.consecutive,
        windowFailures: stats.windowFailures,
        // 실패 장부의 창은 시간이 아니라 호출 수(`x.operations.autoDisable.windowSize`)다. 시간 창이 없어 0이다
        windowMs: 0,
        lastFailureAt:
          stats.lastFailure === undefined ? null : new Date(stats.lastFailure.at).toISOString(),
        lastError: stats.lastFailure?.message ?? null,
      };
    },
    autoDisabled: (name) => assembly.operations.autoDisabler.disabled().includes(`ext:${name}`),
    reenable: (name) => {
      assembly.operations.autoDisabler.reenable(`ext:${name}`);
    },
    // 로더에 핫 리로드가 없다(X.loading-trust.spec §4.4.4는 M2 이후 개발용): 다시 읽지 않았음을 진단으로 알린다
    reload: (name) =>
      Promise.resolve([
        {
          severity: "error",
          code: "reload_unavailable",
          message: `the extension loader has no hot reload; restart the host to reload ${name}`,
        },
      ]),
    groups: () => assembly.groupService()?.list() ?? [],
    async groupMetrics(id, query) {
      const service = assembly.groupService();
      const known = service?.list().some((group: GroupStatus) => group.id === id) ?? false;
      if (!known) return undefined;
      if (!instrumented()) return null;
      const counted = defaultMetricsRegistry.get(id)?.snapshot();
      const requested = threadIdOf(query.threadId);
      const current = env.activeThread();
      const threadIds = requested !== undefined ? [requested] : current === null ? [] : [current];
      const parsedSince = query.since === undefined ? undefined : Date.parse(query.since);
      const since =
        parsedSince === undefined || Number.isNaN(parsedSince) ? undefined : parsedSince;
      const usage = await usageOf(id, threadIds, since);
      const metrics: GroupMetricsFull = {
        inputTokens: counted?.tokens.input ?? 0,
        outputTokens: counted?.tokens.output ?? 0,
        cacheReadTokens: counted?.tokens.cacheRead ?? 0,
        cacheWriteTokens: counted?.tokens.cacheWrite ?? 0,
        // `GroupStatus.metrics`와 같은 합: 카운터의 비용에 이벤트(`turn.completed`)의 비용을 더한다
        costUsd: (counted?.costUsd ?? 0) + usage.costUsd,
        leaseMs: usage.leaseMs,
        leases: usage.leases,
        denies: counted?.denies ?? 0,
        chainPatches: counted?.chainPatches ?? 0,
        handlerErrors: counted?.handlerErrors ?? 0,
        posts: counted?.posts ?? 0,
        spawns: counted?.spawns ?? 0,
        delegates: counted?.delegates ?? 0,
        commits: counted?.commits ?? 0,
        records: counted?.records ?? 0,
      };
      return metrics;
    },
    async promotion(threadIds): Promise<GroupPromotionResult> {
      const requested = threadIds?.flatMap((value) => {
        const id = threadIdOf(value);
        return id === undefined ? [] : [id];
      });
      const current = env.activeThread();
      const targets = requested ?? (current === null ? [] : [current]);
      const report = buildPromotionReport(await gatherPromotionInput(env.ext, targets));
      return {
        throughSeq: report.throughSeq,
        threads: report.threads,
        candidates: report.candidates
          .filter((candidate) => candidate.candidate)
          .map((candidate) => ({
            tool: candidate.tool,
            owner: candidate.owner,
            consumers: candidate.consumers.map((consumer) => consumer.scopeId),
            userCalls: candidate.userCalls,
          })),
      };
    },
    async driveLock(threadId) {
      const id = threadIdOf(threadId);
      const lock = id === undefined ? undefined : view.driveLock(id);
      const defaults =
        id === undefined ? {} : primitivesSource(env.settings).driveDefaultLimits(id);
      const activeDriver = env.settings.value("x.primitives.activeDriver", id);
      const rejections =
        id === undefined
          ? undefined
          : await env.ext.queryEvents(id, { kindPrefix: "lease.rejected" });
      const last = rejections?.ok === true ? rejections.value.at(-1) : undefined;
      const checked =
        last === undefined ? undefined : parse(LeaseRejectedPayloadSchema, last.payload);
      return {
        holder: lock?.holder ?? null,
        leaseEpoch: lock?.leaseEpoch ?? 0,
        activeDriver: typeof activeDriver === "string" ? activeDriver : null,
        limits: {
          turns: lock?.limits.turns ?? defaults.maxTurns ?? 0,
          spawns: lock?.limits.spawns ?? defaults.maxSpawns ?? 0,
          tokens: lock?.limits.tokens ?? defaults.maxTokens ?? null,
        },
        used: lock?.used ?? { turns: 0, spawns: 0, tokens: 0 },
        candidates: lock?.candidates ?? [],
        lastRejected:
          last === undefined || checked === undefined || !checked.ok
            ? null
            : {
                groupId: checked.value.groupId,
                reason: checked.value.reason,
                requestSeq: checked.value.requestSeq,
              },
      };
    },
    settings: {
      catalog,
      layers: (threadId) => layersOf(env.settings, threadId),
    },
  };
}
