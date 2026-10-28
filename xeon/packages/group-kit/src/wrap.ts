import { Bug, attempt, attemptAsync, parse, rethrow } from "@xeon/contracts";
import type { ServiceKey } from "@xeon/contracts/capabilities";
import type {
  DriveFn,
  DriveOptions,
  ExtensionManifest,
  LoopHandle,
  PortKey,
  ScopeApi,
  SpawnSpec,
  StateDecl,
  ToolResourceDef,
} from "@xeon/contracts/extensions";
import { AgentServicePortKey, type AgentService } from "@xeon/contracts/services";
import type { SettingDef, SettingGroup } from "@xeon/contracts/settings";
import {
  hostOf,
  PrimitiveError,
  type CommandResourceDef,
  type ScopeCallContext,
  type StateMigration,
} from "@xeon/ext-host";
import {
  checkDelegateSpec,
  delegateResultOf,
  delegateStatusOf,
  toDelegateRequest,
  type CancelDelegatesResult,
  type DelegateCallOptions,
  type DelegateResult,
  type DelegateSpec,
  type DelegateStatusResult,
} from "./delegate.ts";
import { createMetricsCounter, type MetricsCounter } from "./metrics/counter.ts";
import { GroupSettingsSourceKey, type GroupSettingsSource } from "./ports/settings.ts";
import { checkPostItem, checkRecordKind, type RecordCheck } from "./records.ts";
import { checkStateCommit, migrationChain, type StateMigrations } from "./state.ts";
import type {
  GroupApi,
  GroupSettingDefs,
  GroupSettingNamespace,
  GroupSettingValues,
} from "./types.ts";

/** 지금 실행 중인 재실행 문맥(on 핸들러 또는 drive 함수)의 thread와 취소 신호. 원천은 X `hostOf(g).callContext()`다 */
export type GroupCallContext = ScopeCallContext;

/** wrap이 X의 hostOf를 통해 쓰는 연산. checkGroup 같은 도구가 대역으로 바꿀 수 있게 좁게 나눈다 */
export interface GroupHostAccess {
  registerTool(def: ToolResourceDef): void;
  registerCommand(name: string, def: CommandResourceDef): void;
  migrateState(fn: StateMigration): void;
  /** 설정 읽기 포트. 없거나 내장 확장이 아니면 undefined */
  settingsSource(): GroupSettingsSource | undefined;
  /** L1 위임 서비스(`xeon.agents`). 없거나 내장 확장이 아니면 undefined */
  agents(): AgentService | undefined;
  /** 재실행 문맥 안이면 그 문맥. 문맥 밖(명령 처리기, 도구 execute, onDispose)이면 undefined */
  callContext(): GroupCallContext | undefined;
}

export type HostAccessFactory<S> = (api: ScopeApi<S>) => GroupHostAccess;

const PORT_ABSENT: ReadonlySet<string> = new Set(["port_unavailable", "service_reserved"]);

/** ext-host가 만든 g에서 X 부가 API를 꺼낸다. setup 안에서만 쓴다 */
export function realHostAccess<S>(api: ScopeApi<S>): GroupHostAccess {
  return {
    registerTool: (def) => {
      hostOf(api).registerTool(def);
    },
    registerCommand: (name, def) => {
      hostOf(api).registerCommand(name, def);
    },
    migrateState: (fn) => {
      hostOf(api).migrateState(fn);
    },
    settingsSource: () => optionalPort(api, GroupSettingsSourceKey),
    agents: () => optionalPort(api, AgentServicePortKey),
    callContext: () => hostOf(api).callContext(),
  };
}

/** 포트가 없거나 쓸 수 없는 확장이면 undefined. 그 밖의 오류는 버그라 다시 던진다 */
function optionalPort<S, Api>(api: ScopeApi<S>, key: PortKey<Api>): Api | undefined {
  const found = attempt(() => hostOf(api).port(key));
  if (found.ok) return found.value;
  const cause = found.error.cause;
  if (cause instanceof PrimitiveError && PORT_ABSENT.has(cause.code)) return undefined;
  return rethrow(cause);
}

/** wrap이 읽는 GroupDef의 부분 */
export interface WrapDef<S, D extends GroupSettingDefs> {
  readonly manifest: ExtensionManifest;
  readonly state?: StateDecl<S>;
  readonly migrations?: StateMigrations;
  readonly settings?: SettingGroup<GroupSettingNamespace, D>;
}

/** 설정 값 하나. 값이 있고 스키마를 통과하면 그 값, 아니면 기본값 */
function settingValue(def: SettingDef, source: GroupSettingsSource | undefined): unknown {
  const raw = source?.value(def.key);
  if (raw !== undefined) {
    const checked = parse(def.type, raw);
    if (checked.ok) return checked.value;
  }
  return def.default;
}

/** 모든 키의 값이 자기 스키마를 통과했으면 GroupSettingValues<D>다 */
function isSettingValues<D extends GroupSettingDefs>(
  group: SettingGroup<GroupSettingNamespace, D>,
  values: Readonly<Record<string, unknown>>,
): values is GroupSettingValues<D> {
  return Object.entries<SettingDef>(group.defs).every(
    ([name, def]) => parse(def.type, values[name]).ok,
  );
}

function readSettings<D extends GroupSettingDefs>(
  group: SettingGroup<GroupSettingNamespace, D> | undefined,
  source: GroupSettingsSource | undefined,
  groupName: string,
): GroupSettingValues<D> {
  const values: Record<string, unknown> = {};
  if (group !== undefined) {
    for (const [name, def] of Object.entries<SettingDef>(group.defs)) {
      values[name] = settingValue(def, source);
    }
    if (isSettingValues(group, values)) return values;
    throw new Bug(
      `group.settings: ${groupName} has a setting with neither a valid value nor a default`,
    );
  }
  return emptySettings<D>(values);
}

/** 설정 묶음이 없는 그룹의 값. 키가 없는 빈 객체다 */
function emptySettings<D extends GroupSettingDefs>(
  values: Readonly<Record<string, unknown>>,
): GroupSettingValues<D> {
  if (Object.keys(values).length === 0 && isEmptyValues<D>(values)) return values;
  throw new Bug("group.settings: a group without settings produced values");
}

function isEmptyValues<D extends GroupSettingDefs>(
  values: Readonly<Record<string, unknown>>,
): values is GroupSettingValues<D> {
  return Object.keys(values).length === 0;
}

function wrapLoop(loop: LoopHandle, counter: MetricsCounter): LoopHandle {
  return {
    turn: (input) => loop.turn(input),
    spawn: (spec: SpawnSpec) => {
      counter.bump("spawns");
      return loop.spawn(spec);
    },
    get budget() {
      return loop.budget;
    },
    get signal() {
      return loop.signal;
    },
  };
}

/** 검사 실패를 X가 던지는 것과 같은 PrimitiveError로 바꿔 던진다 */
function ensure(check: RecordCheck, scopeId: string): void {
  if (!check.ok) throw new PrimitiveError(check.code, check.message, { scopeId });
}

/**
 * F ScopeApi<S>를 GroupApi<S, D>로 감싼다(L3.group-kit.spec §3.2). setup 안에서 한 번 부른다.
 * 감싼 연산은 원래 연산을 그대로 부르고 메모리 계측(§4.9)만 더한다.
 */
export function wrap<S, D extends GroupSettingDefs>(
  api: ScopeApi<S>,
  def: WrapDef<S, D>,
  hostAccess: HostAccessFactory<S>,
): GroupApi<S, D> {
  const access = hostAccess(api);
  const counter = createMetricsCounter(def.manifest.name);
  /** onDispose가 시작되면 참. 꺼지는 중인 그룹의 delegate는 group.disabling이다(§4.10) */
  let disposing = false;
  api.onDispose(() => {
    disposing = true;
  });
  if (def.state !== undefined && def.state.version >= 2) {
    access.migrateState(migrationChain(def.state.version, def.migrations));
  }
  return {
    id: api.id,
    on: (point, handler) => api.on(point, handler),
    post: async (item, options) => {
      ensure(checkPostItem(def.manifest, item), api.id);
      const receipt = await api.post(item, options);
      if (!receipt.duplicate) counter.bump("posts");
      return receipt;
    },
    drive: (fn: DriveFn<S>, options?: DriveOptions) => {
      api.drive((loop, state) => fn(wrapLoop(loop, counter), state), options);
    },
    state: () => api.state(),
    commit: async (next) => {
      const decl = def.state;
      if (decl === undefined) return api.commit(next); // X가 state_undeclared로 거부한다
      const current = api.state();
      const checked = checkStateCommit(decl, current, next);
      if (!checked.ok) {
        throw new PrimitiveError(
          checked.kind === "state.schema" ? "state_schema" : "state_too_large",
          checked.kind === "state.schema"
            ? `state of ${api.id} does not match its schema: ${checked.issues.join("; ")}`
            : `state of ${api.id} is ${checked.bytes} bytes, over the ${checked.limit} byte limit`,
          { scopeId: api.id },
        );
      }
      if (checked.unchanged) return current;
      const committed = await api.commit(next);
      counter.bump("commits");
      return committed;
    },
    record: async (kind, subject, payload) => {
      ensure(checkRecordKind(def.manifest, kind), api.id);
      await api.record(kind, subject, payload);
      counter.bump("records");
    },
    readRecords: (query) => api.readRecords(query),
    recordPrivate: (kind, payload) => api.recordPrivate(kind, payload),
    capability: <Api>(key: ServiceKey<Api>): Api => api.capability(key),
    onDispose: (fn) => {
      api.onDispose(fn);
    },
    settings: () => readSettings(def.settings, access.settingsSource(), def.manifest.name),
    delegate: async (
      spec: DelegateSpec,
      options?: DelegateCallOptions,
    ): Promise<DelegateResult> => {
      const invalid = checkDelegateSpec(spec, def.manifest.name);
      if (invalid !== undefined) return { ok: false, error: invalid };
      if (disposing) return { ok: false, error: { kind: "group.disabling", id: api.id } };
      const agents = access.agents();
      const context = access.callContext();
      const threadId = options?.threadId ?? context?.threadId;
      if (agents === undefined || threadId === undefined) {
        return { ok: false, error: { kind: "group.delegateUnavailable" } };
      }
      const called = await attemptAsync(() =>
        agents.delegate(toDelegateRequest(spec), {
          parentThreadId: threadId,
          owner: { kind: "scope", scopeId: api.id },
          caller: "main",
          depth: 0,
          ownerRequestId: spec.requestId,
          signal: options?.signal ?? context?.signal ?? new AbortController().signal,
        }),
      );
      if (!called.ok) {
        return {
          ok: false,
          error: { kind: "group.delegateFailed", message: describeCause(called.error.cause) },
        };
      }
      const result = delegateResultOf(called.value);
      if (result.ok && result.receipt.status === "accepted") counter.bump("delegates");
      return result;
    },
    delegateStatus: (
      requestId: string,
      options?: Pick<DelegateCallOptions, "threadId">,
    ): DelegateStatusResult => {
      const context = access.callContext();
      if (context?.kind === "on") {
        return {
          ok: false,
          error: { kind: "group.effectNotAllowed", effect: "g.delegateStatus", context: "on" },
        };
      }
      const agents = access.agents();
      const threadId = options?.threadId ?? context?.threadId;
      if (agents === undefined || threadId === undefined) {
        return { ok: false, error: { kind: "group.delegateUnavailable" } };
      }
      const found = agents.status(threadId, requestId);
      return { ok: true, status: found === undefined ? undefined : delegateStatusOf(found) };
    },
    cancelDelegates: async (reason?: string): Promise<CancelDelegatesResult> => {
      const context = access.callContext();
      if (context !== undefined) {
        return {
          ok: false,
          error: {
            kind: "group.effectNotAllowed",
            effect: "g.cancelDelegates",
            context: context.kind,
          },
        };
      }
      const agents = access.agents();
      if (agents === undefined) return { ok: false, error: { kind: "group.delegateUnavailable" } };
      const called = await attemptAsync(() =>
        agents.cancel({ ownerScopeId: api.id }, reason ?? "group disabled"),
      );
      if (!called.ok) {
        return {
          ok: false,
          error: { kind: "group.delegateFailed", message: describeCause(called.error.cause) },
        };
      }
      return { ok: true, cancelled: called.value.cancelled };
    },
    metrics: counter.handle,
    registerTool: (toolDef) => {
      access.registerTool(toolDef);
    },
    registerCommand: (name, commandDef) => {
      access.registerCommand(name, commandDef);
    },
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
