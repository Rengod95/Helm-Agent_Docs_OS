import { writeFile } from "node:fs/promises";
import { assertNever, detach } from "@xeon/contracts";
import type { SecretOutOfBandPort } from "@xeon/contracts/services";
import type { StdioTransportOptions, Transport } from "@xeon/contracts/wire";
import { AssembleError } from "./assemble.ts";
import { buildEngineCatalog } from "./assembly/catalog.ts";
import { hostLimitsOf } from "./assembly/settings-sources.ts";
import {
  closeHost,
  settingReaderOf,
  startHost,
  stopHost,
  stopTurns,
  type HostExit,
  type RunningHost,
} from "./host-runtime.ts";

import { parseHostArgv } from "./argv.ts";
import type { CommandIo, HostCommand } from "./host-command.ts";
import { runServiceCommand } from "./service/commands.ts";
import { renderSettingsSchema } from "./settings.ts";
import { createInProcessTransportFactory } from "./transport/in-process.ts";
import { createStdioTransport } from "./transport/stdio.ts";
import type { AssembleOptions, Engine } from "./types.ts";
import { messageOf } from "./util.ts";

export type { CommandIo, HostCommand } from "./host-command.ts";
export type { HostExit } from "./host-runtime.ts";

// L4.host-service.spec §3.3.4, §4.8. 호스트 시작 함수(in-process, stdio)와 서브커맨드 진입(runHostCommand).
// 서비스 모드(startService, ensureHostService)와 service-* 명령은 service/ 아래에 있다.

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

export interface StdioHostOptions extends StdioTransportOptions {
  readonly assemble?: Omit<AssembleOptions, "mode">;
  /** SIGTERM·SIGINT를 받으면 종료 절차를 밟는다(HS-36). 기본 true. 시험은 끈다 [spec에 더한 선택 필드] */
  readonly handleSignals?: boolean;
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

/**
 * stdio 호스트 하나를 실행하고 끝날 때 resolve한다. 프로세스 종료(exit)는 호출자가 한다.
 * 끝나는 길은 셋이고 모두 같은 종료 절차(HS-31)를 밟는다: 읽기 끝(stdin EOF, HS-32), SIGTERM·SIGINT(HS-36), `host.shutdown` 요청(HS-34).
 * 절차는 엔진의 종료 협조 창구(`Engine.shutdown`)로 요청하므로 확장의 종료 참여자도 시한 안에서 불리고,
 * 시한을 넘기면 창구가 `exit(1)`로 프로세스를 끝낸다(L0.process.spec §4.2).
 */
export async function startStdioHost(options: StdioHostOptions): Promise<HostExit> {
  const devChecks = options.assemble?.devChecks === true;
  const stopRequested = Promise.withResolvers<"stop">();
  let running: RunningHost;
  try {
    running = await startHost(
      { ...options.assemble, mode: "stdio" },
      {
        stopRequested: () => {
          stopRequested.resolve("stop");
        },
      },
    );
  } catch (caught) {
    const message =
      caught instanceof AssembleError ? caught.message : `startup failed: ${messageOf(caught)}`;
    return { code: 1, reason: "startup", message };
  }
  const { engine } = running;
  // 호스트 자신의 참여자. 등록 역순이라 확장·L0 참여자보다 먼저 불려 turn을 멈춘다
  const turnStop: { outcome: "clean" | "deadline" } = { outcome: "clean" };
  engine.shutdown.onShutdown("host", async () => {
    turnStop.outcome = await stopTurns(running);
  });
  const transport = createStdioTransport({
    readable: options.readable,
    writable: options.writable,
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
  });
  const served = running.hub.serve(transport, {
    limits: hostLimitsOf(settingReaderOf(engine)),
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
      // 읽기 오류도 상대가 사라진 것으로 본다(L0.process.spec §4.2 stdin 임대)
      served.closed.then((info) =>
        info.reason === "eof" || info.reason === "error" ? ("eof" as const) : ("stop" as const),
      ),
      signalWaiter.promise,
      stopRequested.promise,
    ]);
    // host.shutdown 요청은 처리기가 협조 종료를 이미 마쳤다. 나머지는 여기서 요청한다. 같은 요청은 한 번만 실행된다
    if (first === "eof") await engine.shutdown.request("stdin_eof");
    else if (first === "signal") await engine.shutdown.request("signal");
    await closeHost(running);
    if (turnStop.outcome === "deadline") {
      return {
        code: 1,
        reason: first,
        message: "the running turn did not stop within the shutdown deadline",
      };
    }
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
      return runServiceCommand(command, io);
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
