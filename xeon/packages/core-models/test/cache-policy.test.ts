import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { CacheMarks, CachePolicy, Context } from "@xeon/contracts/services";
import { applyCacheMarks, buildCachePolicy, withRetention } from "../src/cache-policy.ts";
import { t, tape } from "../src/testing/index.ts";
import { createHarness } from "./support/harness.ts";
import { at } from "./support/json.ts";

function model(compat?: Record<string, boolean>): Model<Api> {
  return {
    id: "m",
    name: "m",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://example.invalid",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: 1000,
    maxTokens: 100,
    ...(compat === undefined ? {} : { compat }),
  };
}

describe("buildCachePolicy", () => {
  test("main, review and subagent keep the configured retention with a thread session key", () => {
    for (const role of ["main", "review", "subagent"] as const) {
      expect(buildCachePolicy(role, "short", model())).toMatchObject({
        retention: "short",
        sessionKey: "thread",
        sites: ["system", "tools", "summary", "tail"],
        maxBreakpoints: 4,
      });
    }
  });

  test("cache_policy_summary_role_none: summary, judge and search never cache", () => {
    for (const role of ["summary", "judge", "search"] as const) {
      expect(buildCachePolicy(role, "long", model())).toMatchObject({
        retention: "none",
        sessionKey: null,
        sites: [],
      });
    }
  });

  test("a configured retention of none disables the session key for every role", () => {
    expect(buildCachePolicy("main", "none", model())).toMatchObject({
      retention: "none",
      sessionKey: null,
    });
  });

  test("mid-conversation support is read from model.compat", () => {
    expect(buildCachePolicy("main", "short", model())).toMatchObject({
      midConversationSystem: false,
      midConversationToolChanges: false,
    });
    expect(
      buildCachePolicy("main", "short", model({ supportsMidConvoSystemMessages: true })),
    ).toMatchObject({ midConversationSystem: true, midConversationToolChanges: false });
    expect(
      buildCachePolicy(
        "main",
        "short",
        model({ supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true }),
      ),
    ).toMatchObject({ midConversationSystem: true, midConversationToolChanges: true });
    // 도구 변경만 지원하고 system 메시지를 지원하지 않으면 대화 중 도구 변경은 쓸 수 없다
    expect(
      buildCachePolicy("main", "short", model({ supportsMidConvoToolChanges: true })),
    ).toMatchObject({ midConversationToolChanges: false });
  });

  test("withRetention keeps the none roles at none whatever the call asks", () => {
    const base = buildCachePolicy("summary", "short", model());
    expect(withRetention(base, "summary", "long").retention).toBe("none");
    const main = buildCachePolicy("main", "short", model());
    expect(withRetention(main, "main", "long")).toMatchObject({ retention: "long" });
    expect(withRetention(main, "main", "none")).toMatchObject({
      retention: "none",
      sessionKey: null,
      sites: [],
    });
  });
});

const EPHEMERAL = { type: "ephemeral" };

function policy(maxBreakpoints: number): CachePolicy {
  return {
    retention: "short",
    sessionKey: "thread",
    sites: ["system", "tools", "summary", "tail"],
    maxBreakpoints,
    midConversationSystem: false,
    midConversationToolChanges: false,
  };
}

function context(): Context {
  return {
    messages: [
      { role: "system", content: "prefix", timestamp: 1 },
      { role: "user", content: "summary text", timestamp: 2 },
      { role: "user", content: "question", timestamp: 3 },
    ],
  };
}

/** pi-ai anthropic 어댑터가 만든 모양: 시스템 블록, 마지막 도구, 마지막 메시지에 표식 */
function payload(): Record<string, unknown> {
  return {
    system: [{ type: "text", text: "prefix", cache_control: EPHEMERAL }],
    tools: [{ name: "a" }, { name: "b", cache_control: EPHEMERAL }],
    messages: [
      { role: "user", content: [{ type: "text", text: "summary text" }] },
      { role: "user", content: [{ type: "text", text: "question", cache_control: EPHEMERAL }] },
    ],
  };
}

function marks(max: number, summaryIndex: number | null = 1): CacheMarks {
  return {
    policy: policy(max),
    marks: [
      { site: "system", messageIndex: null },
      { site: "tools", messageIndex: null },
      ...(summaryIndex === null ? [] : [{ site: "summary" as const, messageIndex: summaryIndex }]),
      { site: "tail", messageIndex: 2 },
    ],
  };
}

function markedMessages(p: unknown): boolean[] {
  const messages = at(p, "messages");
  if (!Array.isArray(messages)) return [];
  return messages.map(
    (_: unknown, index) => at(p, "messages", index, "content", 0, "cache_control") !== undefined,
  );
}

describe("applyCacheMarks", () => {
  test("adds the summary mark next to the three pi-ai marks (four in total)", () => {
    const result = applyCacheMarks(payload(), marks(4), context());
    expect(markedMessages(result)).toEqual([true, true]);
  });

  test("without a summary mark nothing is added", () => {
    const result = applyCacheMarks(payload(), marks(4, null), context());
    expect(markedMessages(result)).toEqual([false, true]);
  });

  test("a cap of 3 drops the tail mark first, a cap of 2 drops the summary mark too", () => {
    expect(markedMessages(applyCacheMarks(payload(), marks(3), context()))).toEqual([true, false]);
    const two = applyCacheMarks(payload(), marks(2), context());
    expect(markedMessages(two)).toEqual([false, false]);
    // system과 tools는 남는다
    expect(at(two, "system", 0, "cache_control")).toEqual(EPHEMERAL);
    expect(at(two, "tools", 1, "cache_control")).toEqual(EPHEMERAL);
  });

  test("applying twice gives the same payload (pi-ai retries call onPayload again)", () => {
    const once = JSON.stringify(applyCacheMarks(payload(), marks(4), context()));
    const twice = JSON.stringify(
      applyCacheMarks(applyCacheMarks(payload(), marks(4), context()), marks(4), context()),
    );
    expect(twice).toBe(once);
  });

  test("a string content becomes a text block carrying the mark", () => {
    const stringy = {
      messages: [
        { role: "user", content: "summary text" },
        { role: "user", content: "question" },
      ],
    };
    const result = applyCacheMarks(stringy, marks(4), context());
    expect(at(result, "messages")).toEqual([
      { role: "user", content: [{ type: "text", text: "summary text", cache_control: EPHEMERAL }] },
      { role: "user", content: "question" },
    ]);
  });

  test("an unrecognised payload is returned as is", () => {
    expect(applyCacheMarks("text", marks(4), context())).toBe("text");
    expect(applyCacheMarks({ other: 1 }, marks(4), context())).toEqual({ other: 1 });
  });

  test("a retention of none leaves the payload alone", () => {
    const none: CacheMarks = { ...marks(4), policy: { ...policy(4), retention: "none" } };
    expect(markedMessages(applyCacheMarks(payload(), none, context()))).toEqual([false, true]);
  });
});

describe("pipeline cache marks", () => {
  const ONE = tape("core-models/cache-marks", [
    { role: "main", response: { type: "message", content: [t.text("ok")], stopReason: "stop" } },
  ]);
  const twoMessages: Context = {
    messages: [
      { role: "user", content: "summary text", timestamp: 1 },
      { role: "user", content: "q", timestamp: 2 },
    ],
  };

  test("marks are applied to the payload of an anthropic-messages request", async () => {
    const h = createHarness({ tape: ONE, provider: { api: "anthropic-messages" } });
    const request = h.request("hi");
    await h.service
      .stream({ ...request, context: twoMessages, options: { cacheMarks: marks(4, 0) } })
      .result();
    // 테이프 provider의 페이로드는 Context.messages 그대로다. 첫 메시지(summary 위치)의 문자열이 표식 붙은 블록이 된다
    expect(at(h.fake.calls()[0]?.payload, "messages", 0, "content", 0, "cache_control")).toEqual(
      EPHEMERAL,
    );
  });

  test("another api ignores the marks", async () => {
    const h = createHarness({ tape: ONE });
    const request = h.request("hi");
    await h.service
      .stream({ ...request, context: twoMessages, options: { cacheMarks: marks(4, 0) } })
      .result();
    expect(JSON.stringify(h.fake.calls()[0]?.payload)).not.toContain("cache_control");
  });
});
