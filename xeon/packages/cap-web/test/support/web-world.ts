import type { Logger, LogFields } from "@xeon/contracts";
import type { CallOptions, WebService } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { WebDeps } from "../../src/deps.ts";
import { directConvertRunner, type ConvertRunner } from "../../src/fetch/convert-runner.ts";
import { createWebRuntime, type WebRuntime } from "../../src/runtime.ts";
import { createWebService } from "../../src/service.ts";
import type { HeaderSecretResolver } from "../../src/ports/secrets.ts";
import type {
  WebProviderCatalog,
  FetchCandidate,
  SearchCandidate,
} from "../../src/ports/providers.ts";
import type { RegistrationSource } from "../../src/search/registry.ts";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "../../src/settings.ts";
import {
  fakeAsker,
  fakeSecretGuard,
  fakeSessionSources,
  type FakeAsker,
} from "../../src/testing/fake-ports.ts";
import { fakeResolver, type FakeResolver } from "../../src/testing/fake-resolver.ts";
import {
  fixtureTransport,
  type FixtureRoute,
  type FixtureTransport,
} from "../../src/testing/http-fixtures.ts";
import { manualClock, type ManualClock } from "./clock.ts";
import { fixedLocalIds } from "./ids.ts";
import { openWebStore } from "./store.ts";
import type { TestStore } from "@xeon/platform-store/testing";

export const PUBLIC_IP = "93.184.216.34";

interface LogRecord {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

export interface WebWorldOptions {
  readonly settings?: Partial<{ [K in keyof WebSettings]: Partial<WebSettings[K]> }>;
  readonly hosts?: Readonly<Record<string, readonly string[]>>;
  readonly routes?: Readonly<Record<string, FixtureRoute>>;
  /** 후보 목록을 직접 정한다(레지스트리를 거치지 않는다) */
  readonly catalog?: WebProviderCatalog;
  readonly registrations?: RegistrationSource;
  readonly builtin?: {
    readonly search: readonly SearchCandidate[];
    readonly fetch: readonly FetchCandidate[];
  };
  readonly asker?: FakeAsker;
  readonly headerSecrets?: HeaderSecretResolver;
  readonly extensionSetting?: (extension: string, key: string) => unknown;
  /** 변환 실행기. 기본은 같은 프로세스에서 직접 변환한다 */
  readonly convert?: ConvertRunner;
  /** false면 저장소 없이 조립한다(디스크 캐시와 rawRef가 없는 모드) */
  readonly withStore?: boolean;
  readonly secretValues?: readonly string[];
}

export interface WebWorld {
  readonly deps: WebDeps;
  readonly runtime: WebRuntime;
  readonly clock: ManualClock;
  readonly resolver: FakeResolver;
  readonly transport: FixtureTransport;
  readonly store: TestStore | undefined;
  readonly asker: FakeAsker;
  readonly logs: LogRecord[];
  /** 호출마다 읽는 현재 설정 */
  readonly settings: () => WebSettings;
  /** 설정을 바꾼다. 다음 호출부터 적용된다 */
  setSettings(next: WebSettings): void;
  readonly service: WebService;
  fetch: WebService["fetch"]["fetch"];
  search: WebService["search"]["search"];
  /** 도구 경로 호출 옵션 */
  asModel(threadId: ThreadId, requestId?: string): CallOptions;
}

function recordingLogger(logs: LogRecord[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => {
      logs.push({ level: "debug", event, fields });
    },
    info: (event, fields) => {
      logs.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      logs.push({ level: "warn", event, fields });
    },
    error: (event, fields) => {
      logs.push({ level: "error", event, fields });
    },
    child: () => logger,
  };
  return logger;
}

function mergeSettings(overrides: WebWorldOptions["settings"]): WebSettings {
  const base = DEFAULT_WEB_SETTINGS;
  return {
    search: { ...base.search, ...overrides?.search },
    fetch: { ...base.fetch, ...overrides?.fetch },
    // 기본은 모든 도메인 allow(정책이 아니라 파이프라인을 보려는 시험)
    policy: { ...base.policy, allow: ["*"], ...overrides?.policy },
    cache: { ...base.cache, ...overrides?.cache },
    limits: { ...base.limits, ...overrides?.limits },
  };
}

export async function makeWebWorld(options: WebWorldOptions = {}): Promise<WebWorld> {
  const clock = manualClock();
  const logs: LogRecord[] = [];
  let settings = mergeSettings(options.settings);
  const resolver = fakeResolver({ "example.com": [PUBLIC_IP], ...options.hosts });
  const transport = fixtureTransport(options.routes ?? {}, resolver);
  const store = options.withStore === false ? undefined : await openWebStore(clock);
  const asker = options.asker ?? fakeAsker("allow");
  const runtime = createWebRuntime({
    clock,
    ids: fixedLocalIds(),
    logger: recordingLogger(logs),
    settings: () => settings,
    sessionSources: fakeSessionSources(),
    userAgent: "Xeon/0.1.0-test",
    resolver,
    transport,
    convert: options.convert ?? directConvertRunner(),
    ...(store === undefined ? {} : { store: store.service }),
    asker,
    guard: fakeSecretGuard(options.secretValues ?? []),
    ...(options.registrations === undefined ? {} : { registrations: options.registrations }),
    builtin: options.builtin ?? { search: [], fetch: [] },
    ...(options.headerSecrets === undefined ? {} : { headerSecrets: options.headerSecrets }),
    ...(options.extensionSetting === undefined
      ? {}
      : { extensionSetting: options.extensionSetting }),
  });
  // 후보 목록을 시험이 직접 정한 경우(레지스트리를 거치지 않는다) 그 목록으로 바꾼다
  const deps: WebDeps =
    options.catalog === undefined ? runtime.deps : { ...runtime.deps, catalog: options.catalog };
  const service = options.catalog === undefined ? runtime.service : createWebService(deps);
  return {
    deps,
    runtime,
    clock,
    resolver,
    transport,
    store,
    asker,
    logs,
    settings: () => settings,
    setSettings(next) {
      settings = next;
    },
    service,
    fetch: service.fetch.fetch,
    search: service.search.search,
    asModel: (threadId, requestId = "tool-1") => ({
      requestId,
      context: { threadId, caller: { kind: "model", agent: "main" } },
    }),
  };
}
