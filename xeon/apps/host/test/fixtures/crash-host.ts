import { startStdioHost } from "../../src/main.ts";
import { approvalModels } from "./approval-tape.ts";

// HOST.4 A1 시험이 SIGKILL로 죽이는 자식 호스트. 운영 진입(host --stdio)과 같은 startStdioHost에 모델 테이프만 넣는다.
// 이 파일은 시험 파일이다(DR-08). 입출력은 부모와 맞물린 stdin·stdout JSON Lines다.

async function main(): Promise<number> {
  const out = new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });
  const exit = await startStdioHost({
    readable: Bun.stdin.stream(),
    writable: out,
    assemble: { defaultGroups: false, buildModels: approvalModels("crash") },
    handleSignals: false,
  });
  return exit.code;
}

main().then(
  (code) => process.exit(code),
  (caught: unknown) => {
    process.stderr.write(
      `crash-host: ${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`,
    );
    process.exit(1);
  },
);
