import { join } from "node:path";
import { assertNever, parse, type Result } from "@fresnel/contracts";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import { HOOKS, type RegistrationStatus } from "@fresnel/contracts/extensions";
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
  isHookUnitName,
  type ExtensionLoader,
  type LoadDiagnostic,
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
import type { ExtensionRecord, ExternalHookView, ExtReadSources } from "./ext-read-port.ts";

// 확장 읽기 원천의 실제 구현(`ExtReadSources`). 호스트 조립이 쥔 값(확장 단위 목록, 로더, 운영 정책, 그룹 서비스, 설정 엔진)과 ext-host의
// 읽기 조회(`extReadViewOf`)를 얇게 감싸 넘긴다. 이 파일은 값을 새로 만들지 않고 원천이 가진 값을 읽는다. 조립 루트 코드(DR-14 예외 2).

/** 안전 모드 상태. 원인은 `host.status`가 안전 모드를 켠 쪽과 같다(`flag`는 시작 옵션, `user`는 설정 `x.operations.safeMode.default`) */
interface ExtReadSafeMode {
  readonly active: boolean;
  readonly cause: SafeModeCause | null;
}

/** 조립 루트(`assemble.ts`)가 넘기는 것: 엔진 포트가 올라오기 전에 있는 값 */
export interface ExtReadAssembly {
  readonly operations: Pick<OperationsPolicy, "ledger" | "autoDisabler" | "hookOrder">;
  /** 외부 훅 정의 읽기(thread 없이 읽히는 범위만) */
  readonly externalHooks: () => readonly ExternalHookView[];
  readonly safeMode: ExtReadSafeMode;
  readonly extensions: () => readonly ExtensionRecord[];
  /** 외부 확장 로더. 기본 그룹이 꺼져 있으면 없다. `ext.reload`가 새 버전으로 바꾸는 데 쓴다 */
  readonly loader: () => ExtensionLoader | undefined;
  /** 호스트 시계(ms). 실패 장부 창이 덮는 시간을 지금까지로 잰다 */
  readonly now: () => number;
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
  readonly loader: () => ExtensionLoader | undefined;
  readonly tierOf: (name: string) => string | undefined;
  readonly userExtensionsDir: string;
}

/**
 * 확장 목록을 읽는다. 내장 단위는 위치가 `builtin`이고 항상 실려 있다(안전 모드도 내장은 싣는다). 외부 확장은 로더 목록(`loader.list()`)이
 * 원천이다: 사용자, 관리, 프로젝트 위치를 가리지 않고 로더가 매니페스트를 읽은 확장이 나오고, 위치 종류는 `origin`이다. 로더 상태가 `active`일 때만
 * 실려 있다. 목록은 부를 때마다 읽으므로 서비스 모드에서 작업 폴더를 열 때 실린 프로젝트 확장도 바로 보인다.
 * 로더가 매니페스트를 읽지 못한 후보(파일 없음, 파싱 실패)는 행이 없고 로더 진단에만 있다.
 */
export function createExtensionRecords(
  deps: ExtensionRecordsDeps,
): () => readonly ExtensionRecord[] {
  return () => {
    const builtins: ExtensionRecord[] = deps.units().map((unit) => ({
      manifest: unit.manifest,
      location: "builtin",
      origin: "builtin",
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
    const external: ExtensionRecord[] = infos.flatMap((info) => {
      const { name, manifest } = info;
      if (manifest === undefined || info.source === "builtin") return [];
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
      return [
        {
          manifest,
          location: info.root ?? join(deps.userExtensionsDir, name),
          origin: info.source,
          requestedGrade: manifest.trust?.level ?? (info.source === "project" ? "project" : "user"),
          effectiveGrade: info.trust,
          tier: deps.tierOf(name) ?? null,
          loaded: info.state === "active",
          diagnostics,
        },
      ];
    });
    return [...builtins, ...external];
  };
}

/** 귀속을 이어 주는 사건(`turn.started`, `agent.spawned`)은 `since` 앞이어도 남긴다. 그래야 `since` 뒤에 끝난 턴과 자식이 scope에 묶인다 */
const LINK_KINDS: ReadonlySet<string> = new Set(["turn.started", "agent.spawned"]);

function withinSince(since: number | undefined): (event: DurableEventEnvelope) => boolean {
  return (event) => since === undefined || event.recordedAt >= since || LINK_KINDS.has(event.kind);
}

const NO_USAGE: ScopeUsage = {
  leases: 0,
  leaseMs: 0,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  costUsd: 0,
};

/** `LoadDiagnostic` → wire 진단 */
function wireDiagnosticOf(entry: LoadDiagnostic): ExtDiagnostic {
  return {
    severity: entry.severity === "warning" || entry.severity === "info" ? "warning" : "error",
    code: entry.code,
    message: entry.message,
    ...(entry.path === undefined ? {} : { file: entry.path }),
  };
}

/**
 * `ext.reload`: 로더가 새 버전을 검사하고 `ExtHost.replaceUnit`이 단계 경계에서 바꾼다(X.loading-trust §4.4.4). 검사에 실패하면 옛 버전이
 * 그대로 돌고 진단으로 알린다. 실행 중인 thread가 없으면(`now`) 적용 결과까지 기다려 진단에 싣고, 실행 중이면 경계를 기다리지 않는다:
 * 그때의 적용 실패는 로더 진단(`reload_failed`)에 남는다
 */
async function reloadThroughLoader(
  loader: ExtensionLoader | undefined,
  name: string,
  signal: AbortSignal,
): Promise<{
  readonly appliesAt: "now" | "nextStepBoundary";
  readonly diagnostics: readonly ExtDiagnostic[];
}> {
  if (loader === undefined) {
    return {
      appliesAt: "nextStepBoundary",
      diagnostics: [
        {
          severity: "error",
          code: "reload_unavailable",
          message: `the extension loader is not running; restart the host to reload ${name}`,
        },
      ],
    };
  }
  const started = await loader.reload(name, signal);
  if (!started.ok) {
    const failure = started.error;
    const diagnostics: readonly ExtDiagnostic[] =
      failure.kind === "rejected"
        ? failure.diagnostics.map(wireDiagnosticOf)
        : [
            {
              severity: "error",
              code: failure.kind === "unknown_extension" ? "extension_unknown" : "not_reloadable",
              message:
                failure.kind === "unknown_extension"
                  ? `${name} is not loaded`
                  : `${name} cannot be reloaded (${failure.reason}); restart the host`,
            },
          ];
    return { appliesAt: "nextStepBoundary", diagnostics };
  }
  if (started.value.appliesAt === "nextStepBoundary") {
    return { appliesAt: "nextStepBoundary", diagnostics: [] };
  }
  const applied = await started.value.applied;
  return {
    appliesAt: "now",
    diagnostics: applied.status === "failed" ? applied.diagnostics.map(wireDiagnosticOf) : [],
  };
}

export function createExtReadSources(assembly: ExtReadAssembly, env: ExtReadEnv): ExtReadSources {
  const catalog = env.settings.catalog;
  const view = extReadViewOf(env.ext);
  const ledger = assembly.operations.ledger;
  const order = assembly.operations.hookOrder;

  const instrumented = (): boolean => env.settings.value("l3.group-sdk.instrumentation") !== false;

  function extensionOf(registrationId: string): string | undefined {
    return env.ext.registrations().find((info) => info.id === registrationId)?.extension;
  }

  /** 이 thread의 `lease.*`·`turn.*`·`agent.*` 이벤트를 접은 scope별 사용량. 읽지 못한 thread는 건너뛴다(그룹 서비스 `refreshUsage`와 같다) */
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
        agents: await env.ext.queryEvents(threadId, { kindPrefix: "agent." }),
      })),
    );
    for (const { leases, turns, agents } of reads) {
      if (!leases.ok || !turns.ok || !agents.ok) continue;
      const ordered = [...leases.value, ...turns.value, ...agents.value]
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
        windowCalls: stats.windowCalls,
        // 실패 장부의 창은 시간이 아니라 최근 호출 수(`x.operations.autoDisable.windowSize`)다. 창이 덮는 시간은 가장 오래된 호출부터 지금까지다
        windowMs:
          stats.windowStartedAt === undefined
            ? 0
            : Math.max(0, assembly.now() - stats.windowStartedAt),
        lastFailureAt:
          stats.lastFailure === undefined ? null : new Date(stats.lastFailure.at).toISOString(),
        lastError: stats.lastFailure?.message ?? null,
      };
    },
    autoDisabled: (name) => assembly.operations.autoDisabler.disabled().includes(`ext:${name}`),
    keepOffQuestion: (name) => {
      const question = assembly.operations.autoDisabler
        .questions()
        .find((q) => q.key === `ext:${name}`);
      if (question === undefined) return null;
      // 사용자가 설정으로 이미 꺼 두었으면 그것이 "끈다" 답이다
      if (env.settings.value(`ext.${name}.enabled`) === false) return null;
      return {
        rule: question.rule,
        consecutive: question.consecutive,
        windowFailures: question.windowFailures,
      };
    },
    // "켜 두기" 답: 질문과 장부를 비운다
    reenable: (name) => {
      assembly.operations.autoDisabler.reenable(`ext:${name}`);
    },
    // "끄기" 답: auto_disable로 끈다
    disableConfirm: (name) => {
      assembly.operations.autoDisabler.answer(`ext:${name}`, true);
    },
    hookKeepOffQuestion: (hook) => {
      const question = assembly.operations.autoDisabler
        .questions()
        .find((q) => q.key === `hook:${hook}`);
      if (question === undefined) return null;
      return {
        rule: question.rule,
        consecutive: question.consecutive,
        windowFailures: question.windowFailures,
      };
    },
    externalHooks: () => assembly.externalHooks(),
    hookAutoDisabledIds: () =>
      assembly.operations.autoDisabler
        .disabled()
        .filter((key) => key.startsWith("hook:"))
        .map((key) => key.slice("hook:".length)),
    hookAutoDisabled: (hook) =>
      assembly.operations.autoDisabler.disabled().includes(`hook:${hook}`),
    hookDisabledSaved: () => {
      const value = env.settings.value("x.operations.hookDisabled");
      if (!Array.isArray(value)) return [];
      const ids: string[] = [];
      for (const id of value) if (typeof id === "string") ids.push(id);
      return ids;
    },
    // "켜 두기"(질문에 아니오)와 "다시 켜기". 질문이 있으면 켜 둔 채 장부를 비우고, 없으면 꺼진 훅을 다시 켠다
    hookReenable: (hook) => {
      const key = `hook:${hook}` as const;
      const { autoDisabler } = assembly.operations;
      if (!autoDisabler.answer(key, false)) autoDisabler.reenable(key);
    },
    hookDisableConfirm: (hook) => {
      assembly.operations.autoDisabler.answer(`hook:${hook}`, true);
    },
    reload: (name, signal) => reloadThroughLoader(assembly.loader(), name, signal),
    // 외부 훅 단위는 순서 화면의 핸들러가 아니다. 외부 훅은 모든 확장 뒤에 범위 순서로 이어 붙고 옮길 수 없다(X.operations §4.7.4)
    hookHandlers: () =>
      view
        .handlers()
        .filter((handler) => !isHookUnitName(handler.extension))
        .map((handler) => ({
          point: handler.point,
          registrationId: handler.scopeId,
          extension: handler.extension,
          tier: handler.tier,
          loadIndex: handler.loadIndex,
          seq: handler.seq,
        })),
    hookOrder: () => ({
      saved: () => order.saved(),
      applied: () => order.appliedMap(),
      pending: () => order.pending(),
    }),
    boundCapabilities: () => view.boundCapabilities(),
    registrationErrors: () =>
      new Map(
        env.ext
          .registrations()
          .flatMap((info) =>
            info.lastError === undefined ? [] : [[info.id, info.lastError.code] as const],
          ),
      ),
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
        // 토큰과 비용의 원천은 이벤트 접기 하나다(drive 턴 `turn.completed` + 자식 `agent.settled`). 카운터의 `addUsage`는 읽지 않아 두 번 세지 않는다
        inputTokens: usage.tokens.input,
        outputTokens: usage.tokens.output,
        cacheReadTokens: usage.tokens.cacheRead,
        cacheWriteTokens: usage.tokens.cacheWrite,
        costUsd: usage.costUsd,
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
