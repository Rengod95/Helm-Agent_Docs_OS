import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@xeon/contracts/conversation";
import { classifyMessage } from "../src/classify.ts";

function message(
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
  usage: Partial<AssistantMessage["usage"]> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      ...usage,
    },
    stopReason,
    timestamp: 0,
    ...(errorMessage === undefined ? {} : { errorMessage }),
  };
}

// L1.models.plan §5 classify_error_kinds
describe("classify_error_kinds", () => {
  test("aborted wins over everything", () => {
    expect(classifyMessage(message("aborted", "429 rate limit"))).toBe("aborted");
  });

  test("a context overflow message is context_overflow", () => {
    const overflow = message("error", "prompt is too long: 250000 tokens > 200000 maximum");
    expect(classifyMessage(overflow, 200_000)).toBe("context_overflow");
  });

  test("a message that is not an error is null", () => {
    expect(classifyMessage(message("stop"))).toBeNull();
    expect(classifyMessage(message("toolUse"))).toBeNull();
  });

  test("a limit that pi-ai will not retry is quota_exhausted, even with a 429 status", () => {
    expect(classifyMessage(message("error", "429 insufficient_quota"))).toBe("quota_exhausted");
    expect(classifyMessage(message("error", "You are out of budget for this month"))).toBe(
      "quota_exhausted",
    );
  });

  test("429 and rate-limit wording are rate_limited", () => {
    expect(classifyMessage(message("error", '429 {"type":"rate_limit_error"}'))).toBe(
      "rate_limited",
    );
    expect(classifyMessage(message("error", "Too many requests"))).toBe("rate_limited");
  });

  test("529, 503 and overloaded wording are overloaded", () => {
    expect(classifyMessage(message("error", "529 overloaded_error"))).toBe("overloaded");
    expect(classifyMessage(message("error", "503 service unavailable"))).toBe("overloaded");
  });

  test("401 and 403 are auth", () => {
    expect(classifyMessage(message("error", "401 invalid x-api-key"))).toBe("auth");
    expect(classifyMessage(message("error", "403 Forbidden"))).toBe("auth");
  });

  test("connection failures are transport", () => {
    expect(classifyMessage(message("error", "fetch failed"))).toBe("transport");
    expect(classifyMessage(message("error", "connect ECONNREFUSED 127.0.0.1:443"))).toBe(
      "transport",
    );
    expect(classifyMessage(message("error", "request timed out"))).toBe("transport");
  });

  test("anything else is provider_error", () => {
    expect(classifyMessage(message("error", "400 invalid_request_error: bad tool schema"))).toBe(
      "provider_error",
    );
    expect(classifyMessage(message("error"))).toBe("provider_error");
  });

  test("messages that this gateway made itself carry their kind as a prefix", () => {
    expect(
      classifyMessage(message("error", "provider_unavailable: provider x is not available")),
    ).toBe("provider_unavailable");
    expect(
      classifyMessage(message("error", "secret_unresolved: secret a could not be leased")),
    ).toBe("secret_unresolved");
    expect(
      classifyMessage(message("error", "model_not_found: model x/y is not in the catalog")),
    ).toBe("model_not_found");
  });
});
