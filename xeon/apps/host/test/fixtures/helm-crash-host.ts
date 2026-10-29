import { tapeBuildModels, tapeProvider } from "@xeon/core-models/testing";
import { startStdioHost } from "../../src/main.ts";
import { helmDivergeTape, holdingPlayer } from "./helm-tape.ts";

// SIGKILL 시험의 자식 호스트. 운영 진입(startStdioHost)에 실제 Helm 묶음(XEON_TEST_HELM_BUNDLE)과 모델 테이프를 넣는다.
// 네 번째 모델 호출(렌즈 탐색 중)을 붙잡아 조사가 탐색 단계에 머물게 한다. 부모가 SIGKILL로 죽인다.
// 이 파일은 시험 파일이다(DR-08). 입출력은 부모와 맞물린 stdin·stdout JSON Lines다.

const HELD_CALL = 4;

async function main(): Promise<number> {
  const bundle = process.env["XEON_TEST_HELM_BUNDLE"];
  if (bundle === undefined || bundle === "") throw new Error("XEON_TEST_HELM_BUNDLE is not set");
  const out = new WritableStream<Uint8Array>({
    write(chunk) {
      process.stdout.write(chunk);
    },
  });
  const exit = await startStdioHost({
    readable: Bun.stdin.stream(),
    writable: out,
    assemble: {
      defaultPluginsDir: bundle,
      buildModels: tapeBuildModels(
        tapeProvider(holdingPlayer(helmDivergeTape("helm-sigkill-child"), HELD_CALL)),
      ),
    },
    handleSignals: false,
  });
  return exit.code;
}

main().then(
  (code) => process.exit(code),
  (caught: unknown) => {
    process.stderr.write(
      `helm-crash-host: ${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`,
    );
    process.exit(1);
  },
);
