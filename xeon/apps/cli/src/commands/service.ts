import { assertNever } from "@xeon/contracts";
import type { CommandIo, HostCommand } from "@xeon/host";
import type { ServiceCommand } from "../cli/command.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CommandContext } from "./context.ts";

// L4.cli.spec §3.1 service. `xeon service start|status|stop|ensure`와 숨은 `launch-mode`·`run`. 엔진을 이 프로세스에서 열지 않는다:
// @xeon/host의 runHostCommand가 등록 파일과 소켓으로 서비스를 찾고 띄우고 내린다(L4.host-service.spec §3.3.5, §4.9).
// `run`은 서비스 본체를 전경에서 돌린다. `start`와 `ensure`가 자기 바이너리를 `service run`으로 detached 실행한다(SV-06).

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function textSink(write: (text: string) => Promise<void>): WritableStream<Uint8Array> {
  const decoder = new TextDecoder();
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await write(decoder.decode(chunk, { stream: true }));
    },
  });
}

/** CLI 명령을 호스트 명령으로 옮긴다. 순수 함수 */
function hostCommandOf(command: ServiceCommand): HostCommand {
  switch (command.action) {
    case "start":
      return {
        kind: "service-start",
        ...(command.safeMode ? { safeMode: true } : {}),
        ...(command.listenTcp === null ? {} : { tcp: command.listenTcp }),
      };
    case "ensure":
      return { kind: "service-ensure", ...(command.safeMode ? { safeMode: true } : {}) };
    case "status":
      return { kind: "service-status", json: command.output === "json" };
    case "stop":
      return { kind: "service-stop" };
    case "launch-mode":
      return { kind: "service-launch-mode" };
    case "run":
      return {
        kind: "service-run",
        safeMode: command.safeMode,
        ...(command.listenTcp === null ? {} : { tcp: command.listenTcp }),
      };
    default:
      return assertNever(command.action, "ServiceAction");
  }
}

export async function runService(ctx: CommandContext, command: ServiceCommand): Promise<ExitCode> {
  const io: CommandIo = {
    stdin: emptyStream(),
    stdout: textSink(ctx.io.stdout),
    stderr: textSink(ctx.io.stderr),
  };
  const code = await ctx.deps.runHostCommand(hostCommandOf(command), io);
  return code === 0 ? EXIT.ok : code === 2 ? EXIT.usage : EXIT.error;
}
