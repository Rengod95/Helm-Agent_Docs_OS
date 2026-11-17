import { describe, expect, test } from "bun:test";
import { err, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  ModelsComplete,
  ModelsCompleteKey,
  validateCapability,
  type PluginModelError,
  type PluginModelResult,
} from "@fresnel/contracts/capabilities";
import type { ModelService } from "@fresnel/contracts/services";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { t, tape } from "../src/testing/index.ts";
import { modelsCompleteOf } from "../src/complete-capability.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// hooks-core-boundary §6.2 D-30. 공개 기능 `models.complete`는 `completeForPlugin`을 감싼다. 텍스트와 사용량을 값으로 돌려주고,
// 실패는 종류에 맞는 공통 기능 오류로 거부한다.

const JUDGE_ONCE = tape("core-models/capability-judge", [
  {
    role: "judge",
    response: {
      type: "message",
      content: [t.text("met")],
      stopReason: "stop",
      usage: { input: 6, output: 4 },
    },
  },
]);

const JUDGE_PROVIDER = { roleOf: () => "judge" as const };

const MESSAGES = [
  { role: "system" as const, content: "Judge." },
  { role: "user" as const, content: "Is it done?" },
];

/** 호출 문맥. 확장 이름이 호출자 identity다 */
function optionsOf(requestId: string, threadId: Harness["threadId"], extension?: string) {
  return {
    requestId,
    context: {
      threadId,
      caller:
        extension === undefined
          ? { kind: "host" as const }
          : { kind: "extension" as const, extension },
    },
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<CapabilityError> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof CapabilityError) return caught;
    throw caught;
  }
  throw new Error("expected the call to reject with a CapabilityError");
}

/** 호출마다 같은 오류를 돌려주는 서비스 대역. 오류 종류와 공통 코드의 대응을 값으로 본다 */
function failingService(error: PluginModelError): Pick<ModelService, "completeForPlugin"> {
  return {
    completeForPlugin: async (): Promise<Result<PluginModelResult, PluginModelError>> => err(error),
  };
}

describe("models.complete capability", () => {
  test("the definition validates and the provider key matches the definition", () => {
    expect(validateCapability(ModelsComplete)).toEqual([]);
    expect(ModelsCompleteKey).toEqual({ capability: "models.complete", version: "1.0.0" });
  });

  test("a call through the provider returns the text, usage and stop reason that completeForPlugin returns, and attributes the usage to the caller", async () => {
    const viaCapability = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });
    const direct = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });

    const value = await modelsCompleteOf(viaCapability.service).complete(
      { threadId: viaCapability.threadId, messages: MESSAGES },
      optionsOf("m-1", viaCapability.threadId, "judge-group"),
    );
    const reference = await direct.service.completeForPlugin({
      threadId: direct.threadId,
      plugin: { name: "judge-group", scopeId: "judge-group" },
      requestId: "m-1",
      messages: MESSAGES,
    });

    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    expect(value).toEqual({
      text: reference.value.text,
      usage: reference.value.usage,
      stopReason: reference.value.stopReason,
    });
    expect(value).toEqual({
      text: "met",
      usage: { input: 6, output: 4, total: 10 },
      stopReason: "stop",
    });
    expect(
      viaCapability.service.usage.totals({
        threadId: viaCapability.threadId,
        role: "judge",
        scopeId: "judge-group",
      }),
    ).toMatchObject({ calls: 1, totalTokens: 10 });
  });

  test("a fresh call charges its tokens once through the charge hook, and a replayed call charges nothing", async () => {
    const h = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });
    const charged: [string, number][] = [];
    const provider = modelsCompleteOf(h.service, (threadId, tokens) => {
      charged.push([threadId, tokens]);
    });
    const input = { threadId: h.threadId, messages: MESSAGES };
    await provider.complete(input, optionsOf("m-charge", h.threadId, "judge-group"));
    await provider.complete(input, optionsOf("m-charge", h.threadId, "judge-group"));
    // 같은 (범위, 요청 id)의 두 번째 호출은 재생이라 제공자를 다시 부르지 않고 토큰도 다시 빼지 않는다
    expect(charged).toEqual([[h.threadId, 10]]);
  });

  test("a call with no extension identity is refused as invalid_input before any model call", async () => {
    const h = createHarness({ tape: JUDGE_ONCE, provider: JUDGE_PROVIDER });
    const refused = await rejectionOf(
      modelsCompleteOf(h.service).complete(
        { threadId: h.threadId, messages: MESSAGES },
        optionsOf("m-2", h.threadId),
      ),
    );
    expect(refused.data).toMatchObject({
      capability: "models.complete",
      method: "complete",
      code: "invalid_input",
      retryable: false,
    });
    // 거부된 호출은 제공자를 부르지 않는다
    expect(h.fake.calls()).toHaveLength(0);
  });

  test("provider errors map to the common capability codes, and the provider kind stays in detail", async () => {
    const threadId = fixedIdFactory().next("thr");
    const cases: readonly [PluginModelError["kind"], string, boolean][] = [
      ["aborted", "aborted", false],
      ["denied_by_guard", "denied", false],
      ["rate_limited", "rate_limited", true],
      ["overloaded", "upstream_error", true],
      ["no_model_for_role", "unavailable", false],
      ["auth", "upstream_error", false],
    ];
    const observed = await Promise.all(
      cases.map(async ([kind]) => {
        const refused = await rejectionOf(
          modelsCompleteOf(failingService({ kind, message: `failed: ${kind}` })).complete(
            { threadId, messages: MESSAGES },
            optionsOf(`m-${kind}`, threadId, "x"),
          ),
        );
        return {
          kind,
          code: refused.data.code,
          retryable: refused.data.retryable,
          detail: refused.data.detail,
        };
      }),
    );
    expect(observed).toEqual(
      cases.map(([kind, code, retryable]) => ({ kind, code, retryable, detail: { kind } })),
    );
  });
});
