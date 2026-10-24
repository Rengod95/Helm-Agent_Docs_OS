import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@xeon/core-models/testing";
import type { AgentDefinition } from "@xeon/contracts/services";
import { realTapeClock } from "./tape-host.ts";
import type { AssembleOptions } from "../../src/types.ts";

// 서브에이전트를 부르는 모델 테이프: 주 대화가 agent 도구를 부르고, 자식이 보고하고, 주 대화가 마무리한다.

export const EXPLORER: AgentDefinition = {
  name: "explorer",
  description: "Looks things up and reports back.",
  prompt: "You explore and report in one short paragraph.",
  tools: ["read", "ls"],
  source: { kind: "builtin" },
};

export const CHILD_REPORT = "the child found it";

export function delegatingModels(id: string): NonNullable<AssembleOptions["buildModels"]> {
  return tapeBuildModels(
    tapeProvider(
      tapePlayer(
        tape(id, [
          {
            role: "main",
            label: "delegates to the explorer",
            response: {
              type: "message",
              content: [
                t.toolCall("agent", { agent: "explorer", task: "find the thing" }, "call_1"),
              ],
              stopReason: "toolUse",
            },
          },
          {
            role: "main",
            label: "the child reports (subagent falls back to the main model)",
            response: { type: "message", content: [t.text(CHILD_REPORT)], stopReason: "stop" },
          },
          {
            role: "main",
            label: "the parent wraps up",
            response: { type: "message", content: [t.text("all done.")], stopReason: "stop" },
          },
        ]),
        { clock: realTapeClock() },
      ),
    ),
  );
}
