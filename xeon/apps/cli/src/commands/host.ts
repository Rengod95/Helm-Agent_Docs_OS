import { assertNever } from "@xeon/contracts";
import type { ServiceEndpoint } from "@xeon/host";
import { failureOfStart, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CliIo } from "../io.ts";
import { invalidRemoteError, serviceConnectErrorOf } from "../engine.ts";
import { cliSettings } from "../settings.ts";
import { printFailure, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 `xeon host --stdio`, plan C16. 컴파일 바이너리의 내부 진입이다. 데스크톱 사이드카가 쓴다.
// stdin/stdout은 JSON Lines 계약 전용이다: 사람용 출력은 stderr로만 보낸다(§4.1 3번).
// l4.cli.* 설정 그룹을 카탈로그에 넣으려고 runHostCommand 대신 같은 일을 하는 startStdioHost를 부른다(§3.3 표).
// 원격 주소(`--remote` 또는 설정)가 있으면 엔진을 열지 않고 원격 서비스에 중계한다(HS-89).

/** 호스트가 끝날 때까지 기다린다. 읽기 끝(EOF), 신호, host.shutdown 요청이 끝내는 길이다 */
export async function runHostStdio(ctx: CommandContext): Promise<ExitCode> {
  const { io, deps } = ctx;
  const remote = await deps.resolveRemote({
    ...(ctx.global.remote === null ? {} : { flag: ctx.global.remote }),
    env: io.env,
  });
  if (remote.kind === "invalid") {
    const failure = failureOfStart(invalidRemoteError(remote));
    await printFailure(io, failure);
    return failure.code;
  }
  if (remote.kind === "remote") return bridgeToRemote(io, ctx, remote.endpoint);
  const exit = await deps.startStdioHost({
    readable: io.stdin,
    writable: io.stdoutStream,
    assemble: { settingGroups: [cliSettings], devChecks: deps.devWireRoundTrip },
  });
  if (exit.message !== undefined) await io.stderr(`xeon: ${exit.message}\n`);
  return exit.code === 0 ? EXIT.ok : EXIT.error;
}

/** 원격 서비스에 중계한다. stdin이 닫히면 0, 원격이 끊기거나 중계가 실패하면 1, 접속에 실패하면 연결 오류의 종료 코드다 */
async function bridgeToRemote(
  io: CliIo,
  ctx: CommandContext,
  endpoint: ServiceEndpoint,
): Promise<ExitCode> {
  // 진단은 중계가 끝난 뒤에 쓴다. 동기 콜백에서 stderr를 기다리지 않으려고 모아 둔다
  const diagnostics: string[] = [];
  const exit = await ctx.deps.bridgeStdio({
    readable: io.stdin,
    writable: io.stdoutStream,
    endpoint,
    diagnose: (line) => {
      diagnostics.push(line);
    },
  });
  if (diagnostics.length > 0) {
    await io.stderr(diagnostics.map((line) => `xeon: ${line}\n`).join(""));
  }
  switch (exit.reason) {
    case "stdin_closed":
      return EXIT.ok;
    case "connect_failed":
      return reportFailure(io, failureOfStart(serviceConnectErrorOf(exit.error)));
    case "remote_closed":
      return reportFailure(io, {
        message: "원격 서비스 연결이 끊겼다",
        fix: "xeon service status로 원격 서비스를 확인하고 다시 실행한다",
        code: EXIT.error,
      });
    case "relay_failed":
      return reportFailure(io, {
        message: "원격 서비스와 중계하지 못했다",
        fix: "xeon service status로 원격 서비스를 확인하고 다시 실행한다",
        code: EXIT.error,
      });
    default:
      return assertNever(exit, "BridgeExit");
  }
}

async function reportFailure(io: CliIo, failure: Failure): Promise<ExitCode> {
  await printFailure(io, failure);
  return failure.code;
}
