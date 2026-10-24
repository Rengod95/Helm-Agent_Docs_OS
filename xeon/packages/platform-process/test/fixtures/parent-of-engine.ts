// 자식 엔진(fake-engine)을 띄우고 두 pid를 JSON 한 줄로 알린 뒤 죽을 때까지 산다. 시험이 이 프로세스를 SIGKILL하면
// 엔진의 stdin 쪽 파이프 끝이 닫혀 엔진이 EOF를 읽는다(수명 임대, L0.process.spec §4.2).
// 사용: bun parent-of-engine.ts [--timeout-ms=N] [--participant-delay-ms=N]
import { parseFakeEngineArgs, spawnFakeEngine } from "../../src/testing/index.ts";

const engine = await spawnFakeEngine({ config: parseFakeEngineArgs(process.argv.slice(2)) });
process.stdout.write(`${JSON.stringify({ parent: process.pid, engine: engine.pid })}\n`);
// 이벤트 루프를 붙잡는다. 죽을 때까지 산다
setInterval(() => undefined, 60_000);
