import { assertNever } from "@xeon/contracts";
import type { ToolRunContext } from "@xeon/contracts/services";
import type { ToolsUnattendedConfig } from "../settings.ts";

// L1.tools.spec §4.7 무인 승인 정책(M3-REQ-73, D-M3-12). 사람이 답할 수 없는 호출(`interactive: false`)의 승인 요청을 어떻게 다룰지 정한다.

/** `silent`면 요청과 거부를 한 커밋에 남기고 바로 거부한다. 아니면 기다리고, `timeoutAt`(epoch ms)에 만료한다(null이면 만료 없음) */
export type UnattendedPlan =
  | { readonly silent: true }
  | { readonly silent: false; readonly timeoutAt: number | null };

/**
 * 서브에이전트, 깊이가 있는 호출, 표면 대화가 다른 호출은 승인을 받아 줄 사람의 화면이 없으므로 바로 거부한다.
 * 주 대화의 비대화형 turn(예약·원격·drive)은 설정 `l1.tools.unattended.approval`을 따른다. 순수 함수.
 */
export function unattendedPlan(
  run: Pick<ToolRunContext, "caller" | "depth" | "threadId" | "surfaceThreadId">,
  policy: ToolsUnattendedConfig,
  now: number,
): UnattendedPlan {
  if (run.caller !== "main" || run.depth !== 0 || run.surfaceThreadId !== run.threadId) {
    return { silent: true };
  }
  switch (policy.approval) {
    case "deny":
      return { silent: true };
    case "wait":
      return { silent: false, timeoutAt: null };
    case "expire":
      return { silent: false, timeoutAt: now + policy.timeoutSeconds * 1000 };
    default:
      return assertNever(policy.approval, "unattendedPlan");
  }
}
