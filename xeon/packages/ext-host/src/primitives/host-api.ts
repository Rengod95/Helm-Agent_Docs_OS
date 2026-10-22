import type { ServiceKey } from "@xeon/contracts/capabilities";
import { Bug } from "@xeon/contracts";
import type { JsonValue } from "@xeon/contracts/conversation";
import type {
  DriveOptions,
  ExtensionName,
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
import { eraseDrive, eraseHandler, serviceAs, stateAs } from "../erase.ts";
import type { CapabilityBindings } from "./bindings.ts";
import type { Generation, HostCore, ScopeRecord } from "./core.ts";
import type { AnyState } from "./erased-types.ts";
import { PrimitiveError } from "./errors.ts";
import { createPortProvider } from "./port-provider.ts";
import type { PostQueue } from "./post.ts";
import type { HandlerEntry } from "./registry.ts";
import { capabilityServiceName, providerServiceName } from "./services.ts";
import type { StateService } from "./state.ts";

/** setup이 받은 g에 붙는 부가 API(X.primitives.spec §3.8). M2 항목(리소스 등록, migrateState)은 아직 없다 */
export interface ScopeHostApi {
  readonly scopeId: ScopeId;
  readonly extension: ExtensionName;
  /** 능력 공급자 등록. key.capability는 매니페스트 provides에 있어야 한다. fiber effect로 추적한다 */
  provide<Api>(key: ServiceKey<Api>, impl: Api): void;
  /** 포트 제공. builtin 확장만 */
  providePort<Api>(key: PortKey<Api>, impl: Api): void;
  /** 포트 조회. builtin 확장만. 없으면 port_unavailable */
  port<Api>(key: PortKey<Api>): Api;
}

/** 같은 패키지의 operations가 쓰는 g의 내부 정보 */
export interface ScopeInternals {
  readonly core: HostCore;
  readonly record: ScopeRecord;
  readonly generation: Generation;
}

const hostApis = new WeakMap<object, ScopeHostApi>();
const internals = new WeakMap<object, ScopeInternals>();

/** setup이 받은 g로 부가 API를 얻는다. ext-host가 만든 g가 아니면 PrimitiveError("no_context") */
export function hostOf<S>(g: ScopeApi<S>): ScopeHostApi {
  const found = hostApis.get(g);
  if (found === undefined) {
    throw new PrimitiveError("no_context", "hostOf needs a ScopeApi created by ext-host");
  }
  return found;
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
        isOpen: () => generation.open,
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
      return serviceAs(key, service);
    },
    onDispose(fn) {
      assertOpen(record, generation);
      generation.disposers.push(fn);
    },
  };

  const host: ScopeHostApi = {
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

  let provider: ReturnType<typeof createPortProvider> | undefined;
  function portProvider(): ReturnType<typeof createPortProvider> {
    provider ??= createPortProvider(fiberOf(generation));
    return provider;
  }

  hostApis.set(api, host);
  internals.set(api, { core, record, generation });
  return api;
}
