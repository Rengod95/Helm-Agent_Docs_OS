import { ok } from "@xeon/contracts";
import type { McpServerDef } from "@xeon/contracts/capabilities";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { McpServersChangePayload } from "@xeon/contracts/extensions";
import type { PolicyRule } from "@xeon/contracts/services";
import { createMcp, type McpDeps, type McpRuntime } from "../../src/client/service.ts";
import type { McpDynamicTool } from "../../src/client/dynamic-tools.ts";
import type { McpFileReader } from "../../src/ports/files.ts";
import type { McpMasker } from "../../src/ports/secrets.ts";
import type { McpRegisterError, McpToolRegistrar } from "../../src/ports/tools.ts";
import type { McpProjectTrust } from "../../src/ports/trust.ts";
import type { McpSettingsSource } from "../../src/settings.ts";
import {
  createStubServer,
  type StubServer,
  type StubServerOptions,
} from "../../src/testing/stub-server.ts";
import type { OpenedTransport, TransportFactory } from "../../src/transport/factory.ts";
import { captureLogger } from "./logger.ts";
import { layer } from "./layers.ts";
import { fixedClock, manualScheduler, type FakeClock, type ManualScheduler } from "./time.ts";

/** 알려진 비밀 문자열을 가리는 마스커 */
export function maskerFor(secrets: readonly string[]): McpMasker {
  return {
    mask: (text) => secrets.reduce((acc, secret) => acc.split(secret).join("[REDACTED]"), text),
  };
}

function settingsSource(initial: ScopeStack): McpSettingsSource & { set(next: ScopeStack): void } {
  let current = initial;
  return {
    layers: () => current,
    set(next) {
      current = next;
    },
  };
}

export function fakeFiles(files: Readonly<Record<string, string>>): McpFileReader & {
  readonly reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    readText(path) {
      reads.push(path);
      return Promise.resolve(files[path] ?? null);
    },
    exists: (path) => Promise.resolve(files[path] !== undefined),
  };
}

export function fakeTrust(trusted: boolean): McpProjectTrust & { calls: number } {
  const trust = {
    calls: 0,
    isTrusted() {
      trust.calls += 1;
      return Promise.resolve(trusted);
    },
  };
  return trust;
}

interface StubFactory extends TransportFactory {
  readonly opens: string[];
  /** 다음 `n`번의 open을 이 이유로 실패시킨다 */
  failNext(count: number, message?: string): void;
}

/** 서버 id마다 스텁 서버를 연결하는 전송 공장 */
function stubFactory(servers: Readonly<Record<string, StubServer>>): StubFactory {
  const opens: string[] = [];
  let failures = 0;
  let failureMessage = "connection refused";
  return {
    opens,
    failNext(count, message) {
      failures = count;
      if (message !== undefined) failureMessage = message;
    },
    open(server) {
      opens.push(server.id);
      if (failures > 0) {
        failures -= 1;
        return Promise.resolve({
          ok: false,
          error: { code: "spawn_failed", message: failureMessage },
        });
      }
      const stub = servers[server.id];
      if (stub === undefined) {
        return Promise.resolve({ ok: false, error: { code: "unsupported", message: "no stub" } });
      }
      const opened: OpenedTransport = { transport: stub.connect(), stderrTail: () => [] };
      return Promise.resolve(ok(opened));
    },
  };
}

interface FakeRegistrar extends McpToolRegistrar {
  readonly registered: McpDynamicTool[];
  readonly unregistered: string[];
  /** 이 이름의 등록을 충돌로 거부한다 */
  reject(name: string): void;
  names(): string[];
}

function fakeRegistrar(): FakeRegistrar {
  const registered: McpDynamicTool[] = [];
  const unregistered: string[] = [];
  const rejected = new Set<string>();
  const live = new Map<string, McpDynamicTool>();
  return {
    registered,
    unregistered,
    reject: (name) => rejected.add(name),
    names: () => [...live.keys()].toSorted(),
    register(tool) {
      if (rejected.has(tool.wire.name) || live.has(tool.wire.name)) {
        const error: McpRegisterError = { kind: "name_conflict", toolName: tool.wire.name };
        return { ok: false, error };
      }
      registered.push(tool);
      live.set(tool.wire.name, tool);
      return ok(() => {
        live.delete(tool.wire.name);
        unregistered.push(tool.wire.name);
      });
    },
  };
}

export interface World {
  readonly runtime: McpRuntime;
  readonly stubs: Readonly<Record<string, StubServer>>;
  readonly factory: StubFactory;
  readonly clock: FakeClock;
  readonly scheduler: ManualScheduler;
  readonly registrar: FakeRegistrar;
  readonly logger: ReturnType<typeof captureLogger>;
  readonly settings: ReturnType<typeof settingsSource>;
  readonly changes: McpServersChangePayload[];
  readonly rules: PolicyRule[][];
  readonly controller: AbortController;
}

export interface WorldOptions {
  /** 서버 id → 정의와 스텁 옵션 */
  readonly servers: Readonly<
    Record<string, { def?: Partial<McpServerDef>; stub: StubServerOptions }>
  >;
  /** 사용자 범위에 더 넣을 설정 값(`l2.mcp.` 접두 없이) */
  readonly user?: Readonly<Record<string, unknown>>;
  readonly layers?: ScopeStack;
  readonly reserved?: readonly string[];
  readonly secrets?: readonly string[];
  readonly overrides?: Partial<McpDeps>;
  /** 스텁 서버가 만들어진 뒤에 전송 공장을 정한다(기본은 서버 id마다 인메모리 스텁) */
  readonly transportsFor?: (stubs: Readonly<Record<string, StubServer>>) => TransportFactory;
}

function stdioDef(extra?: Partial<McpServerDef>): McpServerDef {
  return { transport: { type: "stdio", command: "stub-server" }, ...extra };
}

/** 설정에 서버를 넣고 스텁 서버에 연결하는 실행 환경을 만든다. `load`는 부르지 않는다 */
export function buildWorld(options: WorldOptions): World {
  const stubs: Record<string, StubServer> = {};
  const defs: Record<string, McpServerDef> = {};
  for (const [id, spec] of Object.entries(options.servers)) {
    stubs[id] = createStubServer(spec.stub);
    defs[id] = stdioDef(spec.def);
  }
  const userValues: Record<string, unknown> = { "l2.mcp.servers": defs };
  for (const [key, value] of Object.entries(options.user ?? {}))
    userValues[`l2.mcp.${key}`] = value;
  const settings = settingsSource([layer("user", userValues), ...(options.layers ?? [])]);
  const clock = fixedClock();
  const scheduler = manualScheduler(clock);
  const registrar = fakeRegistrar();
  const logger = captureLogger();
  const factory = stubFactory(stubs);
  const changes: McpServersChangePayload[] = [];
  const rules: PolicyRule[][] = [];
  const runtime = createMcp({
    clock,
    scheduler,
    logger,
    masker: maskerFor(options.secrets ?? []),
    settings,
    projectRoot: undefined,
    files: fakeFiles({}),
    trust: fakeTrust(true),
    transports: options.transportsFor?.(stubs) ?? factory,
    tools: registrar,
    continuations: undefined,
    rules: {
      set: (next) => {
        rules.push([...next]);
      },
    },
    store: undefined,
    reservedToolNames: () => new Set(options.reserved ?? []),
    onServersChange: (payload) => {
      changes.push(payload);
    },
    client: { name: "xeon-test", version: "0.0.0" },
    stdioGraceMs: 10,
    ...options.overrides,
  });
  return {
    runtime,
    stubs,
    factory,
    clock,
    scheduler,
    registrar,
    logger,
    settings,
    changes,
    rules,
    controller: new AbortController(),
  };
}

/** 로드하고 연결이 끝나기를 기다린다 */
export async function startWorld(world: World): Promise<void> {
  await world.runtime.load(world.controller.signal);
  await world.runtime.settled();
}
