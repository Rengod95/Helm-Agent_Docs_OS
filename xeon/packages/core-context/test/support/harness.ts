import type { ExtensionManifest, Handler } from "@xeon/contracts/extensions";
import type { Logger, LogFields } from "@xeon/contracts";
import type { ContextService } from "@xeon/contracts/services";
import type { ExtensionUnit } from "@xeon/ext-host";
import { createTestHost, type TestHost } from "@xeon/ext-host/testing";
import { createContextService } from "../../src/service.ts";
import { tokenEstimator } from "./builders.ts";
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

export interface Harness {
  readonly log: MemoryLog;
  readonly host: TestHost;
  readonly service: ContextService;
  readonly logged: LoggedCall[];
}

/** 메모리 로그, 테스트 호스트, 그 위에 만든 서비스. 분류기는 쓰지 않으므로 tokens만 채운다 */
export async function harness(): Promise<Harness> {
  const log = memoryLog();
  const host = await createTestHost();
  const logged: LoggedCall[] = [];
  const service = createContextService({
    session: log,
    models: { tokens: tokenEstimator },
    ext: host.host,
    logger: memoryLogger(logged),
  });
  return { log, host, service, logged };
}

function manifestOf(name: string): ExtensionManifest {
  return {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points: ["context"],
    usesDrive: false,
  };
}

/** context 지점에 핸들러 하나를 다는 확장을 설치한다 */
export async function installContextHandler(
  host: TestHost,
  name: string,
  loadIndex: number,
  handler: Handler<"context">,
): Promise<void> {
  const manifest = manifestOf(name);
  const unit: ExtensionUnit = {
    manifest,
    entry: ({ scope }) => {
      scope(name, {}, (g) => {
        g.on("context", handler);
      });
    },
    loadIndex,
    builtin: true,
  };
  await host.host.install(unit);
}
