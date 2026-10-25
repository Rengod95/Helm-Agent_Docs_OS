import type { AssistantMessage, Context, ThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ModelRole } from "@xeon/contracts/services";

// 녹화 시나리오. 이름이 `just tape-record <scenario>`의 인자다. 프롬프트에 비밀을 넣지 않는다(키가 바뀌면 테이프가 남는다).
// 모델은 Haiku 5.5, 추론 수준은 xhigh로 고정한다(2026-10-25 사용자 지시). 출력 상한은 추론 토큰을 포함하므로 넉넉히 둔다.

interface ScenarioTurn {
  readonly role: ModelRole;
  readonly label: string;
  /** 앞 차례의 응답으로 이번 요청의 컨텍스트를 만든다 */
  readonly context: (previous: readonly AssistantMessage[]) => Context;
  readonly maxTokens: number;
}

export interface Scenario {
  readonly provider: "anthropic";
  readonly model: string;
  /** pi-ai 추론 수준. 모든 시나리오가 xhigh를 쓴다 */
  readonly reasoning: ThinkingLevel;
  /** 키를 읽는 환경 변수 이름 */
  readonly keyEnv: string;
  readonly turns: readonly ScenarioTurn[];
}

const SYSTEM = "You are a terse assistant. Answer in one short sentence.";

const READ_TOOL = {
  name: "read",
  description: "Read a text file and return its content.",
  parameters: Type.Object({ path: Type.String() }),
};

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  "hello-text": {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    reasoning: "xhigh",
    keyEnv: "ANTHROPIC_API_KEY",
    turns: [
      {
        role: "main",
        label: "one text answer",
        maxTokens: 16000,
        context: () => ({
          systemPrompt: SYSTEM,
          messages: [{ role: "user", content: "Say hello in five words or fewer.", timestamp: 1 }],
        }),
      },
    ],
  },
  "read-tool-call": {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    reasoning: "xhigh",
    keyEnv: "ANTHROPIC_API_KEY",
    turns: [
      {
        role: "main",
        label: "tool call",
        maxTokens: 16000,
        context: () => ({
          systemPrompt: `${SYSTEM} Use the read tool when asked about a file.`,
          messages: [{ role: "user", content: "What does the file notes.txt say?", timestamp: 1 }],
          tools: [READ_TOOL],
        }),
      },
    ],
  },
};
