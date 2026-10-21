import { loadTape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import { runCli } from "../../src/main.ts";
import { createRealDeps, createRealIo } from "../../src/runtime.ts";
import { realTapeClock } from "../support/scenario.ts";

// L4.cli.plan §5.2: 실제 프로세스로 도는 CLI 진입. 운영 진입(src/main.ts)과 같은 runCli에 모델 테이프만 넣는다.
// 이 파일은 테스트 파일이다(DR-08): core-models/testing을 import해도 된다.
// 환경 변수 XEON_SCENARIO_TAPE가 테이프 경로다.

async function main(): Promise<number> {
  const tapePath = process.env["XEON_SCENARIO_TAPE"];
  if (tapePath === undefined) throw new Error("XEON_SCENARIO_TAPE is not set");
  const player = tapePlayer(await loadTape(tapePath), { clock: realTapeClock() });
  const fake = tapeProvider(player);
  const deps = {
    ...createRealDeps(process.env),
    assemble: { buildModels: tapeBuildModels(fake), defaultGroups: false },
  };
  return runCli(process.argv.slice(2), createRealIo(), deps);
}

main().then(
  (code) => process.exit(code),
  (caught: unknown) => {
    process.stderr.write(
      `scenario-main: ${caught instanceof Error ? (caught.stack ?? caught.message) : String(caught)}\n`,
    );
    process.exit(1);
  },
);
