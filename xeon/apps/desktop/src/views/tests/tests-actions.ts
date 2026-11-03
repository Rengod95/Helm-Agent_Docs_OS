// 테스트 화면의 동작 묶음. 명령을 부르고 결과를 화면 상태에 넣을 값으로 바꾼다(React를 쓰지 않아 명령 대역만으로 시험한다).
import { assertNever, type Result } from "@fresnel/contracts";
import type { RunControl, TestFailure } from "@fresnel/client/workbench";
import type { ExtTestRunParams } from "@fresnel/contracts/wire";
import type { CommandError, TestCommands } from "../commands.ts";
import { testFailureOf } from "./tests-text.ts";

/** 동작의 결과. 실패는 화면이 쓰는 실패 종류로 줄여 든다 */
export type ActionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: TestFailure };

function outcomeOf<T>(result: Result<T, CommandError>): ActionOutcome<T> {
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, failure: testFailureOf(result.error) };
}

/** Test run 제어. 성공하면 멈춘 채인지 값으로 돌려준다(목록에는 표지가 없어 화면 상태가 이 값을 든다) */
export async function runControl(
  tests: TestCommands,
  action: RunControl,
  threadId: string,
): Promise<ActionOutcome<boolean>> {
  switch (action) {
    case "pause":
      return outcomeOf(await tests.pause(threadId));
    case "resume":
      return outcomeOf(await tests.resume(threadId));
    case "step":
      return outcomeOf(await tests.step(threadId));
    default:
      return assertNever(action, "RunControl");
  }
}

/** 단계 이름 읽기. 읽지 못하면 null이다(Test run이 아니거나 아직 단계가 없는 것과 같다) */
export async function phaseOf(tests: TestCommands, threadId: string): Promise<string | null> {
  const got = await tests.phase(threadId);
  return got.ok ? got.value.phase : null;
}

/** replay 시험 시작. 성공하면 시험 id를 돌려준다 */
export async function startReplay(
  tests: TestCommands,
  params: ExtTestRunParams,
): Promise<ActionOutcome<string>> {
  const started = await tests.run(params);
  return started.ok
    ? { ok: true, value: started.value.testId }
    : { ok: false, failure: testFailureOf(started.error) };
}

/** Test run 대화 만들기. 성공하면 대화 id를 돌려준다 */
export async function createTestRunThread(tests: TestCommands): Promise<ActionOutcome<string>> {
  return outcomeOf(await tests.createTestRun());
}
