import { describe, expect, test } from "bun:test";
import { formatModelRef, parseModelRef } from "@xeon/contracts/services";

// L1.models.plan §5 parse_model_ref_suffix_rules. parseModelRef 구현은 F에 있고 이 패키지가 쓰는 규칙을 확인한다.
describe("parse_model_ref_suffix_rules", () => {
  test("a thinking level suffix is split off", () => {
    expect(parseModelRef("anthropic/claude-x:high")).toEqual({
      ok: true,
      value: { provider: "anthropic", modelId: "claude-x", thinkingLevel: "high" },
    });
  });

  test("a numeric suffix such as :0 stays in the model id", () => {
    expect(parseModelRef("bedrock/anthropic.claude-x-v1:0")).toEqual({
      ok: true,
      value: { provider: "bedrock", modelId: "anthropic.claude-x-v1:0", thinkingLevel: null },
    });
  });

  test("a slash inside the model id is allowed", () => {
    const parsed = parseModelRef("openrouter/anthropic/claude-x");
    expect(parsed).toEqual({
      ok: true,
      value: { provider: "openrouter", modelId: "anthropic/claude-x", thinkingLevel: null },
    });
  });

  test("a reference without a slash is malformed", () => {
    expect(parseModelRef("anthropic")).toEqual({
      ok: false,
      error: { kind: "malformed", input: "anthropic" },
    });
  });

  test("format is the inverse of parse", () => {
    const ref = "anthropic/claude-x:high";
    const parsed = parseModelRef(ref);
    expect(parsed.ok && formatModelRef(parsed.value)).toBe(ref);
  });
});
