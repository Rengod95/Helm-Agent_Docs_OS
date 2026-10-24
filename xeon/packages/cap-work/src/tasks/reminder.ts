import type { WorkTask } from "@xeon/contracts/capabilities";
import type { CustomMessageDraft } from "@xeon/contracts/extensions";
import type { WorkMeta } from "../projection/read.ts";

// L2.work.spec §4.1.6. 작업 목록을 오래 갱신하지 않았을 때 다음 턴 시작에 붙이는 알림. 순수 함수이고 이벤트를 쓰지 않는다.

export const REMINDER_CUSTOM_TYPE = "x.cap-work.tasks.reminder";

const OPEN_LABEL: Readonly<Record<"pending" | "in_progress", string>> = {
  pending: "대기",
  in_progress: "진행 중",
};

/**
 * reminderTurns가 0이면 알림을 내지 않는다. pending 또는 in_progress 작업이 있고, 마지막 작업 변경 뒤
 * 완료된 턴이 reminderTurns 이상일 때 메시지 하나를 돌려준다.
 */
export function reminderMessage(
  tasks: readonly WorkTask[],
  meta: WorkMeta,
  reminderTurns: number,
): CustomMessageDraft | undefined {
  if (reminderTurns <= 0) return undefined;
  const idle = meta.turnsCompleted - meta.lastTaskChangeTurn;
  if (idle < reminderTurns) return undefined;
  const open = tasks.flatMap((task) =>
    task.status === "pending" || task.status === "in_progress"
      ? [`- ${task.id} [${OPEN_LABEL[task.status]}] ${task.content}`]
      : [],
  );
  if (open.length === 0) return undefined;
  return {
    customType: REMINDER_CUSTOM_TYPE,
    content:
      `작업 목록이 ${idle}턴 동안 갱신되지 않았습니다. 남은 작업:\n${open.join("\n")}\n` +
      "상태가 바뀌었다면 task_write로 갱신하세요.",
    display: false,
  };
}
