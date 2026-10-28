import type { ServiceKey } from "@xeon/contracts/capabilities";
import { Bug, ok, type Result } from "@xeon/contracts";
import type { JsonValue } from "@xeon/contracts/conversation";
import type {
  DriveOptions,
  ExtensionName,
  McpServerResourceDef,
  ProviderResourceDef,
  ToolResourceDef,
  Handler,
  PointName,
  PortKey,
  PostItem,
  PostOptions,
  RecordKind,
  RecordQuery,
  RecordSubject,
  ScopeApi,
  ScopeId,
  Unsubscribe,
} from "@xeon/contracts/extensions";
import {
  eraseDrive,
  eraseHandler,
  restoreAs,
  serviceAs,
  stateAs,
  type TypeWitness,
} from "../erase.ts";
import type { CapabilityBindings } from "./bindings.ts";
import {
  EFFECT_KEY_MAX,
  effectKindOf,
  type EffectRequest,
  type EffectWorkerPort,
} from "./effect-worker.ts";
import { guardCapabilityService, type CapabilityDefLookup } from "./capability-guard.ts";
import type { Generation, HostCore, ScopeRecord } from "./core.ts";
import type { AnyState } from "./erased-types.ts";
import { PrimitiveError } from "./errors.ts";
import { createPortProvider } from "./port-provider.ts";
import type { PostQueue } from "./post.ts";
import type { HandlerEntry } from "./registry.ts";
import { capabilityServiceName, providerServiceName } from "./services.ts";
import { ambient } from "./ambient.ts";
import type {
  CommandResourceDef,
  FlagResourceDef,
  RendererResourceDef,
  ResourceKind,
  ResourceSpec,
  ResourceStore,
  ShortcutResourceDef,
} from "./resources.ts";
import type { StateMigration } from "./state-migration.ts";
import { awaitUser } from "./user-wait.ts";
import type { RecordInput, StateService, StateUpdateError } from "./state.ts";

export type { StateMigration } from "./state-migration.ts";

/** setup이 받은 g에 붙는 부가 API(X.primitives.spec §3.8) */
export interface ScopeHostApi<S = unknown> {
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  /** 능력 공급자 등록. key.capability는 매니페스트 provides에 있어야 한다. fiber effect로 추적한다 */
  provide<Api>(key: ServiceKey<Api>, impl: Api): void;
  /** 포트 제공. builtin 확장만 */
  providePort<Api>(key: PortKey<Api>, impl: Api): void;
  /** 포트 조회. builtin 확장만. 없으면 port_unavailable */
  port<Api>(key: PortKey<Api>): Api;
  /**
   * 상태 문서 마이그레이션. setup 안에서 한 번만 부른다. 저장된 상태의 `version`이 `StateDecl.version`보다 낮은 thread를 켤 때
   * 이 함수로 옮기고 스키마를 검사한 뒤 새 판으로 커밋한다(P-23)
   */
  migrateState(fn: StateMigration): void;
  /**
   * 상태 커밋과 그룹 레코드를 한 트랜잭션으로 낸다(M3-REQ-24 [제안]). 레코드 kind는 `record`와 같은 검사를 받는다.
   * F `ScopeApi.commit`에는 둘째 인자가 없어 이 메서드를 둔다. 상태가 충돌하면 레코드도 남지 않는다
   */
  /**
   * 선언 없는 쓰기 요청(ADR-0015 §3.5, M3-REQ-27 [제안]). 요청 레코드를 커밋하고 효과 워커가 재실행되지 않는 문맥에서 실행한다.
   * 재실행돼도 같은 `key`라 요청은 한 번만 남는다. 결과는 `<kind 접두>effect.settled` 레코드로 `readRecords`에서 읽는다.
   * 능력은 매니페스트 requires나 optional에 있어야 한다
   */
  requestEffect(request: EffectRequest): Promise<void>;
  commitWith(next: S, records: readonly RecordInput[]): Promise<Readonly<S>>;
  /**
   * 줄 세운 읽기-계산-커밋(M3-REQ-23 [제안]). 같은 (thread, scope)의 `commit`·`updateState`는 호출 순서대로 하나씩 실행된다.
   * fn은 줄 안에서 최신 상태로 불리고, 저장소의 판 충돌은 한 번 다시 시도한 뒤 `state_conflict` 값으로 돌려준다. 던지지 않는다.
   * `records`가 있으면 계산된 상태와 같은 트랜잭션에 실린다
   */
  updateState(
    fn: (prev: Readonly<S>) => S,
    records?: (next: S) => readonly RecordInput[],
  ): Promise<Result<Readonly<S>, StateUpdateError>>;
  // 리소스 등록(X.primitives.spec §4.8). 모두 fiber effect로 추적되어 scope가 꺼지면 자동 해제된다.
  // 이름 충돌은 resource_conflict, 이름 형식 위반은 resource_name_invalid, 대상 포트가 없으면 port_unavailable이다
  registerTool(def: ToolResourceDef): void;
  registerCommand(name: string, def: CommandResourceDef): void;
  registerShortcut(key: string, def: ShortcutResourceDef): void;
  registerFlag(name: string, def: FlagResourceDef): void;
  /** 이 scope가 등록한 flag의 현재 값. L4가 정한 값이 없으면 선언의 기본값, 선언이 없으면 undefined */
  getFlag(name: string): boolean | string | undefined;
  registerProvider(name: string, config: ProviderResourceDef): void;
  registerMcpServer(name: string, config: McpServerResourceDef): void;
  registerMessageRenderer(customType: RecordKind, renderer: RendererResourceDef): void;
  /**
   * 사용자 응답(대화상자, 승인) 대기를 감싼다. 핸들러 안에서 부르면 wait 동안 핸들러 시간 예산 시계를 멈추고,
   * wait에는 핸들러의 취소 신호(예산 초과, 세션 종료로 abort)를 `options.signal`과 합쳐 넘긴다.
   * 핸들러 밖(drive 함수, setup)에서는 예산이 없으므로 그대로 실행한다(O-07, X.operations.spec §4.2.3)
   */
  awaitUser<T>(
    wait: (signal: AbortSignal) => Promise<T>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<T>;
}

/** 같은 패키지의 operations가 쓰는 g의 내부 정보 */
export interface ScopeInternals {
  readonly core: HostCore;
  readonly record: ScopeRecord;
  readonly generation: Generation;
}

const hostApis = new WeakMap<object, ScopeHostApi<AnyState>>();
const internals = new WeakMap<object, ScopeInternals>();

/** setup이 받은 g로 부가 API를 얻는다. ext-host가 만든 g가 아니면 PrimitiveError("no_context") */
export function hostOf<S>(g: ScopeApi<S>): ScopeHostApi<S> {
  const found = hostApis.get(g);
  if (found === undefined) {
    throw new PrimitiveError("no_context", "hostOf needs a ScopeApi created by ext-host");
  }
  const witness: TypeWitness<ScopeHostApi<S>> = {};
  return restoreAs(witness, found);
}

/** 패키지 안에서만 쓴다. ext-host가 만든 g의 호스트 핵심과 scope 기록 */
export function scopeInternalsOf<S>(g: ScopeApi<S>): ScopeInternals {
  const found = internals.get(g);
  if (found === undefined) {
    throw new PrimitiveError("no_context", "scopeInternalsOf needs a ScopeApi created by ext-host");
  }
  return found;
}

export interface ScopeApiDeps {
  readonly core: HostCore;
  readonly state: StateService;
  readonly post: PostQueue;
  readonly bindings: CapabilityBindings;
  readonly resources: ResourceStore;
  readonly capabilityDefs: CapabilityDefLookup;
  readonly effects: EffectWorkerPort;
}

function assertOpen(record: ScopeRecord, generation: Generation): void {
  if (generation.closed) {
    throw new PrimitiveError("scope_inactive", `scope ${record.id} generation is closed`, {
      scopeId: record.id,
    });
  }
}

function fiberOf(generation: Generation): NonNullable<Generation["fiber"]> {
  if (generation.fiber === null) throw new Bug("scope.api_without_fiber");
  return generation.fiber;
}

export function createScopeApi(
  deps: ScopeApiDeps,
  record: ScopeRecord,
  generation: Generation,
): ScopeApi<AnyState> {
  const { core } = deps;
  const manifest = record.manifest;

  function requirePortAccess(): void {
    if (!record.builtin) {
      throw new PrimitiveError(
        "service_reserved",
        `${record.extension} is not built in, so it cannot provide or read xeon.* ports`,
        { scopeId: record.id },
      );
    }
  }

  const api: ScopeApi<AnyState> = {
    id: record.id,
    on<N extends PointName>(point: N, handler: Handler<N>): Unsubscribe {
      assertOpen(record, generation);
      if (!manifest.points.includes(point)) {
        throw new PrimitiveError(
          "point_undeclared",
          `on("${point}") is not listed in the manifest points of ${record.extension}`,
          { scopeId: record.id },
        );
      }
      generation.usage.on.add(point);
      const entry: HandlerEntry = {
        point,
        scopeId: record.id,
        extension: record.extension,
        layer: manifest.layer,
        builtin: record.builtin,
        loadIndex: record.loadIndex,
        seq: core.registry.nextSeq(),
        fn: eraseHandler(handler),
        isOpen: (threadId) => generation.open && core.activeIn(threadId, record.id),
        signal: generation.abort.signal,
      };
      return fiberOf(generation).effect(() => core.registry.add(entry), `on(${point})`);
    },
    post(item: PostItem, options: PostOptions) {
      return deps.post.post(record, generation, item, options);
    },
    drive(fn, options?: DriveOptions) {
      assertOpen(record, generation);
      if (!generation.setupPhase) {
        throw new PrimitiveError(
          "drive_outside_setup",
          "drive can only be registered inside setup",
          {
            scopeId: record.id,
          },
        );
      }
      if (manifest.kind !== "group") {
        throw new PrimitiveError("drive_requires_group", "only a group may register drive", {
          scopeId: record.id,
        });
      }
      if (!manifest.usesDrive) {
        throw new PrimitiveError("drive_undeclared", "drive was used but usesDrive is not true", {
          scopeId: record.id,
        });
      }
      if (generation.drive !== null) {
        throw new PrimitiveError("drive_duplicate", "a group has one drive slot", {
          scopeId: record.id,
        });
      }
      generation.usage.drive = true;
      const registration = { fn: eraseDrive(fn), options: options ?? {} };
      generation.drive = registration;
      fiberOf(generation).effect(
        () => () => {
          if (generation.drive === registration) generation.drive = null;
        },
        "drive",
      );
    },
    state() {
      return stateAs(deps.state.state(record, generation));
    },
    async commit(next) {
      return stateAs(await deps.state.commit(record, generation, next));
    },
    record(kind: RecordKind, subject: RecordSubject, payload: JsonValue) {
      return deps.state.record(record, generation, kind, subject, payload);
    },
    readRecords(query: RecordQuery) {
      return deps.state.readRecords(record, generation, query);
    },
    recordPrivate(kind: RecordKind, payload: JsonValue) {
      return deps.state.recordPrivate(record, generation, kind, payload);
    },
    capability<Api>(key: ServiceKey<Api>): Api {
      assertOpen(record, generation);
      const id = key.capability;
      const declared =
        (manifest.requires ?? []).some((entry) => entry.id === id) ||
        (manifest.optional ?? []).some((entry) => entry.id === id);
      if (!declared) {
        throw new PrimitiveError(
          "capability_undeclared",
          `capability("${id}") is not in requires or optional`,
          { scopeId: record.id },
        );
      }
      generation.usage.capabilities.add(id);
      const service = core.bridge.service(capabilityServiceName(id));
      if (service === undefined) {
        throw new PrimitiveError(
          "capability_unavailable",
          `capability ${id} has no active provider`,
          {
            scopeId: record.id,
          },
        );
      }
      return serviceAs(
        key,
        guardCapabilityService({
          id,
          service,
          defs: deps.capabilityDefs,
          extension: record.extension,
          scopeId: record.id,
        }),
      );
    },
    onDispose(fn) {
      assertOpen(record, generation);
      generation.disposers.push(fn);
    },
  };

  const host: ScopeHostApi<AnyState> = {
    scopeId: record.id,
    extension: record.extension,
    provide<Api>(key: ServiceKey<Api>, impl: Api): void {
      assertOpen(record, generation);
      const id = key.capability;
      const provision = (manifest.provides ?? []).find((entry) => entry.id === id);
      if (provision === undefined) {
        throw new PrimitiveError(
          "capability_undeclared",
          `${record.extension} provides ${id} without declaring it in the manifest`,
          { scopeId: record.id },
        );
      }
      const name = providerServiceName(id, record.extension);
      const fiber = fiberOf(generation);
      fiber.provide(name, impl);
      fiber.effect(
        () => deps.bindings.addProvider(id, record.extension, provision.version, key.version),
        `provider(${id})`,
      );
    },
    migrateState(fn: StateMigration): void {
      assertOpen(record, generation);
      if (!generation.setupPhase) {
        throw new PrimitiveError(
          "state_migration_outside_setup",
          "migrateState can only be registered inside setup",
          { scopeId: record.id },
        );
      }
      if (record.def.state === undefined) {
        throw new PrimitiveError("state_undeclared", `scope ${record.id} has no state`, {
          scopeId: record.id,
        });
      }
      if (generation.migration !== null) {
        throw new PrimitiveError(
          "state_migration_duplicate",
          "migrateState can be registered once per scope",
          { scopeId: record.id },
        );
      }
      generation.migration = fn;
    },
    async requestEffect(request) {
      assertOpen(record, generation);
      const declared =
        (manifest.requires ?? []).some((entry) => entry.id === request.capability) ||
        (manifest.optional ?? []).some((entry) => entry.id === request.capability);
      if (!declared) {
        throw new PrimitiveError(
          "capability_undeclared",
          `requestEffect on ${request.capability} is not in requires or optional`,
          { scopeId: record.id },
        );
      }
      if (request.key.length < 1 || request.key.length > EFFECT_KEY_MAX) {
        throw new TypeError(`effect key must be 1-${EFFECT_KEY_MAX} chars`);
      }
      generation.usage.capabilities.add(request.capability);
      await deps.state.recordPrivate(record, generation, effectKindOf(manifest, "requested"), {
        scopeId: record.id,
        key: request.key,
        capability: request.capability,
        method: request.method,
        input: request.input,
      });
      const threadId = ambient()?.threadId;
      if (threadId !== undefined) {
        deps.effects.schedule({
          threadId,
          scopeId: record.id,
          extension: record.extension,
          kind: manifest.kind === "group" ? "group" : "plugin",
        });
      }
    },
    async commitWith(next, records) {
      return stateAs(await deps.state.commitWith(record, generation, next, records));
    },
    async updateState(fn, records) {
      const done = await deps.state.update(
        record,
        generation,
        (prev) => fn(stateAs(prev)),
        (next) => records?.(stateAs(next)) ?? [],
      );
      return done.ok ? ok(stateAs(done.value)) : done;
    },
    registerTool(def: ToolResourceDef): void {
      register("tool", def.name, def);
    },
    registerCommand(name: string, def: CommandResourceDef): void {
      register("command", name, def);
    },
    registerShortcut(key: string, def: ShortcutResourceDef): void {
      register("shortcut", key, def);
    },
    registerFlag(name: string, def: FlagResourceDef): void {
      register("flag", name, def);
    },
    getFlag(name: string): boolean | string | undefined {
      assertOpen(record, generation);
      return deps.resources.flagValue(record.id, name);
    },
    registerProvider(name: string, config: ProviderResourceDef): void {
      register("provider", name, config);
    },
    registerMcpServer(name: string, config: McpServerResourceDef): void {
      register("mcp_server", name, config);
    },
    registerMessageRenderer(customType: RecordKind, renderer: RendererResourceDef): void {
      register("message_renderer", customType, renderer);
    },
    awaitUser<T>(
      wait: (signal: AbortSignal) => Promise<T>,
      options?: { readonly signal?: AbortSignal },
    ): Promise<T> {
      assertOpen(record, generation);
      const handler = ambient()?.handler ?? null;
      const extra = options?.signal;
      if (handler === null) {
        return wait(extra ?? generation.abort.signal);
      }
      const signal =
        extra === undefined ? handler.signal : AbortSignal.any([handler.signal, extra]);
      return awaitUser(handler.gate, () => wait(signal));
    },
    providePort<Api>(key: PortKey<Api>, impl: Api): void {
      assertOpen(record, generation);
      requirePortAccess();
      portProvider().provide(key, impl);
    },
    port<Api>(key: PortKey<Api>): Api {
      assertOpen(record, generation);
      requirePortAccess();
      const port = core.ports.get(key);
      if (port === undefined) {
        throw new PrimitiveError("port_unavailable", `port ${key.name} is not provided`, {
          scopeId: record.id,
        });
      }
      return port;
    },
  };

  /** 리소스를 등록하고 해제를 이 세대의 fiber effect로 묶는다. 실패는 PrimitiveError로 던진다 */
  function register(kind: ResourceKind, name: string, def: unknown): void {
    assertOpen(record, generation);
    const spec: ResourceSpec = {
      kind,
      name,
      scopeId: record.id,
      extension: record.extension,
      builtin: record.builtin,
      def,
    };
    const added = deps.resources.add(spec);
    if (!added.ok) throw added.error;
    const release = added.value;
    fiberOf(generation).effect(() => release, `resource(${kind}:${name})`);
  }

  let provider: ReturnType<typeof createPortProvider> | undefined;
  function portProvider(): ReturnType<typeof createPortProvider> {
    provider ??= createPortProvider(fiberOf(generation));
    return provider;
  }

  hostApis.set(api, host);
  internals.set(api, { core, record, generation });
  return api;
}
