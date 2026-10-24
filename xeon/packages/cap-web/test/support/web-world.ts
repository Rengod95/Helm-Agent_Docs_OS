import type { Logger, LogFields } from "@xeon/contracts";
import type { CallOptions } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { createFetchCache, type FetchCache } from "../../src/cache/fetch-cache.ts";
import { createSourceIdRegistry } from "../../src/contract/source-ids.ts";
import { createSessionLimits } from "../../src/cost/limits.ts";
import { createUsageMeter } from "../../src/cost/meter.ts";
import type { WebDeps } from "../../src/deps.ts";
import { directConvertRunner, type ConvertRunner } from "../../src/fetch/convert-runner.ts";
import { createFetchApi } from "../../src/fetch/pipeline.ts";
import { createRobotsGate } from "../../src/fetch/robots-gate.ts";
import { createAccess } from "../../src/policy/access.ts";
import { createContentHttp } from "../../src/policy/content-http.ts";
import { createSeenUrls } from "../../src/policy/seen-urls.ts";
import type { WebProviderCatalog } from "../../src/ports/providers.ts";
import { createProbeCache } from "../../src/search/probe-cache.ts";
import { DEFAULT_WEB_SETTINGS, type WebSettings } from "../../src/settings.ts";
import { fakeAsker, fakeSecretGuard, fakeSessionSources } from "../../src/testing/fake-ports.ts";
import { fakeCatalog } from "../../src/testing/fake-providers.ts";
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
  readonly catalog?: WebProviderCatalog;
  /** 변환 실행기. 기본은 같은 프로세스에서 직접 변환한다 */
  readonly convert?: ConvertRunner;
  /** false면 저장소 없이 조립한다(디스크 캐시와 rawRef가 없는 모드) */
  readonly withStore?: boolean;
  readonly secretValues?: readonly string[];
}

export interface WebWorld {
  readonly deps: WebDeps;
  readonly clock: ManualClock;
  readonly resolver: FakeResolver;
  readonly transport: FixtureTransport;
  readonly store: TestStore | undefined;
  readonly cache: FetchCache | undefined;
  readonly logs: LogRecord[];
  /** 호출마다 읽는 현재 설정 */
  readonly settings: () => WebSettings;
  /** 설정을 바꾼다. 다음 호출부터 적용된다 */
  setSettings(next: WebSettings): void;
  fetch: ReturnType<typeof createFetchApi>["fetch"];
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
  const seen = createSeenUrls(fakeSessionSources());
  const access = createAccess({
    resolver,
    settings: () => settings,
    seen,
    guard: fakeSecretGuard(options.secretValues ?? []),
    asker: fakeAsker("allow"),
  });
  const content = createContentHttp(access, transport);
  const store = options.withStore === false ? undefined : await openWebStore(clock);
  const cache = store === undefined ? undefined : createFetchCache({ store: store.service, clock });
  if (cache !== undefined) {
    const migrated = cache.migrate();
    if (!migrated.ok) throw new Error("test store migration failed");
  }
  const deps: WebDeps = {
    clock,
    ids: fixedLocalIds(),
    logger: recordingLogger(logs),
    userAgent: "Xeon/0.1.0-test",
    settings: () => settings,
    access,
    content,
    robots: createRobotsGate({ access, content, clock, userAgent: "Xeon/0.1.0-test" }),
    convert: options.convert ?? directConvertRunner(),
    cache,
    meter: store === undefined ? undefined : createUsageMeter({ store: store.service, clock }),
    limits: createSessionLimits(),
    seen,
    sourceIds: createSourceIdRegistry(fakeSessionSources()),
    catalog: options.catalog ?? fakeCatalog(),
    probes: createProbeCache(clock),
  };
  const api = createFetchApi(deps);
  return {
    deps,
    clock,
    resolver,
    transport,
    store,
    cache,
    logs,
    settings: () => settings,
    setSettings(next) {
      settings = next;
    },
    fetch: api.fetch,
    asModel: (threadId, requestId = "tool-1") => ({
      requestId,
      context: { threadId, caller: { kind: "model", agent: "main" } },
    }),
  };
}
