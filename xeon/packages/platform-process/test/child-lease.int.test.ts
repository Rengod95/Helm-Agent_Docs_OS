import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { attempt, parseJson } from "@xeon/contracts";
import type { Transport } from "@xeon/contracts/wire";
import { spawnFakeEngine } from "../src/testing/index.ts";
import { waitFor } from "./support/real-time.ts";

// L0.process.plan PR-05, L0.process.spec §4.2·§9 2·9. 자식 엔진 수명 임대와 shutdown 협조.

const PARENT = `${import.meta.dir}/fixtures/parent-of-engine.ts`;

function isAlive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0)).ok;
}

function nextMessage(transport: Transport, id: string): Promise<unknown> {
  return new Promise((resolve) => {
    const off = transport.onMessage((message) => {
      if (typeof message === "object" && message !== null && Reflect.get(message, "id") === id) {
        off();
        resolve(message);
      }
    });
  });
}

async function hello(transport: Transport): Promise<void> {
  const reply = nextMessage(transport, "r1");
  await transport.send({
    jsonrpc: "2.0",
    id: "r1",
    method: "host.hello",
    params: {
      protocolVersion: "0.1.0",
      client: { name: "lease-test", version: "0.0.0", kind: "other" },
    },
  });
  await reply;
}

describe("child engine lease", () => {
  test("stdin EOF triggers safe shutdown", async () => {
    const engine = await spawnFakeEngine();
    await engine.closeStdin();
    const exit = await engine.exited;
    expect(exit.code).toBe(0);
    expect(engine.events.map((event) => event.event)).toEqual([
      "ready",
      "participant_started",
      "participant_done",
      "exit",
    ]);
    expect(engine.events[1]).toEqual({ event: "participant_started", reason: "stdin_eof" });
    expect(engine.events[3]).toEqual({ event: "exit", code: 0 });
  });

  test("shutdown request is answered before exit", async () => {
    const engine = await spawnFakeEngine({ config: { participantDelayMs: 100 } });
    await hello(engine.client);
    const reply = nextMessage(engine.client, "r2");
    await engine.client.send({
      jsonrpc: "2.0",
      id: "r2",
      method: "host.shutdown",
      params: { reason: "client_exit" },
    });
    const response = await reply;
    // 응답은 참여자 처리가 끝난 뒤에 온다
    expect(response).toEqual({ jsonrpc: "2.0", id: "r2", result: { accepted: true } });
    expect(engine.events.map((event) => event.event)).toContain("participant_done");
    const exit = await engine.exited;
    expect(exit.code).toBe(0);
    expect(engine.events[1]).toEqual({ event: "participant_started", reason: "shutdown_request" });
  });

  test("a version replace request reaches the participants with its own reason", async () => {
    const engine = await spawnFakeEngine();
    await hello(engine.client);
    const reply = nextMessage(engine.client, "r2");
    await engine.client.send({
      jsonrpc: "2.0",
      id: "r2",
      method: "host.shutdown",
      params: { reason: "version_replace" },
    });
    await reply;
    await engine.exited;
    expect(engine.events[1]).toEqual({ event: "participant_started", reason: "version_replace" });
  });

  test("a participant that outlasts the deadline forces exit code 1", async () => {
    const engine = await spawnFakeEngine({
      config: { hangParticipant: true, shutdownTimeoutMs: 300 },
    });
    await engine.closeStdin();
    const exit = await engine.exited;
    expect(exit.code).toBe(1);
    const names = engine.events.map((event) => event.event);
    expect(names).toContain("participant_started");
    expect(names).not.toContain("participant_done");
    expect(engine.events.at(-1)).toEqual({ event: "exit", code: 1 });
  });

  test("a participant that finishes within the deadline exits 0", async () => {
    const engine = await spawnFakeEngine({
      config: { participantDelayMs: 150, shutdownTimeoutMs: 2000 },
    });
    await engine.closeStdin();
    expect((await engine.exited).code).toBe(0);
  });

  test("a second shutdown request while shutting down shares the first run", async () => {
    const engine = await spawnFakeEngine({ config: { participantDelayMs: 200 } });
    await hello(engine.client);
    await engine.client.send({
      jsonrpc: "2.0",
      id: "r2",
      method: "host.shutdown",
      params: { reason: "user" },
    });
    // 응답 전에 EOF가 겹쳐도 참여자는 한 번만 불린다
    await engine.closeStdin();
    await engine.exited;
    const started = engine.events.filter((event) => event.event === "participant_started");
    expect(started).toHaveLength(1);
  });

  test("parent kill -9 terminates the child engine", async () => {
    const timeoutMs = 600;
    const parent = spawn(process.execPath, [PARENT, `--timeout-ms=${String(timeoutMs)}`], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const line = await new Promise<string>((resolve, reject) => {
      parent.once("error", reject);
      parent.stdout.once("data", (chunk: Buffer) => {
        resolve(chunk.toString("utf8"));
      });
    });
    const parsed = parseJson(line);
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
      throw new Error("parent did not report pids");
    }
    const parentPid = Reflect.get(parsed.value, "parent");
    const enginePid = Reflect.get(parsed.value, "engine");
    if (typeof parentPid !== "number" || typeof enginePid !== "number") {
      throw new Error("pids missing");
    }
    expect(isAlive(enginePid)).toBe(true);
    process.kill(parentPid, "SIGKILL");
    // 수용 기준: shutdown.timeoutMs + 1초 안에 종료
    expect(await waitFor(() => !isAlive(enginePid), timeoutMs + 1000)).toBe(true);
  });
});
