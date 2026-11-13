import { expect, test } from "bun:test";
import { DialogAsk, toModelSchema } from "@fresnel/contracts/capabilities";
import type { AgentToolCall } from "@fresnel/contracts/conversation";
import { validateToolArguments } from "../src/validate.ts";

// F.capabilities.spec §4.3: 모델에게 보내는 구조에서 한도를 지워도 서버 검증은 정의의 원래 parameters로 한다.

const ask = DialogAsk.tools.find((spec) => spec.name === "ask_user");

function call(args: AgentToolCall["arguments"]): AgentToolCall {
  return { type: "toolCall", id: "c1", name: "ask_user", arguments: args };
}

test("limits removed from the model schema are still enforced on the arguments", () => {
  if (ask === undefined) throw new Error("ask_user is missing");
  const sent = JSON.stringify(toModelSchema(ask.parameters, "builtin"));
  expect(sent).not.toContain("maxLength");
  expect(sent).not.toContain("maxItems");
  expect(sent).not.toContain("pattern");

  const ok = validateToolArguments(
    ask.parameters,
    call({ questions: [{ id: "q1", question: "Why?" }] }),
  );
  expect(ok.ok).toBe(true);
  const longHeader = validateToolArguments(
    ask.parameters,
    call({ questions: [{ id: "q1", header: "x".repeat(17), question: "Why?" }] }),
  );
  expect(longHeader.ok).toBe(false);
  const badId = validateToolArguments(
    ask.parameters,
    call({ questions: [{ id: "Q 1", question: "Why?" }] }),
  );
  expect(badId.ok).toBe(false);
  const tooMany = validateToolArguments(
    ask.parameters,
    call({
      questions: Array.from({ length: 5 }, (_, i) => ({ id: `q${String(i)}`, question: "Why?" })),
    }),
  );
  expect(tooMany.ok).toBe(false);
});
