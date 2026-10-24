import { describe, expect, test } from "bun:test";
import { connectMcp } from "../src/adapter.ts";
import { createStubProcessPort } from "../src/testing/stub-process.ts";
import { createStubServer } from "../src/testing/stub-server.ts";
import { createTransportFactory } from "../src/transport/factory.ts";
import type { ServerDefinition } from "../src/types.ts";
import { flush } from "./support/flush.ts";
import { fixedClock, manualScheduler } from "./support/time.ts";
import { captureLogger } from "./support/logger.ts";

const signal = new AbortController().signal;
const definition: ServerDefinition = {
  id: "local",
  source: "settings:user",
  managed: false,
  requiresTrust: false,
  def: { transport: { type: "stdio", command: "srv", args: ["--x"] } },
};

function setup(ignore: readonly ("stdin_end" | "SIGTERM")[] = []) {
  const stub = createStubServer({ era: "legacy", tools: [{ name: "echo" }] });
  const process = createStubProcessPort(stub, { ignore });
  const scheduler = manualScheduler(fixedClock());
  const factory = createTransportFactory({
    process: process.port,
    secrets: undefined,
    scheduler,
    stdioGraceMs: 100,
    fetch: undefined,
  });
  return { stub, process, scheduler, factory };
}

async function connect(factory: ReturnType<typeof setup>["factory"]) {
  const opened = await factory.open(definition, signal);
  if (!opened.ok) throw new Error(`open failed: ${opened.error.message}`);
  const connected = await connectMcp({
    transport: opened.value.transport,
    negotiation: "legacy",
    connectTimeoutMs: 5000,
    signal,
    client: { name: "xeon-test", version: "0.0.0" },
    logger: captureLogger(),
  });
  if (!connected.ok) throw new Error(`connect failed: ${connected.error.message}`);
  return { connection: connected.value, opened: opened.value };
}

describe("process stdio transport", () => {
  test("speaks newline JSON-RPC over the child streams", async () => {
    const { factory, process } = setup();
    const { connection } = await connect(factory);
    const tools = await connection.listTools({ signal, timeoutMs: 5000 });
    expect(tools.ok && tools.value.map((tool) => tool.name)).toEqual(["echo"]);
    const called = await connection.callTool("echo", {}, { signal, timeoutMs: 5000 });
    expect(called.ok && called.value.kind).toBe("complete");
    expect(process.spawned[0]).toMatchObject({ command: "srv", args: ["--x"], label: "mcp:local" });
    await connection.close();
    // 정상 종료는 stdin을 닫아 끝나므로 신호가 필요 없다
    expect(process.signals).toEqual([]);
  });

  test("close escalates to SIGTERM and then SIGKILL after the grace period", async () => {
    const { factory, process, scheduler } = setup(["stdin_end", "SIGTERM"]);
    const { connection } = await connect(factory);
    const closing = connection.close();
    await flush();
    scheduler.advance(100);
    await flush();
    expect(process.signals).toEqual(["SIGTERM"]);
    scheduler.advance(100);
    await closing;
    expect(process.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("child exit closes the connection and keeps the stderr tail", async () => {
    const { factory, process } = setup();
    const { connection, opened } = await connect(factory);
    let closed = false;
    connection.onClose(() => {
      closed = true;
    });
    process.writeStderr("first line");
    process.writeStderr("fatal: out of cheese");
    await flush();
    process.crash();
    await flush();
    expect(closed).toBe(true);
    expect(opened.stderrTail()).toEqual(["first line", "fatal: out of cheese"]);
    const afterwards = await connection.listTools({ signal, timeoutMs: 1000 });
    expect(afterwards.ok).toBe(false);
  });

  test("spawn failures surface as open failures", async () => {
    const { factory, process } = setup();
    process.failNext({ kind: "secret_missing", ref: "secret://tok" });
    const failed = await factory.open(definition, signal);
    expect(failed).toEqual({
      ok: false,
      error: { code: "secret_missing", message: "secret_missing: secret://tok" },
    });
    const unsupported = await createTransportFactory({
      process: undefined,
      secrets: undefined,
      scheduler: manualScheduler(fixedClock()),
      stdioGraceMs: 1,
      fetch: undefined,
    }).open(definition, signal);
    expect(unsupported).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });
});
