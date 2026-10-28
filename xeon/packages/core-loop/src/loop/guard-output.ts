import { FIRST_DENY } from "@xeon/contracts/extensions";
import { attemptAsync } from "@xeon/contracts";
import type { AssistantMessage } from "@xeon/contracts/conversation";
import { dispatchKey, messageIdentity, currentStep, type TurnRun } from "./turn-run.ts";

// L1.loop.spec §4.11 `guard.output.before`(adr.0017 §3.6, M3-REQ-109). 사용자에게 보이는 최종 어시스턴트 답은 `boundary.message.after` 체인이 끝난 뒤,
// 커밋과 표시 전에 가드를 거친다. 가드는 값을 바꾸지 못하고 차단만 한다. 내장 검사는 없다.

/** 차단된 답 대신 기록·표시하는 문장 앞부분. 사유는 대화 기록에 남는다 */
const WITHHELD_PREFIX = "[xeon:withheld_by_guard]";

function textOf(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/**
 * 도구 호출이 없는 어시스턴트 답(turn을 끝내는 최종 답)의 텍스트를 `target: "display"`로 가드에 보인다. 차단이면 텍스트 블록을 사유 한 줄로 바꾼
 * 메시지를 돌려주고, 통과면 같은 메시지를 돌려준다. 디스패처 호출 자체의 실패도 차단이다(fail-closed).
 * 스트리밍 중 부분 출력에는 걸지 않는다(L1.loop.spec §4.11 [미결])
 */
export async function guardFinalOutput(
  run: TurnRun,
  message: AssistantMessage,
): Promise<AssistantMessage> {
  if (message.content.some((block) => block.type === "toolCall")) return message;
  const content = textOf(message);
  if (content === "") return message;
  const { ctx, threadId, turnId, scope } = run;
  const step = currentStep(run);
  const outcome = await attemptAsync(() =>
    ctx.ext.dispatch(
      "guard.output.before",
      { threadId, turnId, target: "display", content },
      {
        threadId,
        dispatchKey: dispatchKey(
          run,
          step.stepId,
          `guard.output.before:${messageIdentity(run, message)}`,
        ),
        signal: scope.signal,
      },
    ),
  );
  let reason: string;
  if (!outcome.ok) {
    ctx.logger.warn("loop.guard_output_dispatch_failed", { threadId, turnId });
    reason = FIRST_DENY["guard.output.before"].reason;
  } else if (outcome.value.decision === undefined) {
    return message;
  } else {
    reason = outcome.value.decision.reason;
  }
  const others = message.content.filter((block) => block.type !== "text");
  return {
    ...message,
    content: [...others, { type: "text", text: `${WITHHELD_PREFIX} ${reason}` }],
  };
}
