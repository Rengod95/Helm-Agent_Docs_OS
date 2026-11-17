// 자식 쪽 등록 상태와, setup이 받는 g(RegistrationApi)와 hostOf(g)의 부가 API(RegistrationHostApi)를 만든다.
// 엔진이 가진 것(상태 쓰기, 기록, 기능 호출)은 env.engineCall로 보낸다. 요청 문맥(어느 엔진 요청인지, 상태 스냅샷,
// 설정, 취소 신호)은 env.scopes에 싣는다. 여기 있는 함수는 엔진 쪽 등록(`createRegistrationApi`)과 같은 표면을 준다.
//
// `migrateState`, `updateState`(`hostOf`), `awaitUser`, `startDrive`(`hostOf`)는 프로토콜로 넘긴다. 함수는 자식에서 돌리고 엔진은 저장과 비교만 한다
// (`state.migrate` 요청, `engine.call` `updateState`, `awaitUser`, `startDrive`, isolation-protocol.ts).
// `drive`는 setup에서 단계 함수를 한 번 받아 두고, 엔진이 단계마다 `drive.step` 요청으로 부른다(drive-isolation.md 1.1, 3.2).
// 막힌 API(`provide`, `providePort`, `registerWebProvider`, `registerShortcut`)는 이름을 상태에 남기고 던진다.
// setup이 이들을 썼으면 등록이 `unsupported_api`로 떨어진다.
// `port`는 예외다. group-sdk의 wrap이 setup에서 port를 읽고 `service_reserved`를 "없음"으로 받으므로, 막힘을 기록하지 않고
// 엔진 쪽 비내장 확장과 같은 `service_reserved`로 던진다.
import type { AsyncLocalStorage } from "node:async_hooks";
import {
  attemptAsync,
  Bug,
  detach,
  err,
  ok,
  parse,
  type ParseError,
  type Result,
} from "@fresnel/contracts";
import type { ServiceKey } from "@fresnel/contracts/capabilities";
import { toJsonValue, type JsonValue, type ThreadId } from "@fresnel/contracts/conversation";
import {
  HOOKS,
  isHighFrequency,
  type DriveOptions,
  type DriveStep,
  type EngineCallParams,
  type GroupRecord,
  type Handler,
  type HookName,
  type PluginEngineCallName,
  type PluginHostError,
  type PluginRegistrationDecl,
  type PluginToolDecl,
  type PortKey,
  type PostItem,
  type PostOptions,
  type PostReceipt,
  type ProviderResourceDef,
  type RecordKind,
  type RecordQuery,
  type RecordSubject,
  type RegistrationApi,
  type RegistrationDef,
  type RegistrationId,
  type RegistrationSetup,
  type ToolResourceDef,
  type UpdateStateReply,
  type Unsubscribe,
} from "@fresnel/contracts/extensions";
import { eraseHandler, serviceAs, stateAs } from "../erase.ts";
import { PrimitiveError } from "../primitives/errors.ts";
import type { AnyState } from "../primitives/erased-types.ts";
import {
  bindHostApiForIsolation,
  type RegistrationCallContext,
  type RegistrationHostApi,
  type RegistrationStartDriveError,
  type StateMigration,
} from "../primitives/host-api.ts";
import type { EffectRequest } from "../primitives/effect-worker.ts";
import type { RecordInput, StateUpdateError } from "../primitives/state.ts";
import type {
  CommandResourceDef,
  FlagResourceDef,
  RendererResourceDef,
} from "../primitives/resources.ts";
import type { ExtMethodResourceDef } from "../primitives/ext-method.ts";
import { subscribedNames, subscribeWith, type DispatchContext } from "../primitives/subscribe.ts";
import {
  parseGroupRecords,
  parsePostReceipt,
  parseStartDriveReply,
  parseUpdateStateReply,
} from "./params.ts";

/** 엔진이 실패로 답한 `engine.call`. 엔진의 kind와 메시지를 싣는다. 바깥에서 온 오류를 감싸므로 Error 하위다(TY-16) */
export class PluginEngineCallError extends Error {
  override readonly name: string = "PluginEngineCallError";
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** 요청 하나의 문맥. `g.state()`, `g.commit`, `hostOf(g).callContext()`, `settingValue`가 읽는다 */
export interface CallScope {
  readonly kind: "hook" | "notify" | "tool" | "command" | "method" | "drive";
  readonly registration: RegistrationId;
  /** 이 요청을 보낸 엔진 요청의 id. 알림이면 null */
  readonly requestId: number | null;
  readonly threadId: ThreadId | null;
  readonly signal: AbortSignal;
  /** 훅이나 알림이면 그 지점 */
  readonly point: HookName | null;
  readonly settings: Readonly<Record<string, JsonValue>>;
  /** 요청 시작 시점의 상태 스냅샷. 커밋 응답이 오면 이 자리를 바꾼다 */
  readonly snapshot: { doc: JsonValue };
  /** 훅이나 알림이면 엔진 디스패치 키. 구독 봉투의 `eventKey`가 된다 */
  readonly dispatchKey?: string;
  /** 알림이면 엔진이 이 전달 앞에서 합친 수(덮인 전달). 합치기가 없었으면 생략한다. 구독 봉투의 `dropped`에 더한다 */
  readonly dropped?: number;
}

export interface ChildEnv {
  readonly extension: string;
  /** host.init의 설정. 요청 밖에서 `settingValue`가 읽는다 */
  readonly initSettings: Readonly<Record<string, JsonValue>>;
  readonly scopes: AsyncLocalStorage<CallScope>;
  /** 호스트 프로세스의 수명 신호. 요청 밖의 `awaitUser`가 종료 때 대기를 끊는 데 쓴다(엔진 안의 scope 세대 신호와 같다) */
  readonly lifetime: AbortSignal;
  readonly engineCall: (params: EngineCallParams) => Promise<JsonValue>;
  /** 플러그인마다 매니페스트 `hooks`(등록 id 기준). `g.subscribe("all")`과 선언 검사가 읽는다 */
  readonly declaredHooks: ReadonlyMap<RegistrationId, readonly HookName[]>;
  /** 기다리지 않는 작업의 실패를 진단으로 남긴다 */
  readonly report: (text: string) => void;
}

/** 훅 핸들러 하나. `handlerIndex`는 같은 등록·지점 안의 등록 순서이고 해제해도 바뀌지 않는다 */
export interface HandlerSlot {
  readonly point: HookName;
  readonly handlerIndex: number;
  readonly fn: (...args: readonly unknown[]) => unknown;
  active: boolean;
  /** 알림을 같은 구독자에게 발화 순서대로 하나씩 전달하는 줄 */
  tail: Promise<void>;
}

/** setup이 받은 주도 단계 함수와 한도 옵션. 엔진이 `drive.step`으로 부른다 */
interface DriveReg {
  readonly step: DriveStep<AnyState>;
  readonly options: DriveOptions | undefined;
}

/** 등록 하나의 자식 쪽 상태 */
export interface RegState {
  readonly id: RegistrationId;
  readonly stateDecl: RegistrationDef<AnyState>["state"];
  readonly defaultEnabled: boolean | undefined;
  /** setup 중에만 참이다. 등록 함수는 그 밖에서 `registration_inactive`로 거부된다 */
  inSetup: boolean;
  /** `g.state()`가 요청 밖에서 읽는 값. 처음은 선언의 initial이고 커밋 응답으로 바뀐다 */
  lastState: unknown;
  readonly slots: Map<HookName, HandlerSlot[]>;
  readonly tools: Map<string, ToolResourceDef>;
  readonly commands: Map<string, CommandResourceDef>;
  readonly methods: Map<string, ExtMethodResourceDef>;
  readonly flags: Map<string, FlagResourceDef>;
  readonly providers: Map<string, ProviderResourceDef>;
  readonly mcpServers: Map<string, JsonValue>;
  readonly renderers: Map<string, RendererResourceDef>;
  readonly disposers: (() => void | Promise<void>)[];
  /** 막힌 API 이름. setup이 쓰면 등록이 `unsupported_api`로 떨어진다 */
  readonly unsupported: string[];
  /** `drive`로 등록한 단계 함수. setup 안에서 한 번 정해진다 */
  drive: DriveReg | undefined;
  /** `migrateState`로 등록한 함수. setup 안에서 한 번 정해진다 */
  migration: StateMigration | undefined;
  /** (thread)별 `updateState` 줄의 꼬리. 같은 줄의 호출은 호출 순서대로 하나씩 돈다 */
  readonly updateTails: Map<string, Promise<void>>;
}

export interface ChildRegistration {
  readonly state: RegState;
  readonly setup: RegistrationSetup<AnyState>;
  readonly api: RegistrationApi<AnyState>;
}

/** 오류 값의 메시지. Error가 아니면 문자열로 바꾼다 */
export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 훅 지점 이름인가. HOOKS의 키 집합과 같다 */
export function isHookName(text: string): text is HookName {
  return Object.hasOwn(HOOKS, text);
}

/** 검증 실패의 항목을 한 줄로 쓴다. 엔진에 보내는 `invalid_params` 메시지가 된다 */
export function describeParse(error: ParseError): string {
  return error.issues.map((issue) => `${issue.path || "/"} ${issue.message}`).join("; ");
}

function jsonOf(value: unknown, what: string): JsonValue {
  const json = toJsonValue(value);
  if (json === undefined) throw new TypeError(`${what} must be JSON-serializable`);
  return json;
}

function optionalJson(value: unknown, what: string): JsonValue {
  return value === undefined ? null : jsonOf(value, what);
}

/** 엔진 응답을 검증한다(TY-10). 맞지 않으면 엔진 응답 오류로 던진다 */
function checked<T>(result: Result<T, ParseError>, what: string): T {
  if (result.ok) return result.value;
  throw new PluginEngineCallError(
    "invalid_result",
    `${what} from the engine does not match its shape: ${describeParse(result.error)}`,
  );
}

function callEngine(
  env: ChildEnv,
  state: RegState,
  method: PluginEngineCallName,
  params: JsonValue,
): Promise<JsonValue> {
  return env.engineCall({
    method,
    registration: state.id,
    requestId: env.scopes.getStore()?.requestId ?? null,
    params,
  });
}

function requireSetup(state: RegState, what: string): void {
  if (state.inSetup) return;
  throw new PrimitiveError(
    "registration_inactive",
    `${what} can only be called during setup in an isolated plugin host`,
    { scopeId: state.id },
  );
}

function requireStateDecl(state: RegState): NonNullable<RegState["stateDecl"]> {
  const decl = state.stateDecl;
  if (decl === undefined) {
    throw new PrimitiveError("state_undeclared", `scope ${state.id} has no state`, {
      scopeId: state.id,
    });
  }
  return decl;
}

/** 막힌 API를 기록하고 던진다. 던진 오류는 setup이 삼켜도 등록이 실패하도록 이름을 남긴다 */
function unsupported(state: RegState, api: string): never {
  state.unsupported.push(api);
  throw new Error(`${api} is not supported in an isolated plugin host (registration ${state.id})`);
}

function addUnique<T>(
  state: RegState,
  map: Map<string, T>,
  kind: string,
  name: string,
  value: T,
): void {
  if (map.has(name)) {
    throw new PrimitiveError(
      "resource_conflict",
      `${kind} ${name} is already registered in ${state.id}`,
      { scopeId: state.id },
    );
  }
  map.set(name, value);
}

function slotsOf(state: RegState, point: HookName): HandlerSlot[] {
  const existing = state.slots.get(point);
  if (existing !== undefined) return existing;
  const created: HandlerSlot[] = [];
  state.slots.set(point, created);
  return created;
}

/** 요청 시작 시점 또는 마지막 커밋 값. 요청 문맥의 등록과 같으면 스냅샷을 쓴다 */
function currentState(state: RegState, env: ChildEnv): unknown {
  const scope = env.scopes.getStore();
  return scope !== undefined && scope.registration === state.id
    ? scope.snapshot.doc
    : state.lastState;
}

function setCommitted(state: RegState, env: ChildEnv, doc: JsonValue): void {
  state.lastState = doc;
  const scope = env.scopes.getStore();
  if (scope !== undefined && scope.registration === state.id) scope.snapshot.doc = doc;
}

/** 엔진이 커밋한 상태 문서를 선언 스키마로 확인하고 문맥의 스냅샷을 바꾼다 */
function acceptState(state: RegState, env: ChildEnv, doc: JsonValue): AnyState {
  const decl = requireStateDecl(state);
  checked(parse(decl.schema, doc), "the committed state");
  setCommitted(state, env, doc);
  return stateAs(doc);
}

/** 같은 줄(thread별)의 `updateState`를 호출 순서대로 하나씩 돌린다. 앞 작업이 실패해도 뒤 작업은 이어 간다 */
function serializeUpdate<T>(state: RegState, key: string, task: () => Promise<T>): Promise<T> {
  const previous = state.updateTails.get(key) ?? Promise.resolve();
  const result = previous.then(task);
  const settled: Promise<void> = Promise.allSettled([result]).then(() => {
    if (state.updateTails.get(key) === settled) state.updateTails.delete(key);
    return undefined;
  });
  state.updateTails.set(key, settled);
  return result;
}

/**
 * 한 번의 시도: 호스트가 `fn`을 부르고 엔진에 비교 후 커밋을 청한다. 엔진이 가진 문서가 `prev`와 다르면 conflict다.
 * 엔진의 답은 값이고 던지지 않는다(엔진의 응답 모양이 틀린 것만 던진다)
 */
async function updateAttempt(
  state: RegState,
  env: ChildEnv,
  prev: JsonValue,
  fn: (prev: Readonly<AnyState>) => AnyState,
  records: ((next: AnyState) => readonly RecordInput[]) | undefined,
): Promise<UpdateStateReply> {
  const next = fn(stateAs(prev));
  const body = jsonOf(
    {
      prev,
      next: jsonOf(next, "the state"),
      records: jsonOf(records?.(next) ?? [], "the records"),
    },
    "the update",
  );
  const reply = await callEngine(env, state, "updateState", body);
  return checked(parseUpdateStateReply(reply), "the update reply");
}

/**
 * `updateState`의 호스트 쪽. 줄 안에서 현재 스냅샷으로 `fn`을 부르고, 엔진에서 conflict면 엔진이 준 현재 문서로 한 번 더 한다.
 * 두 번째도 conflict면 `state_conflict` 값이다. 저장 실패(스키마, 크기, 저장소)도 값으로 돌려준다
 */
async function updateStateOf(
  state: RegState,
  env: ChildEnv,
  fn: (prev: Readonly<AnyState>) => AnyState,
  records: ((next: AnyState) => readonly RecordInput[]) | undefined,
): Promise<Result<Readonly<AnyState>, StateUpdateError>> {
  requireStateDecl(state);
  const threadKey = env.scopes.getStore()?.threadId ?? "";
  return serializeUpdate(
    state,
    threadKey,
    async (): Promise<Result<Readonly<AnyState>, StateUpdateError>> => {
      const snapshot = jsonOf(currentState(state, env), "the state");
      const first = await updateAttempt(state, env, snapshot, fn, records);
      const reply =
        first.kind === "conflict"
          ? await updateAttempt(state, env, first.current, fn, records)
          : first;
      if (reply.kind === "committed") return ok(acceptState(state, env, reply.state));
      if (reply.kind === "failed") return err({ kind: reply.failure });
      return err({ kind: "state_conflict" });
    },
  );
}

function withoutSignal(options: unknown): unknown {
  if (typeof options !== "object" || options === null) return options;
  const entries = Object.entries(options).filter(([key]) => key !== "signal");
  return Object.fromEntries(entries);
}

/**
 * 기능 서비스 프록시. 어떤 멤버를 불러도 `capability` 호출 하나가 된다. `then`은 undefined다(약속으로 오인하지 않게)
 */
function capabilityProxy<Api>(state: RegState, env: ChildEnv, key: ServiceKey<Api>): object {
  const keyJson: JsonValue = { capability: key.capability, version: key.version };
  return new Proxy(
    {},
    {
      get(_target, member) {
        if (typeof member !== "string" || member === "then") return undefined;
        return (input: unknown, options: unknown): Promise<JsonValue> =>
          callEngine(env, state, "capability", {
            key: keyJson,
            member,
            input: optionalJson(input, "the capability input"),
            options: optionalJson(withoutSignal(options), "the capability options"),
          });
      },
    },
  );
}

/** 구독이 핸들러 안에서 읽는 디스패치 맥락. 요청 문맥(scopes)에 실린 키를 쓰고, 뒤에서 돌 때도 같은 문맥을 다시 싣는다 */
function childDispatch(env: ChildEnv): DispatchContext {
  const scope = env.scopes.getStore();
  if (scope === undefined || scope.dispatchKey === undefined) {
    throw new Bug("subscribe.no_dispatch_context: an event handler runs inside a dispatch");
  }
  return {
    eventKey: scope.dispatchKey,
    rerun: (work) => Promise.resolve(env.scopes.run(scope, work)),
    ...(scope.dropped === undefined ? {} : { dropped: scope.dropped }),
  };
}

function makeApi(state: RegState, env: ChildEnv): RegistrationApi<AnyState> {
  const api: RegistrationApi<AnyState> = {
    id: state.id,
    on<N extends HookName>(point: N, handler: Handler<N, AnyState>): Unsubscribe {
      requireSetup(state, "on");
      const list = slotsOf(state, point);
      const slot: HandlerSlot = {
        point,
        handlerIndex: list.length,
        fn: eraseHandler(handler),
        active: true,
        tail: Promise.resolve(),
      };
      list.push(slot);
      return () => {
        slot.active = false;
      };
    },
    subscribe(events, handler, options) {
      requireSetup(state, "subscribe");
      const sample = options?.sample ?? "every";
      const names = subscribedNames(
        events,
        env.declaredHooks.get(state.id) ?? [],
        state.id,
        sample,
      );
      return subscribeWith({
        names,
        handler,
        sampleOf: (name) => (sample === "coalesce" && isHighFrequency(name) ? "coalesce" : "every"),
        register: (name, fn) => api.on(name, fn),
        track: (task) =>
          detach(task, (cause) =>
            env.report(`subscribe task of ${state.id} failed: ${messageOf(cause)}`),
          ),
        dispatchOf: () => childDispatch(env),
      });
    },
    async post(item: PostItem, options: PostOptions): Promise<PostReceipt> {
      const reply = await callEngine(env, state, "post", jsonOf({ item, options }, "the post"));
      return checked(parsePostReceipt(reply), "the post receipt");
    },
    drive(step: DriveStep<AnyState>, options?: DriveOptions): void {
      if (!state.inSetup) {
        throw new PrimitiveError(
          "drive_outside_setup",
          "drive can only be registered inside setup",
          {
            scopeId: state.id,
          },
        );
      }
      if (state.drive !== undefined) {
        throw new PrimitiveError("drive_duplicate", "a registration has one drive slot", {
          scopeId: state.id,
        });
      }
      state.drive = { step, options };
    },
    state(): Readonly<AnyState> {
      return stateAs(currentState(state, env));
    },
    async commit(next: AnyState): Promise<Readonly<AnyState>> {
      requireStateDecl(state);
      const reply = await callEngine(env, state, "commit", jsonOf(next, "the state"));
      return acceptState(state, env, reply);
    },
    async record(kind: RecordKind, subject: RecordSubject, payload: JsonValue): Promise<void> {
      await callEngine(env, state, "record", jsonOf({ kind, subject, payload }, "the record"));
    },
    async readRecords(query: RecordQuery): Promise<readonly GroupRecord[]> {
      const reply = await callEngine(env, state, "readRecords", jsonOf(query, "the query"));
      return checked(parseGroupRecords(reply), "the records");
    },
    async recordPrivate(kind: RecordKind, payload: JsonValue): Promise<void> {
      await callEngine(env, state, "recordPrivate", jsonOf({ kind, payload }, "the record"));
    },
    capability<Api>(key: ServiceKey<Api>): Api {
      return serviceAs(key, capabilityProxy(state, env, key));
    },
    onDispose(fn) {
      state.disposers.push(fn);
    },
  };
  return api;
}

function makeHost(state: RegState, env: ChildEnv): RegistrationHostApi<AnyState> {
  return {
    scopeId: state.id,
    extension: env.extension,
    provide() {
      unsupported(state, "provide");
    },
    providePort() {
      unsupported(state, "providePort");
    },
    port<Api>(_key: PortKey<Api>): Api {
      throw new PrimitiveError(
        "service_reserved",
        `${state.id} is not built in, so it cannot read fresnel.* ports in an isolated host`,
        { scopeId: state.id },
      );
    },
    settingValue(key: string): unknown {
      if (!key.startsWith(`ext.${env.extension}.`)) return undefined;
      const scope = env.scopes.getStore();
      return (scope?.settings ?? env.initSettings)[key];
    },
    migrateState(fn: StateMigration): void {
      if (!state.inSetup) {
        throw new PrimitiveError(
          "state_migration_outside_setup",
          "migrateState can only be registered inside setup",
          { scopeId: state.id },
        );
      }
      // 엔진 안(`host-api.ts`)과 같은 순서와 코드로 검사한다
      if (state.stateDecl === undefined) {
        throw new PrimitiveError("state_undeclared", `scope ${state.id} has no state`, {
          scopeId: state.id,
        });
      }
      if (state.migration !== undefined) {
        throw new PrimitiveError(
          "state_migration_duplicate",
          "migrateState can be registered once per scope",
          { scopeId: state.id },
        );
      }
      state.migration = fn;
    },
    async requestEffect(request: EffectRequest): Promise<void> {
      await callEngine(env, state, "requestEffect", jsonOf(request, "the effect request"));
    },
    async startDrive(input?: JsonValue): Promise<Result<void, RegistrationStartDriveError>> {
      // 문맥(thread)은 호출을 낳은 엔진 요청이다. 요청 밖(설치, 알림)은 엔진도 문맥을 주지 못해 `no_context`로 답하므로
      // 왕복하지 않는다. 설치 중에는 엔진이 이 등록의 g를 아직 모르므로 왕복하면 설치가 실패한다
      if ((env.scopes.getStore()?.requestId ?? null) === null) return err({ kind: "no_context" });
      const reply = await callEngine(env, state, "startDrive", {
        input: optionalJson(input, "the start input"),
      });
      const checkedReply = checked(parseStartDriveReply(reply), "the start reply");
      return checkedReply.ok ? ok(undefined) : err(checkedReply.error);
    },
    callContext(): RegistrationCallContext | undefined {
      const scope = env.scopes.getStore();
      if (scope === undefined || scope.registration !== state.id || scope.threadId === null) {
        return undefined;
      }
      if (scope.kind === "drive") {
        return { kind: "drive", threadId: scope.threadId, signal: scope.signal };
      }
      if (scope.kind !== "hook" && scope.kind !== "notify") return undefined;
      if (scope.point === null) return undefined;
      return { kind: "on", threadId: scope.threadId, signal: scope.signal, point: scope.point };
    },
    async commitWith(next: AnyState, records: readonly RecordInput[]): Promise<Readonly<AnyState>> {
      requireStateDecl(state);
      const reply = await callEngine(
        env,
        state,
        "commitWith",
        jsonOf({ next, records }, "the commit"),
      );
      return acceptState(state, env, reply);
    },
    updateState(fn, records) {
      return updateStateOf(state, env, fn, records);
    },
    registerTool(def: ToolResourceDef): void {
      requireSetup(state, "registerTool");
      addUnique(state, state.tools, "tool", def.name, def);
    },
    registerCommand(name: string, def: CommandResourceDef): void {
      requireSetup(state, "registerCommand");
      addUnique(state, state.commands, "command", name, def);
    },
    registerShortcut() {
      unsupported(state, "registerShortcut");
    },
    registerFlag(name: string, def: FlagResourceDef): void {
      requireSetup(state, "registerFlag");
      addUnique(state, state.flags, "flag", name, def);
    },
    getFlag(name: string): boolean | string | undefined {
      return state.flags.get(name)?.default;
    },
    registerProvider(name: string, config: ProviderResourceDef): void {
      requireSetup(state, "registerProvider");
      addUnique(state, state.providers, "provider", name, jsonOf(config, "the provider config"));
    },
    registerMcpServer(name: string, config: JsonValue): void {
      requireSetup(state, "registerMcpServer");
      addUnique(state, state.mcpServers, "mcp server", name, jsonOf(config, "the mcp config"));
    },
    registerMessageRenderer(customType: RecordKind, renderer: RendererResourceDef): void {
      requireSetup(state, "registerMessageRenderer");
      addUnique(state, state.renderers, "message renderer", customType, renderer);
    },
    registerWebProvider() {
      unsupported(state, "registerWebProvider");
    },
    registerMethod(verb: string, def: ExtMethodResourceDef): void {
      requireSetup(state, "registerMethod");
      addUnique(state, state.methods, "method", verb, def);
    },
    async awaitUser<T>(
      wait: (signal: AbortSignal) => Promise<T>,
      options?: { readonly signal?: AbortSignal },
    ): Promise<T> {
      // 요청 문맥의 취소 신호(요청 취소, 시간 초과, 종료)와 호출자의 신호를 합친다. 문맥이 없으면 수명 신호다
      const base = env.scopes.getStore()?.signal ?? env.lifetime;
      const extra = options?.signal;
      const signal = extra === undefined ? base : AbortSignal.any([base, extra]);
      // 엔진은 `begin`에 요청의 시간 예산 시계를 멈추고, `end`에 다시 돌린다. 끝 신호가 실패해도 결과를 가리지 않는다
      await callEngine(env, state, "awaitUser", { phase: "begin" });
      try {
        return await wait(signal);
      } finally {
        const ended = await attemptAsync(() =>
          callEngine(env, state, "awaitUser", { phase: "end" }),
        );
        if (!ended.ok) {
          env.report(`awaitUser end of ${state.id} failed: ${messageOf(ended.error.cause)}`);
        }
      }
    },
  };
}

/** 자식 쪽 등록 하나를 만든다. g와 hostOf(g)의 부가 API를 묶는다 */
export function createChildRegistration(
  id: RegistrationId,
  def: RegistrationDef<AnyState>,
  setup: RegistrationSetup<AnyState>,
  env: ChildEnv,
): ChildRegistration {
  const state: RegState = {
    id,
    stateDecl: def.state,
    defaultEnabled: def.defaultEnabled,
    inSetup: false,
    lastState: def.state?.initial,
    slots: new Map<HookName, HandlerSlot[]>(),
    tools: new Map<string, ToolResourceDef>(),
    commands: new Map<string, CommandResourceDef>(),
    methods: new Map<string, ExtMethodResourceDef>(),
    flags: new Map<string, FlagResourceDef>(),
    providers: new Map<string, ProviderResourceDef>(),
    mcpServers: new Map<string, JsonValue>(),
    renderers: new Map<string, RendererResourceDef>(),
    disposers: [],
    unsupported: [],
    migration: undefined,
    drive: undefined,
    updateTails: new Map<string, Promise<void>>(),
  };
  const api = makeApi(state, env);
  bindHostApiForIsolation(api, makeHost(state, env));
  return { state, setup, api };
}

/** 도구 선언. `execute`를 뺀 ToolResourceDef를 JSON으로 만든다. 빠진 선택 필드는 키를 두지 않는다 */
function toolJson(def: ToolResourceDef): JsonValue | undefined {
  return toJsonValue({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    replay: def.replay,
    ...(def.exposure === undefined ? {} : { exposure: def.exposure }),
    ...(def.risk === undefined ? {} : { risk: def.risk }),
    ...(def.hints === undefined ? {} : { hints: def.hints }),
    ...(def.replaces === undefined ? {} : { replaces: def.replaces }),
  });
}

function flagJson(def: FlagResourceDef): JsonValue | undefined {
  return toJsonValue({
    type: def.type,
    ...(def.description === undefined ? {} : { description: def.description }),
    ...(def.default === undefined ? {} : { default: def.default }),
  });
}

/** 등록 하나의 선언. host.init 응답에 실린다. JSON이 아닌 값이 있으면 오류 값이다 */
export function declOf(state: RegState): Result<PluginRegistrationDecl, PluginHostError> {
  const notJson = (what: string): PluginHostError => ({
    kind: "handler_threw",
    message: `${what} of ${state.id} is not JSON`,
  });
  let stateDecl: PluginRegistrationDecl["state"] = null;
  if (state.stateDecl !== undefined) {
    const schema = toJsonValue(state.stateDecl.schema);
    const initial = toJsonValue(state.stateDecl.initial);
    if (schema === undefined || initial === undefined) return err(notJson("state"));
    stateDecl = { schema, initial, version: state.stateDecl.version };
  }
  const hooks: { point: string; handlerIndex: number }[] = [];
  for (const [point, list] of state.slots) {
    for (const slot of list) {
      if (slot.active) hooks.push({ point, handlerIndex: slot.handlerIndex });
    }
  }
  const tools: PluginToolDecl[] = [];
  for (const def of state.tools.values()) {
    const json = toolJson(def);
    if (json === undefined) return err(notJson(`tool ${def.name}`));
    tools.push({ name: def.name, def: json });
  }
  const flags: { name: string; def: JsonValue }[] = [];
  for (const [name, def] of state.flags) {
    const json = flagJson(def);
    if (json === undefined) return err(notJson(`flag ${name}`));
    flags.push({ name, def: json });
  }
  const commands: { name: string; description: string | null }[] = [];
  for (const [name, def] of state.commands) {
    commands.push({ name, description: def.description ?? null });
  }
  const renderers: { customType: string; module: string; export: string }[] = [];
  for (const [customType, def] of state.renderers) {
    renderers.push({ customType, module: def.module, export: def.export });
  }
  return ok({
    id: state.id,
    defaultEnabled: state.defaultEnabled ?? null,
    state: stateDecl,
    hooks,
    tools,
    commands,
    methods: [...state.methods.keys()].map((verb) => ({ verb })),
    flags,
    providers: [...state.providers].map(([name, config]) => ({ name, config })),
    mcpServers: [...state.mcpServers].map(([name, config]) => ({ name, config })),
    renderers,
    hasDisposers: state.disposers.length > 0,
    hasMigration: state.migration !== undefined,
    drive: state.drive === undefined ? null : { limits: state.drive.options?.limits ?? null },
  });
}
