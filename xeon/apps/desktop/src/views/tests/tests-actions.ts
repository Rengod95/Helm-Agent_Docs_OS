// 테스트 화면의 동작 묶음. 명령을 부르고 결과를 화면 상태에 넣을 값으로 바꾼다(React를 쓰지 않아 명령 대역만으로 시험한다).
import { assertNever, type Result } from "@fresnel/contracts";
import type { RunControl, TestFailure } from "@fresnel/client/workbench";
import type { ExtTestRunParams } from "@fresnel/contracts/wire";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { Commands, CommandError, TestCommands } from "../commands.ts";
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

/** 시험 시작(`ext.test.run`). replay와 Test run이 같은 호출을 쓴다. 성공하면 시험 id와(Test run이면) 시험 대화 id를 돌려준다 */
export async function startTest(
  tests: TestCommands,
  params: ExtTestRunParams,
): Promise<ActionOutcome<{ readonly testId: string; readonly threadId: string | null }>> {
  const started = await tests.run(params);
  return started.ok
    ? { ok: true, value: { testId: started.value.testId, threadId: started.value.threadId } }
    : { ok: false, failure: testFailureOf(started.error) };
}

/** Test run 대화 만들기. 성공하면 대화 id를 돌려준다 */
export async function createTestRunThread(
  tests: TestCommands,
  profileId?: string,
): Promise<ActionOutcome<string>> {
  return outcomeOf(await tests.createTestRun(profileId));
}

/**
 * Test run의 과제를 시험 대화의 첫 턴으로 보낸다. 대화를 열고(`selectThread`) 보낸다. 실패는 화면이 쓰는 실패 종류로 돌려준다.
 * 이미 만든 시험 대화와 기록은 지우지 않는다(대화에서 다시 보낼 수 있다).
 */
export async function sendTestPrompt(
  commands: Pick<Commands, "selectThread" | "sendTurn">,
  threadId: ThreadId,
  prompt: string,
  requestId: string,
): Promise<ActionOutcome<null>> {
  commands.selectThread(threadId);
  return outcomeOf(await commands.sendTurn(threadId, prompt, requestId));
}
