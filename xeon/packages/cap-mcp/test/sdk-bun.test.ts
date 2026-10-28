import { describe, expect, test } from "bun:test";
import { connectMcp } from "../src/adapter.ts";
import { captureLogger } from "./support/logger.ts";
import { createStubServer } from "../src/testing/stub-server.ts";

const signal = new AbortController().signal;
const client = { name: "xeon-test", version: "0.0.0" };
const logger = captureLogger();

describe("sdk under bun", () => {
  test("legacy handshake over memory transport", async () => {
    const stub = createStubServer({ era: "legacy", tools: [{ name: "echo" }] });
    const connected = await connectMcp({
      transport: stub.connect(),
      negotiation: "legacy",
      connectTimeoutMs: 5000,
      signal,
      client,
      logger,
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.value.protocolVersion).toBe("2025-11-25");
    const tools = await connected.value.listTools({ signal, timeoutMs: 5000 });
    expect(tools.ok && tools.value.map((tool) => tool.name)).toEqual(["echo"]);
    await connected.value.close();
  });

  test("auto negotiation selects 2026 on a modern stub", async () => {
    const stub = createStubServer({ era: "modern", tools: [{ name: "echo" }] });
    const connected = await connectMcp({
      transport: stub.connect(),
      negotiation: "auto",
      connectTimeoutMs: 5000,
      signal,
      client,
      logger,
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    expect(connected.value.protocolVersion).toBe("2026-07-28");
    const tools = await connected.value.listTools({ signal, timeoutMs: 5000 });
    expect(tools.ok && tools.value.map((tool) => tool.name)).toEqual(["echo"]);
    await connected.value.close();
  });
});
