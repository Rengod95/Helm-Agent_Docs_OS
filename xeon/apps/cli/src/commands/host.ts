import { EXIT, type ExitCode } from "../exit-codes.ts";
import { cliSettings } from "../settings.ts";
import type { CommandContext } from "./context.ts";

// L4.cli.spec §3.1 `xeon host --stdio`, plan C16. 컴파일 바이너리의 내부 진입이다. 데스크톱 사이드카가 쓴다.
// stdin/stdout은 JSON Lines 계약 전용이다: 사람용 출력은 stderr로만 보낸다(§4.1 3번).
// l4.cli.* 설정 그룹을 카탈로그에 넣으려고 runHostCommand 대신 같은 일을 하는 startStdioHost를 부른다(§3.3 표).

/** 호스트가 끝날 때까지 기다린다. 읽기 끝(EOF), 신호, host.shutdown 요청이 끝내는 길이다 */
export async function runHostStdio(ctx: CommandContext): Promise<ExitCode> {
  const { io, deps } = ctx;
  const exit = await deps.startStdioHost({
    readable: io.stdin,
    writable: io.stdoutStream,
    assemble: { settingGroups: [cliSettings], devChecks: deps.devWireRoundTrip },
  });
  if (exit.message !== undefined) await io.stderr(`xeon: ${exit.message}\n`);
  return exit.code === 0 ? EXIT.ok : EXIT.error;
}
