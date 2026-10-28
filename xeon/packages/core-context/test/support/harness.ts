import type { ExtensionManifest, Handler, PointName, ScopeApi } from "@xeon/contracts/extensions";
import type { Logger, LogFields } from "@xeon/contracts";
import type { ProducerHandle } from "@xeon/contracts/records";
import type { ContextService } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import { createContextService } from "../../src/service.ts";
import { DEFAULT_CONTEXT_SETTINGS, type ContextSettings } from "../../src/settings.ts";
import { fakeModels, type FakeModels, type FakeModelsOptions } from "./fake-models.ts";
import { memoryLog, type MemoryLog } from "./log.ts";

interface LoggedCall {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly event: string;
  readonly fields: LogFields | undefined;
}

/** 호출을 모으는 Logger 대역 */
function memoryLogger(calls: LoggedCall[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => {
      calls.push({ level: "debug", event, fields });
    },
    info: (event, fields) => {
      calls.push({ level: "info", event, fields });
    },
    warn: (event, fields) => {
      calls.push({ level: "warn", event, fields });
    },
    error: (event, fields) => {
      calls.push({ level: "error", event, fields });
    },
    child: () => logger,
  };
  return logger;
}

export interface HarnessOptions {
  readonly settings?: Partial<ContextSettings>;
  readonly models?: FakeModelsOptions;
  /** 거짓이면 생산자·id 발급 없이 만든다(컴팩션 꺼진 서비스) */
  readonly compaction?: boolean;
  /** 컴팩션 뒤 재주입 customType. 생략하면 서비스 기본값 */
  readonly reinjectCustomTypes?: readonly string[];
}

export interface Harness {
  readonly fake: FakeModels;
  /** 컴팩션 서비스가 쓰는 core.context 생산자 핸들(서비스를 다시 만들 때 같은 것을 넘긴다) */
  readonly producer: ProducerHandle;
  readonly settings: () => ContextSettings;
  /** 설정 스냅샷을 바꾼다. 서비스는 호출 시점마다 새로 읽는다 */
  setSettings(patch: Partial<ContextSettings>): void;
  readonly log: MemoryLog;
  readonly host: TestHost;
  readonly service: ContextService;
  readonly logged: LoggedCall[];
}

/** 메모리 로그, 테스트 호스트, 요약 모델 대역, 그 위에 만든 서비스 */
export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const log = memoryLog();
  const host = await createTestHost();
  const logged: LoggedCall[] = [];
  const fake = fakeModels(options.models);
  let settings: ContextSettings = { ...DEFAULT_CONTEXT_SETTINGS, ...options.settings };
  const compaction = options.compaction ?? true;
  const producer = log.producer("core.context");
  const service = createContextService({
    session: log,
    models: fake.models,
    ext: host.host,
    settings: () => settings,
    ...(compaction ? { producer, ids: log.ids } : {}),
    ...(options.reinjectCustomTypes === undefined
      ? {}
      : { reinjectCustomTypes: options.reinjectCustomTypes }),
    logger: memoryLogger(logged),
  });
  return {
    fake,
    producer,
    settings: () => settings,
    setSettings(patch) {
      settings = { ...settings, ...patch };
    },
    log,
    host,
    service,
    logged,
  };
}

function manifestOf(
  name: string,
  points: readonly PointName[] = ["request.context.before"],
): ExtensionManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [...points],
    usesDrive: false,
  };
}

/** 여러 지점에 핸들러를 다는 확장을 설치한다. register가 g.on(...)을 부른다 */
export async function installHandlers(
  host: TestHost,
  name: string,
  loadIndex: number,
  points: readonly PointName[],
  register: (g: ScopeApi<unknown>) => void,
): Promise<void> {
  const unit: ExtensionUnit = {
    manifest: manifestOf(name, points),
    entry: ({ scope }) => {
      scope(name, {}, (g) => {
        register(g);
      });
    },
    loadIndex,
    builtin: true,
  };
  await host.host.install(unit);
}

/** context 지점에 핸들러 하나를 다는 확장을 설치한다 */
export async function installContextHandler(
  host: TestHost,
  name: string,
  loadIndex: number,
  handler: Handler<"request.context.before">,
): Promise<void> {
  const manifest = manifestOf(name);
  const unit: ExtensionUnit = {
    manifest,
    entry: ({ scope }) => {
      scope(name, {}, (g) => {
        g.on("request.context.before", handler);
      });
    },
    loadIndex,
    builtin: true,
  };
  await host.host.install(unit);
}
