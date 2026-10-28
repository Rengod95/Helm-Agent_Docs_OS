import type { Goal, WorkTask } from "@xeon/contracts/capabilities";
import type { AgentMessage } from "@xeon/contracts/conversation";
import type { JudgeEvidence } from "@xeon/contracts/services";
import type { JudgmentRow } from "../projection/read.ts";

// L2.work.spec §4.3.3 GoalEvidence → L1.agents JudgeInput.evidence. 판정 모델은 증거를 데이터로만 읽는다.
// 증거는 turn이 정착하기 직전의 컨텍스트 미리보기(`boundary.settle.before`의 payload)에서 모은다.

const MAX_FINAL_TEXT = 8000;
const MAX_TOOL_CALLS = 50;
const MAX_TASKS = 50;
const MAX_PREVIOUS = 3;

/** 이번 turn의 메시지: 마지막 사용자 메시지 뒤 전부 */
function currentTurn(messages: readonly AgentMessage[]): readonly AgentMessage[] {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  return messages.slice(lastUser + 1);
}

function textOf(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** 이번 turn의 마지막 어시스턴트 텍스트. 앞에서 8,000자까지 */
function finalTextOf(messages: readonly AgentMessage[]): string {
  const assistant = currentTurn(messages).findLast((message) => message.role === "assistant");
  return assistant === undefined ? "" : textOf(assistant).slice(0, MAX_FINAL_TEXT);
}

/** 이번 turn의 도구 호출과 결과 상태. 호출 순서대로 최대 50개 */
function toolCallsOf(
  messages: readonly AgentMessage[],
): readonly { readonly name: string; readonly isError: boolean }[] {
  const turn = currentTurn(messages);
  const failed = new Set(
    turn.flatMap((message) =>
      message.role === "toolResult" && message.isError ? [message.toolCallId] : [],
    ),
  );
  return turn
    .flatMap((message) =>
      message.role === "assistant"
        ? message.content.flatMap((block) =>
            block.type === "toolCall" ? [{ name: block.name, isError: failed.has(block.id) }] : [],
          )
        : [],
    )
    .slice(0, MAX_TOOL_CALLS);
}

export interface EvidenceInput {
  readonly messages: readonly AgentMessage[];
  readonly tasks: readonly WorkTask[];
  readonly previous: readonly JudgmentRow[];
}

export function evidenceOf(input: EvidenceInput): readonly JudgeEvidence[] {
  const evidence: JudgeEvidence[] = [];
  const finalText = finalTextOf(input.messages);
  if (finalText !== "") evidence.push({ kind: "assistant_text", text: finalText });
  for (const call of toolCallsOf(input.messages)) {
    evidence.push({ kind: "tool_result", text: `${call.name}: ${call.isError ? "error" : "ok"}` });
  }
  for (const task of input.tasks.slice(0, MAX_TASKS)) {
    evidence.push({
      kind: "work_item",
      text: `${task.id} [${task.status}] ${task.content}`,
      ref: { workRef: task.id },
    });
  }
  for (const row of input.previous.slice(-MAX_PREVIOUS)) {
    const { n, verdict } = row.judgment;
    if (verdict === null) continue;
    evidence.push({
      kind: "note",
      text: `previous judgment ${String(n)}: ${verdict.met ? "met" : "not met"}. ${verdict.reason}`,
    });
  }
  return evidence;
}

/** 모델 판정자의 기준 문장. `rubric`이 비면 조건 문장만으로 판정한다 */
export function criteriaOf(goal: Goal): readonly string[] {
  return goal.judge.kind === "model" ? (goal.judge.rubric ?? []) : [];
}
