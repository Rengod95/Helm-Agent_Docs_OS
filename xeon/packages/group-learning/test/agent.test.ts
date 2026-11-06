import { expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { AgentDefinitionSchema } from "@fresnel/contracts/services";
import { learningAgentDefinitions, REVIEW_AGENT_NAME } from "../src/review/agent.ts";
import { REVIEW_ALLOWED_TOOLS } from "../src/review/policy.ts";

// L3.learning.spec §3.1, §3.4. 검토 포크 정의는 조립 루트가 싣는 코드 정의다. 사람용 원본 `agents/learning-review.md`와 어긋나면 안 된다.

const MARKDOWN = new URL("../agents/learning-review.md", import.meta.url);

test("agent.definition-value: the review definition is named learning-review, uses the review role and the allowed tools", () => {
  const definitions = learningAgentDefinitions();
  expect(definitions).toHaveLength(1);
  expect(definitions[0]).toMatchObject({
    name: "learning-review",
    model: "review",
    source: { kind: "builtin" },
  });
  expect(definitions[0]?.tools).toEqual([...REVIEW_ALLOWED_TOOLS]);
  expect(REVIEW_AGENT_NAME).toBe("learning-review");
});

test("agent.definition-schema: the definition's fields pass the agent definition schema (source is added by the loader, not the schema)", () => {
  const definitions = learningAgentDefinitions();
  const definition = definitions[0];
  if (definition === undefined) throw new Error("the review definition is missing");
  const checked = parse(AgentDefinitionSchema, {
    name: definition.name,
    description: definition.description,
    prompt: definition.prompt,
    tools: definition.tools,
    model: definition.model,
  });
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(checked.value).toEqual({
    name: "learning-review",
    description: definition.description,
    prompt: definition.prompt,
    tools: [...REVIEW_ALLOWED_TOOLS],
    model: "review",
  });
});

test("agent.markdown-matches-code: agents/learning-review.md has the same name, description, model, tools and prompt", async () => {
  const definitions = learningAgentDefinitions();
  const definition = definitions[0];
  if (definition === undefined) throw new Error("the review definition is missing");
  const text = await Bun.file(MARKDOWN).text();
  // 프런트매터는 첫 "---"와 다음 "---" 사이다. 본문은 그 뒤 전부다
  const sections = text.split("\n---\n");
  const front = sections[0] ?? "";
  const body = sections.slice(1).join("\n---\n");
  const lines = front.split("\n").slice(1);
  const scalar = (key: string): string | undefined =>
    lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2);
  const tools = lines.filter((line) => line.startsWith("  - ")).map((line) => line.slice(4));

  expect(front.startsWith("---\n")).toBe(true);
  expect(scalar("name")).toBe(definition.name);
  expect(scalar("description")).toBe(definition.description);
  expect(scalar("model")).toBe("review");
  expect(tools).toEqual([...REVIEW_ALLOWED_TOOLS]);
  expect(body.trim()).toBe(definition.prompt.trim());
});
