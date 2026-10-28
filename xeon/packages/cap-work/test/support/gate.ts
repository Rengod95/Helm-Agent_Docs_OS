import { Bug } from "@xeon/contracts";
import type {
  AgentBeforeSettlePayload,
  BoundaryPatch,
  HandlerContext,
} from "@xeon/contracts/extensions";
import type { AgentMessage, StepId, TurnId } from "@xeon/contracts/conversation";
import type { DurableEventDraft } from "@xeon/contracts/records";
import type { JudgeInput, JudgeOutcome } from "@xeon/contracts/services";
import { createSettleGate } from "../../src/goals/gate.ts";
import type { Harness } from "./harness.ts";
import { usage } from "./goals.ts";

// 완료 게이트(`boundary.settle.before` 핸들러) 시험 장치. 가짜 판정 서비스는 정해 둔 답을 차례로 돌려주고 부른 입력을 기록한다.

export type JudgeScript = readonly (JudgeOutcome | Error)[] | "absent";

export interface GateOptions {
  /** 판정 호출이 답하기 전에 부른다. 판정하는 동안 일어나는 일을 흉내 낸다 */
  readonly beforeAnswer?: () => Promise<unknown>;
  /** false면 `boundary.step.after`가 단계 id를 알려 주지 않은 것처럼 한다 */
  readonly rememberStep?: boolean;
}

export interface GateRig {
  readonly calls: JudgeInput[];
  readonly turnId: TurnId;
  readonly stepId: StepId;
  /** turn 정착 직전의 호출. 이번 turn의 메시지는 어시스턴트 텍스트, 성공한 도구 호출 하나, 오류인 도구 호출 하나다 */
  settle(overrides?: {
    readonly outcome?: AgentBeforeSettlePayload["outcome"];
    readonly entries?: readonly DurableEventDraft[];
  }): Promise<BoundaryPatch | undefined>;
  /** 다른 핸들러가 이미 낸 엔트리 하나 */
  noticeEntry(): DurableEventDraft;
}

const SILENT = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
  child() {
    return SILENT;
  },
};

export function gateAnswers(h: Harness, script: JudgeScript, options: GateOptions = {}): GateRig {
  const calls: JudgeInput[] = [];
  const answers = script === "absent" ? [] : [...script];
  const agents =
    script === "absent"
      ? undefined
      : {
          async judge(input: JudgeInput): Promise<JudgeOutcome> {
            calls.push(input);
            await options.beforeAnswer?.();
            const next = answers.shift();
            if (next === undefined) throw new Bug("the judge script is empty");
            if (next instanceof Error) throw next;
            return next;
          },
        };
  const gate = createSettleGate({
    goals: h.goalsRuntime,
    reader: h.store.service.scoped("cap.work"),
    agents: () => agents,
    ids: h.ids,
    clock: h.clock,
    logger: SILENT,
  });
  const turnId = h.ids.next("trn");
  const stepId = h.ids.next("stp");
  const ctx: HandlerContext<unknown> = {
    scopeId: "cap-work",
    state: {},
    threadId: h.threadId,
    signal: new AbortController().signal,
  };
  const timestamp = h.clock.now();
  const messages: AgentMessage[] = [
    { role: "user", content: "finish the work", timestamp },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I finished the work." },
        { type: "toolCall", id: "c1", name: "bash", arguments: {} },
        { type: "toolCall", id: "c2", name: "read", arguments: {} },
      ],
      api: "test",
      provider: "test",
      model: "test",
      usage: usage(1, 1, 0),
      stopReason: "stop",
      timestamp,
    },
    {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "bash",
      content: [{ type: "text", text: "done" }],
      isError: false,
      timestamp,
    },
    {
      role: "toolResult",
      toolCallId: "c2",
      toolName: "read",
      content: [{ type: "text", text: "no such file" }],
      isError: true,
      timestamp,
    },
  ];
  const entryOf = (customType: string, text: string): DurableEventDraft => ({
    id: h.ids.next("evt"),
    kind: "item.recorded",
    version: 1,
    threadId: h.threadId,
    turnId,
    stepId,
    causationId: null,
    correlationId: null,
    durable: true,
    payload: {
      item: {
        itemId: h.ids.next("itm"),
        status: "completed",
        kind: "custom",
        message: {
          role: "custom",
          customType,
          content: text,
          display: true,
          details: null,
          timestamp,
        },
      },
    },
  });
  return {
    calls,
    turnId,
    stepId,
    noticeEntry: () => entryOf("x.other.note", "another handler"),
    async settle(overrides = {}) {
      if (options.rememberStep !== false) gate.rememberStep(stepId, h.threadId);
      const payload: AgentBeforeSettlePayload = {
        turnId,
        outcome: overrides.outcome ?? "completed",
        context: {
          contextMessages: messages,
          llmMessages: [],
          pendingMessages: [],
          canContinue: true,
        },
      };
      return await gate.settle(
        payload,
        { entries: [...(overrides.entries ?? [])], continue: false },
        ctx,
      );
    },
  };
}
