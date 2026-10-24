import { writeFile } from "node:fs/promises";
import { assertNever, attemptAsync, Bug, detach } from "@xeon/contracts";
import { resolveSetting } from "@xeon/contracts/settings";
import type { SecretOutOfBandPort } from "@xeon/contracts/services";
import type { StdioTransportOptions, Transport } from "@xeon/contracts/wire";
import { AssembleError, assemble, ENGINE_VERSION } from "./assemble.ts";
import { buildEngineCatalog } from "./assembly/catalog.ts";
import {
  hostLimitsOf,
  shutdownTimeoutOf,
  type SettingReader,
} from "./assembly/settings-sources.ts";
import { createConnectionHub } from "./connection.ts";
import type { ConnectionHub } from "./connection-types.ts";
import { createWireHandlers } from "./handlers/index.ts";
import { parseHostArgv } from "./argv.ts";
import type { CommandIo, HostCommand } from "./host-command.ts";
import { renderSettingsSchema } from "./settings.ts";
import { createInProcessTransportFactory } from "./transport/in-process.ts";
import { createStdioTransport } from "./transport/stdio.ts";
import type { AssembleOptions, Engine } from "./types.ts";
import { messageOf } from "./util.ts";

export type { CommandIo, HostCommand } from "./host-command.ts";

// L4.host-service.spec §3.3.4, §4.8. 호스트 시작 함수(in-process, stdio)와 서브커맨드 진입(runHostCommand).
// 서비스 모드(startService, ensureService)와 service-* 명령은 M3다.

export interface InProcessHost {
  /** kind "in-process". createHostConnection에 넘긴다 */
  readonly client: Transport;
  readonly engine: Engine;
  /**
   * 값 입력·열람 수단을 wire 밖으로 맡기는 통로(F wire §3.3.1, `SecretOutOfBandPort`). CLI가 `secret.beginEntry`·`secret.beginReveal`을
   * 보내기 전에 맡긴다. 서비스 접속에는 이 통로가 없다
   */
  readonly secretOutOfBand: SecretOutOfBandPort;
  /** 종료 절차(§4.8)를 거쳐 엔진을 닫는다. 진행 중 turn이 시한 안에 멈추지 않았으면 "deadline"이다 */
  close(): Promise<"clean" | "deadline">;
}

export interface HostExit {
  readonly code: 0 | 1;
  readonly reason: "eof" | "signal" | "idle" | "stop" | "startup";
  /** 시작 거부(code 1)일 때 이유 한 줄. spec에 더한 선택 필드 */
  readonly message?: string;
}

export interface StdioHostOptions extends StdioTransportOptions {
  readonly assemble?: Omit<AssembleOptions, "mode">;
  /** SIGTERM·SIGINT를 받으면 종료 절차를 밟는다(HS-36). 기본 true. 시험은 끈다 [spec에 더한 선택 필드] */
  readonly handleSignals?: boolean;
}

interface RunningHost {
  readonly engine: Engine;
  readonly hub: ConnectionHub;
}

function settingReaderOf(engine: Engine): SettingReader {
  return (key) => {
    const def = engine.catalog.get(key);
    if (def === undefined) return undefined;
    return resolveSetting(def, engine.ports.settings.layers(undefined)).setting.value;
  };
}

async function startHost(options: AssembleOptions): Promise<RunningHost> {
  const engine = await assemble(options);
  const slot: { hub: ConnectionHub | undefined } = { hub: undefined };
  const handlers = createWireHandlers(
    engine,
    () => {
      if (slot.hub === undefined) throw new Bug("connection hub is used before it is created");
      return slot.hub;
    },
    { serverName: "xeon", serverVersion: ENGINE_VERSION, pid: process.pid },
  );
  const hub = createConnectionHub(engine, handlers);
  slot.hub = hub;
  return { engine, hub };
}

/** HS-31: 새 요청을 거절하고, 진행 중 turn을 안전 경계에서 멈추고, 연결을 닫고, 엔진을 닫는다 */
async function stopHost(running: RunningHost): Promise<"clean" | "deadline"> {
  const { engine, hub } = running;
  hub.beginShutdown();
  const deadlineMs = shutdownTimeoutOf(settingReaderOf(engine));
  let outcome: "clean" | "deadline" = "clean";
  const stopped = await attemptAsync(() => engine.ports.turns.stopAtSafeBoundary(deadlineMs));
  if (!stopped.ok) {
    // 멈추는 호출이 실패하면 turn이 멈췄는지 알 수 없다. 시한을 넘긴 것과 같이 다룬다
    engine.ports.log.error("host.stop_failed", { message: messageOf(stopped.error.cause) });
    outcome = "deadline";
  } else if (!stopped.value) {
    engine.ports.log.error("host.stop_timeout", { deadlineMs });
    outcome = "deadline";
  }
  await hub.closeAll("shutdown");
  hub.dispose();
  await engine.close();
  return outcome;
}

export async function startInProcessHost(
  options: Omit<AssembleOptions, "mode"> = {},
): Promise<InProcessHost> {
  const devChecks = options.devChecks === true;
  const running = await startHost({ ...options, mode: "in-process" });
  const pair = createInProcessTransportFactory({ devChecks })();
  running.hub.serve(pair.server, {
    limits: hostLimitsOf(settingReaderOf(running.engine)),
    devChecks,
  });
  const state: { closing: Promise<"clean" | "deadline"> | undefined } = { closing: undefined };
  return {
    client: pair.client,
    engine: running.engine,
    secretOutOfBand: running.engine.ports.secrets.offers,
    close() {
      state.closing ??= stopHost(running);
      return state.closing;
    },
  };
}

/** stdio 호스트 하나를 실행하고 끝날 때 resolve한다. 프로세스 종료(exit)는 호출자가 한다 */
export async function startStdioHost(options: StdioHostOptions): Promise<HostExit> {
  const devChecks = options.assemble?.devChecks === true;
  let running: RunningHost;
  try {
    running = await startHost({ ...options.assemble, mode: "stdio" });
  } catch (caught) {
    const message =
      caught instanceof AssembleError ? caught.message : `startup failed: ${messageOf(caught)}`;
    return { code: 1, reason: "startup", message };
  }
  const transport = createStdioTransport({
    readable: options.readable,
    writable: options.writable,
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
  });
  const served = running.hub.serve(transport, {
    limits: hostLimitsOf(settingReaderOf(running.engine)),
    devChecks,
  });
  const signalWaiter = Promise.withResolvers<"signal">();
  const onSignal = (): void => {
    signalWaiter.resolve("signal");
  };
  const handleSignals = options.handleSignals !== false;
  if (handleSignals) {
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  }
  try {
    const first = await Promise.race([
      served.closed.then((info) => (info.reason === "eof" ? ("eof" as const) : ("stop" as const))),
      signalWaiter.promise,
    ]);
    await stopHost(running);
    return { code: 0, reason: first };
  } finally {
    if (handleSignals) {
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    }
  }
}

async function writeText(stream: WritableStream<Uint8Array>, text: string): Promise<void> {
  const writer = stream.getWriter();
  try {
    await writer.write(new TextEncoder().encode(text));
  } finally {
    writer.releaseLock();
  }
}

/** 종료코드를 돌려준다. 0 성공, 1 실패(시작 거부, 서비스 없음 등), 2 사용 오류 */
export async function runHostCommand(command: HostCommand, io: CommandIo): Promise<0 | 1 | 2> {
  switch (command.kind) {
    case "host-stdio": {
      const exit = await startStdioHost({ readable: io.stdin, writable: io.stdout });
      if (exit.message !== undefined) await writeText(io.stderr, `${exit.message}\n`);
      return exit.code;
    }
    case "config-schema": {
      // M1에는 외부 확장이 없어 --core-only와 같은 카탈로그다. 외부 확장은 M2 로더가 더한다
      const built = buildEngineCatalog();
      if (!built.ok) {
        await writeText(
          io.stderr,
          `settings catalog is invalid: ${built.issues.map((issue) => issue.code).join(", ")}\n`,
        );
        return 1;
      }
      const text = renderSettingsSchema(built.catalog, command.scope);
      if (command.out === undefined) await writeText(io.stdout, text);
      else await writeFile(command.out, text);
      return 0;
    }
    case "service-run":
    case "service-start":
    case "service-status":
    case "service-stop":
    case "service-ensure":
    case "service-launch-mode":
      await writeText(io.stderr, `${command.kind} is available from M3 (service mode)\n`);
      return 1;
    default:
      return assertNever(command, "HostCommand");
  }
}

// ── 개발 진입 ────────────────────────────────────────────────────────────

function fileSinkStream(sink: {
  write(chunk: Uint8Array): unknown;
  flush(): unknown;
}): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      sink.write(chunk);
      await sink.flush();
    },
  });
}

/** `bun xeon/apps/host/src/main.ts host --stdio` 같은 개발·테스트 진입. 배포 진입점이 아니다 */
async function runFromProcess(argv: readonly string[]): Promise<number> {
  const parsed = parseHostArgv(argv);
  const stderr = fileSinkStream(Bun.stderr.writer());
  if (!parsed.ok) {
    await writeText(stderr, `${parsed.message}\n`);
    return 2;
  }
  return runHostCommand(parsed.command, {
    stdin: Bun.stdin.stream(),
    stdout: fileSinkStream(Bun.stdout.writer()),
    stderr,
  });
}

// 최상위 await를 쓰지 않는다: `bun build --compile --bytecode`가 최상위 await를 거부한다(HOST.5, open-issues M-08)
if (import.meta.main) {
  detach(
    runFromProcess(process.argv.slice(2)).then((code) => process.exit(code)),
    (caught) => {
      process.stderr.write(`host failed: ${messageOf(caught)}\n`);
      process.exit(1);
    },
  );
}
