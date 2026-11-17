import { Bug, assertNever, attempt, attemptAsync, parse, rethrow } from "@fresnel/contracts";
import type { ServiceKey } from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import type {
  DriveCommand,
  DriveOptions,
  DriveStep,
  ExtensionManifest,
  PortKey,
  ProviderResourceDef,
  RegistrationApi,
  StateDecl,
  ToolResourceDef,
} from "@fresnel/contracts/extensions";
import { AgentServicePortKey, type AgentService } from "@fresnel/contracts/services";
import type { SettingDef, SettingGroup } from "@fresnel/contracts/settings";
import {
  hostOf,
  PrimitiveError,
  type CommandResourceDef,
  type ExtMethodResourceDef,
  type RegistrationCallContext,
  type StateMigration,
} from "@fresnel/ext-host";
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
import { countedHandler } from "./metrics/handler.ts";
import { defaultMetricsRegistry } from "./metrics/registry.ts";
import { createBoundaryRecorder, INSTRUMENTATION_KEY } from "./metrics/record.ts";
import type { GroupSettingsSource } from "./ports/settings.ts";
import { checkPostItem, checkRecordKind, type RecordCheck } from "./records.ts";
import { orchestrationOf } from "./util.ts";
import { checkStateCommit, migrationChain, type StateMigrations } from "./state.ts";
import type {
  GroupApi,
  GroupSettingDefs,
  GroupSettingNamespace,
  GroupSettingValues,
  GroupStartDriveResult,
} from "./types.ts";

/** 지금 실행 중인 재실행 문맥(on 핸들러 또는 drive 함수)의 thread와 취소 신호. 원천은 X `hostOf(g).callContext()`다 */
export type GroupCallContext = RegistrationCallContext;

/** wrap이 X의 hostOf를 통해 쓰는 연산. checkGroup 같은 도구가 대역으로 바꿀 수 있게 좁게 나눈다 */
export interface GroupHostAccess {
  registerTool(def: ToolResourceDef): void;
  registerCommand(name: string, def: CommandResourceDef): void;
  registerMethod(verb: string, def: ExtMethodResourceDef): void;
  registerProvider(name: string, config: ProviderResourceDef): void;
  migrateState(fn: StateMigration): void;
  /** 설정 읽기. 내장 그룹은 모든 키, 그 밖의 그룹은 자기 `ext.<id>.*` 키만 값이 나온다 */
  settingsSource(): GroupSettingsSource | undefined;
  /** L1 위임 서비스(`fresnel.agents`). 없거나 내장 확장이 아니면 undefined */
  agents(): AgentService | undefined;
  /** 재실행 문맥 안이면 그 문맥. 문맥 밖(명령 처리기, 도구 execute, onDispose)이면 undefined */
  callContext(): GroupCallContext | undefined;
  /** 주도 시작 요청(X `hostOf(g).startDrive`). 문맥의 thread에 이 scope를 넣는다 */
  startDrive(input?: JsonValue): GroupStartDriveResult;
}

export type HostAccessFactory<S> = (api: RegistrationApi<S>) => GroupHostAccess;

const PORT_ABSENT: ReadonlySet<string> = new Set(["port_unavailable", "service_reserved"]);

/** ext-host가 만든 g에서 X 부가 API를 꺼낸다. setup 안에서만 쓴다 */
export function realHostAccess<S>(api: RegistrationApi<S>): GroupHostAccess {
  return {
    registerTool: (def) => {
      hostOf(api).registerTool(def);
    },
    registerCommand: (name, def) => {
      hostOf(api).registerCommand(name, def);
    },
    registerMethod: (verb, def) => {
      hostOf(api).registerMethod(verb, def);
    },
    registerProvider: (name, config) => {
      hostOf(api).registerProvider(name, config);
    },
    migrateState: (fn) => {
      hostOf(api).migrateState(fn);
    },
    // 내장이 아닌 그룹은 `fresnel.*` 포트를 못 쓰므로 X의 `settingValue`를 거친다. 자기 `ext.<id>.*` 키만 읽힌다(X.primitives.spec §3.8)
    settingsSource: () => ({ value: (key) => hostOf(api).settingValue(key) }),
    agents: () => optionalPort(api, AgentServicePortKey),
    callContext: () => hostOf(api).callContext(),
    startDrive: (input) => hostOf(api).startDrive(input),
  };
}

/** 포트가 없거나 쓸 수 없는 확장이면 undefined. 그 밖의 오류는 버그라 다시 던진다 */
function optionalPort<S, Api>(api: RegistrationApi<S>, key: PortKey<Api>): Api | undefined {
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

/** 검사 실패를 X가 던지는 것과 같은 PrimitiveError로 바꿔 던진다 */
function ensure(check: RecordCheck, scopeId: string): void {
  if (!check.ok) throw new PrimitiveError(check.code, check.message, { scopeId });
}

/**
 * 상태 커밋 전 검사. `g.commit`과 drive의 `commit` 명령이 같이 쓴다(L3.group-sdk.spec §4.5 2번). 실패하면 X와 같은 PrimitiveError를 던진다.
 * 돌려주는 값은 상태가 바뀌었는가다. 같은 값이면 X를 부르지 않아도 된다(§4.5 3번)
 */
function checkedCommit<S>(
  decl: StateDecl<S>,
  scopeId: string,
  current: Readonly<S>,
  next: S,
): boolean {
  const checked = checkStateCommit(decl, current, next);
  if (!checked.ok) {
    throw new PrimitiveError(
      checked.kind === "state.schema" ? "state_schema" : "state_too_large",
      checked.kind === "state.schema"
        ? `state of ${scopeId} does not match its schema: ${checked.issues.join("; ")}`
        : `state of ${scopeId} is ${checked.bytes} bytes, over the ${checked.limit} byte limit`,
      { scopeId },
    );
  }
  return !checked.unchanged;
}

/**
 * 단계 함수가 돌려준 명령을 검사하고 계측한 뒤 그대로 돌려준다. 엔진이 그 명령을 바로 실행한다.
 * `spawn`은 `spawns`를 올린다. `commit`은 g.commit과 같은 검사를 받고 값이 바뀐 것만 `commits`로 세며, 같은 값이면 명령을 `next`로 바꿔 넘긴다.
 * `next` 사슬 안의 `commit`도 직전 커밋 값(`current`)과 비교해 같은 검사를 받는다. 상태 정의가 없으면 X가 `state_undeclared`로
 * 거부하므로 그대로 둔다
 */
function instrumentCommand<S>(
  command: DriveCommand<S>,
  scope: { readonly id: string; readonly decl: StateDecl<S> | undefined },
  current: Readonly<S>,
  counter: MetricsCounter,
): DriveCommand<S> {
  switch (command.do) {
    case "spawn":
      counter.bump("spawns");
      return command;
    case "commit": {
      const { decl } = scope;
      if (decl === undefined) return command;
      // 값이 같으면 상태 사건을 쓰지 않고 `next`로 넘어간다(L3.group-sdk.spec §4.5 3번). 계측도 하지 않는다
      if (!checkedCommit(decl, scope.id, current, command.state)) {
        return instrumentCommand(command.next, scope, current, counter);
      }
      counter.bump("commits");
      return {
        ...command,
        next: instrumentCommand(command.next, scope, command.state, counter),
      };
    }
    case "turn":
    case "model":
    case "tool":
    case "ask":
    case "handoff":
    case "yield":
    case "done":
      return command;
    default:
      return assertNever(command, "instrumentCommand");
  }
}

/**
 * F RegistrationApi<S>를 GroupApi<S, D>로 감싼다(L3.group-sdk.spec §3.2). setup 안에서 한 번 부른다.
 * 감싼 연산은 원래 연산을 그대로 부르고 메모리 계측(§4.9)만 더한다.
 */
export function wrap<S, D extends GroupSettingDefs>(
  api: RegistrationApi<S>,
  def: WrapDef<S, D>,
  hostAccess: HostAccessFactory<S>,
): GroupApi<S, D> {
  const access = hostAccess(api);
  const counter = createMetricsCounter(def.manifest.name);
  defaultMetricsRegistry.register(def.manifest.name, counter.handle);
  // 경계 기록은 그룹 자신의 boundary.settle.after 핸들러가 끝난 뒤 그 호출 안에서 쓴다(§4.9). 설정을 읽지 못하면 켠 것으로 본다
  const afterSettle =
    orchestrationOf(def.manifest)?.hooks.includes("boundary.settle.after") === true
      ? createBoundaryRecorder({
          api,
          groupId: def.manifest.name,
          counter,
          enabled: () => access.settingsSource()?.value(INSTRUMENTATION_KEY) !== false,
        })
      : undefined;
  /**
   * 위임 서비스(`fresnel.agents`). 포트 조회는 scope의 generation이 닫히면 거부되고 `onDispose`는 닫힌 뒤에 돌므로,
   * 처음 얻은 값을 기억해 `cancelDelegates`가 `onDispose` 안에서도 쓰게 한다(L3.group-sdk.spec §4.10)
   */
  let agentsHandle: AgentService | undefined;
  const agentsOf = (): AgentService | undefined => {
    const found = attempt(() => access.agents());
    if (found.ok) {
      agentsHandle = found.value ?? agentsHandle;
      return agentsHandle;
    }
    if (agentsHandle !== undefined) return agentsHandle;
    return rethrow(found.error.cause);
  };
  agentsOf();
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
    on: (point, handler) =>
      api.on(
        point,
        countedHandler(
          point,
          handler,
          counter,
          point === "boundary.settle.after" ? afterSettle : undefined,
        ),
      ),
    post: async (item, options) => {
      ensure(checkPostItem(def.manifest, item), api.id);
      const receipt = await api.post(item, options);
      if (!receipt.duplicate) counter.bump("posts");
      return receipt;
    },
    drive: (step: DriveStep<S>, options?: DriveOptions) => {
      const scope = { id: api.id, decl: def.state };
      api.drive(async (input) => {
        const command = await step(input);
        return instrumentCommand(command, scope, input.state, counter);
      }, options);
    },
    state: () => api.state(),
    commit: async (next) => {
      const decl = def.state;
      if (decl === undefined) return api.commit(next); // X가 state_undeclared로 거부한다
      const current = api.state();
      if (!checkedCommit(decl, api.id, current, next)) return current;
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
      const agents = agentsOf();
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
      const agents = agentsOf();
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
      const agents = agentsOf();
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
    startDrive: (input) => access.startDrive(input),
    registerTool: (toolDef) => {
      access.registerTool(toolDef);
    },
    registerCommand: (name, commandDef) => {
      access.registerCommand(name, commandDef);
    },
    registerMethod: (verb, methodDef) => {
      access.registerMethod(verb, methodDef);
    },
    registerProvider: (name, config) => {
      access.registerProvider(name, config);
    },
  };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
