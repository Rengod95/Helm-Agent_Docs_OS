// restart.fault.test.ts가 자식 프로세스로 띄우는 스크립트. 이름 붙은 종료 지점에서 자기 프로세스에 SIGKILL을 보낸다
// (L1.persistence.spec §4.14 K1~K6, eng.testing.guide TS-08 3번). 인자: <DB 파일> <지점>
import { Bug } from "@xeon/contracts";
import type { FaultInjector, FaultPoint } from "@xeon/contracts/records";
import { fixedIdFactory, manualClock } from "./clock.ts";
import {
  commitExec,
  commitIntent,
  commitResponse,
  commitResultOf,
  commitStepStart,
  endStep,
  newThread,
  openHarness,
  startTurn,
} from "./harness.ts";

const [dbPath, point] = process.argv.slice(2);
if (dbPath === undefined || point === undefined) throw new Bug("usage: crash-child <db> <point>");

function die(): never {
  process.kill(process.pid, "SIGKILL");
  throw new Bug("unreachable: the process should be dead");
}

const txFault = point.startsWith("TX:") ? point.slice(3) : null;
let armed = false;
const faults: FaultInjector = {
  hit(hit: FaultPoint): void {
    if (armed && txFault !== null && hit === txFault) die();
  },
};

const h = await openHarness({
  path: dbPath,
  clock: manualClock(),
  ids: fixedIdFactory(1),
  faults,
});
const { threadId } = newThread(h);
const turn = startTurn(h, threadId);
const stepId = h.ids.next("stp");
const replay = point.endsWith(":safe") ? "safe" : "unsafe";
const call = { toolCallId: "tc1", toolName: "bash", replay } as const;

if (point === "K1") {
  // C3 전: 단계는 시작했고 응답은 아직 없다
  commitStepStart(h, turn, 0, stepId);
  die();
}
commitStepStart(h, turn, 0, stepId);
commitResponse(h, turn, 0, stepId, [call]);

if (txFault !== null) {
  // 커밋 도중 종료: C5를 보내다 지정한 지점에서 죽는다. 그 전의 도구 호출은 모두 끝낸 상태다
  const effect = commitIntent(h, turn, stepId, call);
  commitExec(h, turn, stepId, effect.effectId, call.toolCallId);
  commitResultOf(h, turn, stepId, effect);
  armed = true;
  endStep(h, turn, 0, stepId, "request");
  // after_commit 지점이면 여기까지 오기 전에 죽는다
  die();
}

const effect = commitIntent(h, turn, stepId, call);
if (point.startsWith("K2")) die();
commitExec(h, turn, stepId, effect.effectId, call.toolCallId);
if (point.startsWith("K3") || point.startsWith("K4")) die();
if (point === "K5") {
  // E3가 COMMIT된 뒤 방출 중에 죽는다
  h.service.feed.onCommit((batch) => {
    if (batch.events.some((event) => event.kind === "effect.result")) die();
  });
}
commitResultOf(h, turn, stepId, effect);
endStep(h, turn, 0, stepId, "request");
// K6: 모든 효과가 닫힌 뒤 C6 전에 죽는다
die();
