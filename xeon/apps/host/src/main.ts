import { detach } from "@fresnel/contracts";
import { bunCommandIo } from "./bun-io.ts";
import { parsePluginHostArgv } from "./plugin-host/argv.ts";

// 진입 파일. 배포 바이너리(컴파일)와 개발 진입(`bun main.ts <서브커맨드>`)이 모두 이 파일을 실행한다.
// 이 파일은 엔진(assemble, 카탈로그, 전송)을 정적으로 싣지 않는다. `plugin-host --stdio`는 가벼운 경로만 거쳐야 시작이 빠르다
// (L4.host-service.spec §4.9). 나머지 서브커맨드는 command-run.ts를 동적으로 싣는다.

async function runFromProcess(argv: readonly string[]): Promise<number> {
  if (argv[0] === "plugin-host") {
    const parsed = parsePluginHostArgv(argv.slice(1));
    if (!parsed.ok) {
      process.stderr.write(`${parsed.message}\n`);
      return 2;
    }
    const runner = await import("./plugin-host/run.ts");
    return runner.runPluginHostStdio(bunCommandIo());
  }
  const dev = await import("./command-run.ts");
  return dev.runDevEntry(argv);
}

// 최상위 await를 쓰지 않는다: `bun build --compile --bytecode`가 최상위 await를 거부한다(HOST.5, open-issues M-08)
if (import.meta.main) {
  detach(
    runFromProcess(process.argv.slice(2)).then((code) => process.exit(code)),
    (caught) => {
      const message = caught instanceof Error ? caught.message : String(caught);
      process.stderr.write(`host failed: ${message}\n`);
      process.exit(1);
    },
  );
}
