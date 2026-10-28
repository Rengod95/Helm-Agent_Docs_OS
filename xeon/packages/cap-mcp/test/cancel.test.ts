import { describe, expect, test } from "bun:test";
import type { StubOutcome } from "../src/testing/stub-server.ts";
import { flush } from "./support/flush.ts";
import { rejection } from "./support/rejection.ts";
import { buildWorld, startWorld } from "./support/world.ts";

const hang = {
  name: "hang",
  handle: (): StubOutcome => ({ kind: "never" }),
};

describe("cancellation and timeouts", () => {
  test("aborting a call sends notifications/cancelled and reports aborted", async () => {
    const world = buildWorld({ servers: { stub: { stub: { era: "modern", tools: [hang] } } } });
    await startWorld(world);
    const controller = new AbortController();
    const call = world.runtime.service.client.callTool(
      { server: "stub", tool: "hang", arguments: {} },
      { signal: controller.signal },
    );
    await flush();
    controller.abort();
    const failure = await rejection(call);
    expect(failure).toMatchObject({ data: { code: "aborted" } });
    await flush();
    expect(world.stubs["stub"]?.requests.map((request) => request.method)).toContain(
      "notifications/cancelled",
    );
    await world.runtime.shutdown();
  });

  test("a call that outlives callTimeoutMs times out", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [hang] } } },
      user: { callTimeoutMs: 1000 },
    });
    await startWorld(world);
    const failure = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "hang", arguments: {} }),
    );
    expect(failure).toMatchObject({ data: { code: "timeout", retryable: true } });
    await world.runtime.shutdown();
  }, 10000);

  test("a server rpc error becomes upstream_error with the code", async () => {
    const failing = {
      name: "bad",
      handle: (): StubOutcome => ({ kind: "rpc_error", code: -32602, message: "bad arguments" }),
    };
    const world = buildWorld({ servers: { stub: { stub: { era: "modern", tools: [failing] } } } });
    await startWorld(world);
    const failure = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "bad", arguments: {} }),
    );
    expect(failure).toMatchObject({
      data: { code: "upstream_error", detail: { rpcCode: -32602 } },
    });
    await world.runtime.shutdown();
  });
});
