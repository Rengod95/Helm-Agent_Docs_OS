import { describe, expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { BeforeProviderRequestInput } from "../src/index.ts";
import { t, tape } from "../src/testing/index.ts";
import { createHarness } from "./support/harness.ts";

const ONE_TURN = tape("core-models/pipeline", [
  { role: "main", response: { type: "message", content: [t.text("ok")], stopReason: "stop" } },
]);

describe("before_provider_request_rerun_same_result", () => {
  test("a retried request calls the point again with the same key and gets the same result", async () => {
    const inputs: BeforeProviderRequestInput[] = [];
    const h = createHarness({
      tape: ONE_TURN,
      provider: { payloadAttempts: 2 },
      dispatcher: {
        beforeProviderRequest(input) {
          inputs.push(input);
          return Promise.resolve({ patched: true, original: input.payload });
        },
      },
    });
    await h.service.stream(h.request("hi")).result();
    expect(inputs).toHaveLength(2);
    expect(inputs[1]?.dispatchKey).toBe(inputs[0]?.dispatchKey);
    expect(inputs[1]?.payload).toEqual(inputs[0]?.payload);
    expect(h.fake.calls()[0]?.payload).toEqual({ patched: true, original: inputs[0]?.payload });
  });

  test("a second request gets a different key", async () => {
    const keys: string[] = [];
    const h = createHarness({
      tape: tape("core-models/pipeline-two", [
        { role: "main", response: { type: "message", content: [t.text("1")], stopReason: "stop" } },
        { role: "main", response: { type: "message", content: [t.text("2")], stopReason: "stop" } },
      ]),
      dispatcher: {
        beforeProviderRequest(input) {
          keys.push(input.dispatchKey);
          return Promise.resolve(input.payload);
        },
      },
    });
    await h.service.stream(h.request("a")).result();
    await h.service.stream(h.request("b")).result();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("before_provider_request input", () => {
  test("carries thread, provider, model, role and the key anchored at the step", async () => {
    const inputs: BeforeProviderRequestInput[] = [];
    const h = createHarness({
      tape: ONE_TURN,
      dispatcher: {
        beforeProviderRequest(input) {
          inputs.push(input);
          return Promise.resolve(input.payload);
        },
      },
    });
    const stepId = fixedIdFactory(200).next("stp");
    await h.service.stream(h.request("hi", "main", { stepId })).result();
    expect(inputs[0]).toMatchObject({
      threadId: h.threadId,
      provider: "tape",
      modelId: "tape-1",
      role: "main",
      dispatchKey: `${stepId}:before_provider_request:1`,
    });
    expect(inputs[0]?.payload).toMatchObject({ model: "tape-1" });
  });

  test("without a dispatcher the payload is sent unchanged", async () => {
    const h = createHarness({ tape: ONE_TURN });
    await h.service.stream(h.request("hi")).result();
    expect(h.fake.calls()[0]?.payload).toMatchObject({ model: "tape-1" });
  });

  test("a failing dispatcher ends the call with a provider error and still records the call", async () => {
    const h = createHarness({
      tape: ONE_TURN,
      dispatcher: { beforeProviderRequest: () => Promise.reject(new Error("handler exploded")) },
    });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("handler exploded");
    expect(h.service.usage.totals({ threadId: h.threadId }).calls).toBe(1);
  });
});
