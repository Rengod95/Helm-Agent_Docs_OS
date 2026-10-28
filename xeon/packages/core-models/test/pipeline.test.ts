import { describe, expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { BeforeProviderRequestInput, ProviderDispatcher } from "../src/index.ts";
import { spyDispatcher } from "./support/dispatcher.ts";
import { t, tape } from "../src/testing/index.ts";
import { createHarness, FAKE_KEY } from "./support/harness.ts";
import { memoryLogger, type LogLine } from "./support/logger.ts";

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
      dispatchKey: `${stepId}:request.provider.before:1`,
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

describe("request_points_remaining_five_fire", () => {
  test("before_provider_headers, request.provider.after and request.stream fire once per request", async () => {
    const spy = spyDispatcher();
    const h = createHarness({
      tape: ONE_TURN,
      dispatcher: spy.dispatcher,
      provider: {
        response: { status: 200, headers: { "Content-Type": "application/json" } },
        rawEvents: [
          { type: "chunk", n: 1 },
          { type: "chunk", n: 2 },
        ],
      },
    });
    // 헤더 지점을 쓰려면 등록부 헤더나 provider 헤더가 있어야 pi-ai가 transformHeaders를 부른다
    await h.service.stream(h.request("hi")).result();
    expect(spy.headers).toHaveLength(1);
    expect(spy.responses).toHaveLength(1);
    expect(spy.responses[0]).toMatchObject({
      provider: "tape",
      modelId: "tape-1",
      role: "main",
      status: 200,
      headers: { "content-type": "application/json" },
    });
    expect(spy.rawEvents.map((event) => event.data)).toEqual([
      { type: "chunk", n: 1 },
      { type: "chunk", n: 2 },
    ]);
    expect(spy.rawEvents[0]).toMatchObject({
      provider: "tape",
      api: "tape-messages",
      model: "tape-1",
    });
    // 이벤트마다 키가 다르다
    expect(new Set(spy.rawEvents.map((event) => event.dispatchKey)).size).toBe(2);
  });

  test("a request.headers.before patch reaches the request and null removes a header", async () => {
    const spy = spyDispatcher((headers) => {
      const { "x-remove": _removed, ...rest } = headers;
      return { ...rest, "x-added": "yes" };
    });
    const h = createHarness({ tape: ONE_TURN, dispatcher: spy.dispatcher });
    h.service.addProvider("ext.test", "tape", {
      kind: "config",
      headers: { "x-keep": "1", "x-remove": "2" },
    });
    await h.service.stream(h.request("hi")).result();
    const sent = h.fake.calls()[0]?.headers;
    expect(sent).toMatchObject({ "x-keep": "1", "x-added": "yes", "x-remove": null });
  });

  test("the request keeps going when a select point handler fails", async () => {
    const spy = spyDispatcher();
    const failing: ProviderDispatcher = {
      ...spy.dispatcher,
      modelSelect: () => Promise.reject(new Error("boom")),
    };
    const h = createHarness({ tape: ONE_TURN, dispatcher: failing });
    const message = await h.service.stream(h.request("hi")).result();
    expect(message.stopReason).toBe("stop");
  });
});

describe("headers_point_payload_masks_secret_values", () => {
  test("auth headers and secret-resolved headers are masked for handlers but sent as is", async () => {
    const spy = spyDispatcher();
    const h = createHarness({ tape: ONE_TURN, dispatcher: spy.dispatcher });
    h.service.addProvider("ext.test", "tape", {
      kind: "config",
      headers: {
        "x-org": "secret://tape-key",
        authorization: "secret://tape-key",
        "x-team": "core",
      },
    });
    await h.service.stream(h.request("hi")).result();
    const seen = spy.headers[0]?.headers;
    expect(seen).toMatchObject({
      "x-org": "[secret]",
      authorization: "[secret]",
      "x-team": "core",
    });
    expect(JSON.stringify(spy.headers)).not.toContain(FAKE_KEY);
    // 핸들러가 바꾸지 않으면 실제 요청에는 해석한 값이 그대로 나간다
    expect(h.fake.calls()[0]?.headers).toMatchObject({
      "x-org": FAKE_KEY,
      authorization: FAKE_KEY,
      "x-team": "core",
    });
  });

  test("a handler that rewrites an auth header is ignored and logged without the value", async () => {
    const lines: LogLine[] = [];
    const spy = spyDispatcher((headers) => ({ ...headers, authorization: "Bearer injected" }));
    const h = createHarness({
      tape: ONE_TURN,
      dispatcher: spy.dispatcher,
      logger: memoryLogger(lines),
    });
    h.service.addProvider("ext.test", "tape", {
      kind: "config",
      headers: { authorization: "secret://tape-key" },
    });
    await h.service.stream(h.request("hi")).result();
    expect(h.fake.calls()[0]?.headers).toMatchObject({ authorization: FAKE_KEY });
    expect(JSON.stringify(h.fake.calls()[0]?.headers)).not.toContain("injected");
    expect(lines.some((line) => line.event === "model.auth_header_patch_ignored")).toBe(true);
    expect(JSON.stringify(lines)).not.toContain(FAKE_KEY);
  });
});
