import { t } from "@xeon/core-models/testing";
import { startStdioHost } from "@xeon/host";
import { modelsOf } from "../support/real-host.ts";

// L4.cli.plan §5.2: 실제 프로세스로 도는 호스트 진입(`host --stdio`와 같은 startStdioHost)에 모델 테이프만 넣는다. 시험 파일이다(DR-08).
// 모델은 승인이 필요한 bash 호출을 한 번 내고 그 뒤 답이 없다: 시험이 승인 대기 중에 SIGKILL로 죽인다.
// 환경 변수 XEON_SCENARIO_COMMAND가 bash 명령이다.

async function main(): Promise<number> {
  const command = process.env["XEON_SCENARIO_COMMAND"] ?? "echo approved-by-user";
  const out = new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });
  const exit = await startStdioHost({
    readable: Bun.stdin.stream(),
    writable: out,
    assemble: {
      defaultGroups: false,
      buildModels: modelsOf("scenario-host", [
        {
          role: "main",
          label: "asks to run a command",
          response: {
            type: "message",
            content: [t.toolCall("bash", { command }, "call_1")],
            stopReason: "toolUse",
          },
        },
      ]),
    },
    handleSignals: false,
  });
  return exit.code;
}

main().then(
  (code) => process.exit(code),
  (caught: unknown) => {
    process.stderr.write(
      `scenario-host: ${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`,
    );
    process.exit(1);
  },
);
