import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CommandContext } from "./context.ts";

// L4.host-service.spec §4.9, L4.cli.spec §3.1 `fresnel plugin-host --stdio`. 내부 진입이다: 엔진이 자기 실행 파일을 이 모양으로 다시 띄운다.
// 엔진을 열지 않고 설정과 저장소를 읽지 않는다. 본체(@fresnel/host/plugin-host)는 deps.runPluginHost가 부를 때 싣는다.
// stdin/stdout은 JSON Lines 전용이므로 이 명령은 사람용 출력을 쓰지 않는다.

/** 플러그인 호스트 본체를 돌린다. 본체가 낸 0(정상 끝)과 1(실패)을 그대로 종료 코드로 쓴다 */
export async function runPluginHostStdio(ctx: CommandContext): Promise<ExitCode> {
  const { io, deps } = ctx;
  const code = await deps.runPluginHost({
    stdin: io.stdin,
    stdout: io.stdoutStream,
    stderr: io.stderrStream,
  });
  return code === 0 ? EXIT.ok : EXIT.error;
}
