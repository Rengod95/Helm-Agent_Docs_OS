import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import { WIRE_METHODS, classifyMethodName } from "../../src/wire-settings/wire/index.ts";

// blocks.applied(M5e-2, 스펙 §4.9): 대화(또는 프로필)에 적용된 블록 구성의 읽기.
describe("blocks.applied wire method", () => {
  const spec = WIRE_METHODS["blocks.applied"];

  test("it is an M4 core read next to blocks.describe; params are threadId and profileId, both optional", () => {
    expect(classifyMethodName("blocks.applied")).toBe("core");
    expect(spec.stage).toBe("M4");
    expect(parse(spec.params, {}).ok).toBe(true);
    expect(parse(spec.params, { threadId: "thr_1" }).ok).toBe(true);
    expect(parse(spec.params, { profileId: "writer" }).ok).toBe(true);
    expect(parse(spec.params, { threadId: "" }).ok).toBe(false);
    expect(parse(spec.params, { other: 1 }).ok).toBe(false);
  });

  test("the result round-trips and rejects a bad setting source", () => {
    const result = {
      profileId: "default",
      blocks: [
        {
          id: "tools",
          settings: [{ key: "l1.tools.pluginCallDepth", value: 3, source: "profile" }],
          parts: [{ id: "tool:edit", current: "my-edit", replacedBy: "core" }],
          handlers: [{ hook: "tool.call.before", plugin: "core-tools", order: 0 }],
        },
      ],
    } as const;
    const parsed = parse(spec.result, result);
    expect(parsed).toEqual({ ok: true, value: result });
    const badSource = {
      profileId: "default",
      blocks: [
        {
          id: "tools",
          settings: [{ key: "k", value: 1, source: "thread" }],
          parts: [],
          handlers: [],
        },
      ],
    };
    expect(parse(spec.result, badSource).ok).toBe(false);
  });
});
