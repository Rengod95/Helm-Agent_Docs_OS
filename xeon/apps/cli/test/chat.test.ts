import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import {
  assistantItem,
  effectIntent,
  toolResultItem,
  turnCompleted,
  userItem,
} from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, waitFor, type Harness } from "./support/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      userItem(context.turnId, 1, "hello"),
      assistantItem(context.turnId, 2, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

function turnStartParams(h: Harness): Record<string, unknown> {
  const request = h.server().requests.find((entry) => entry.method === "turn.start");
  return typeof request?.params === "object" && request.params !== null
    ? Object.fromEntries(Object.entries(request.params))
    : {};
}

test("print mode runs one turn and writes the assistant text to stdout", async () => {
  const h = harness({ server: { onTurn: answer("안녕하세요") } });
  const code = await h.run(["chat", "-p", "hello"]);
  expect(h.stderrText()).toBe("");
  expect(h.stdoutText()).toBe("안녕하세요\n");
  expect(code).toBe(0);
  expect(h.closed()).toBe(true);
});

test("the connection order is hello, settings, create, subscribe, turn.start", async () => {
  const h = harness({ server: { onTurn: answer("ok") } });
  await h.run(["chat", "-p", "hello"]);
  expect(h.server().requests.map((request) => request.method)).toEqual([
    "host.hello",
    "settings.get",
    "thread.create",
    "events.subscribe",
    "turn.start",
  ]);
  const create = h.server().requests.find((request) => request.method === "thread.create");
  expect(create?.params).toEqual({ workspace: "/work/project" });
});

test("a turn.start response that arrives before the events still ends the turn", async () => {
  const h = harness({ server: { onTurn: answer("late"), respondBeforeTurn: true } });
  expect(await h.run(["chat", "-p", "hello"])).toBe(0);
  expect(h.stdoutText()).toBe("late\n");
});

test("events that arrive before the response are not lost", async () => {
  const h = harness({ server: { onTurn: answer("early") } });
  expect(await h.run(["chat", "-p", "hello"])).toBe(0);
  expect(h.stdoutText()).toBe("early\n");
});

test("tool calls and results go to stderr, not stdout, in print mode", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          userItem(context.turnId, 1, "list"),
          assistantItem(context.turnId, 2, { toolCallId: "call-1" }),
          effectIntent(context.turnId, {
            effect: 1,
            item: 3,
            toolCallId: "call-1",
            toolName: "ls",
            args: { path: "." },
          }),
          toolResultItem(context.turnId, {
            item: 4,
            effect: 1,
            toolCallId: "call-1",
            toolName: "ls",
            text: "a.txt\nb.txt",
          }),
          assistantItem(context.turnId, 5, { text: "two files" }),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  expect(await h.run(["chat", "-p", "list"])).toBe(0);
  expect(h.stdoutText()).toBe("two files\n");
  expect(h.stderrText()).toContain("● ls");
  expect(h.stderrText()).toContain("a.txt");
  expect(h.stderrText()).toContain("b.txt");
});

test("a failed turn exits 1 and says why on stderr", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          turnCompleted(context.turnId, "failed", "model unavailable"),
        ]);
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("model unavailable");
});

test("an interrupted turn exits 130", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [turnCompleted(context.turnId, "interrupted")]);
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.interrupted);
});

test("thread.locked on turn.start exits 4 with the two-line message", async () => {
  const h = harness({
    server: {
      failures: {
        "turn.start": wireError("thread.locked", {
          details: { ownerKind: "service", options: ["observe", "fork"] },
        }),
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.lockDenied);
  expect(h.stderrText()).toBe(
    "xeon: 다른 프로세스(service)가 이 세션을 쓰고 있다\n  해결: 끝날 때까지 두거나 새 세션을 연다\n",
  );
  expect(h.closed()).toBe(true);
});

test("turn.busy exits 1", async () => {
  const h = harness({
    server: {
      failures: { "turn.start": wireError("turn.busy", { details: { turnId: "trn_x" } }) },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("진행 중인 turn이 있다");
});

test("an unexpected wire error is reported as an internal error with the trace id", async () => {
  const h = harness({
    server: {
      failures: { "thread.create": wireError("internal", { traceId: "tr-1" }) },
    },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("traceId tr-1");
});

test("-p - reads the whole input from stdin", async () => {
  const h = harness({ stdin: "from stdin\n", server: { onTurn: answer("ok") } });
  await h.run(["chat", "-p", "-"]);
  expect(turnStartParams(h)["input"]).toBe("from stdin\n");
});

test("-p with a non-tty stdin appends the stdin text after a blank line", async () => {
  const h = harness({ stdin: "piped", server: { onTurn: answer("ok") } });
  await h.run(["chat", "-p", "question"]);
  expect(turnStartParams(h)["input"]).toBe("question\n\npiped");
});

test("an empty input is a usage error", async () => {
  const h = harness();
  expect(await h.run(["chat", "-p", "  "])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("입력이 비어 있다");
});

test("an input over 1 MiB is a usage error and never reaches the host", async () => {
  const h = harness({ stdin: "x".repeat(1_048_577) });
  expect(await h.run(["chat", "-p", "-"])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("1 MiB");
  expect(h.closed()).toBe(false);
});

test("every turn.start carries a request id from the engine", async () => {
  const h = harness({ server: { onTurn: answer("ok") } });
  await h.run(["chat", "-p", "hello"]);
  expect(turnStartParams(h)["requestId"]).toBe("evt_request1");
});

test("stdout that closes mid-run stops the output and exits 0", async () => {
  const h = harness({ stdoutBreaksAfter: 0, server: { onTurn: answer("ignored") } });
  expect(await h.run(["chat", "-p", "hello"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("");
  expect(h.closed()).toBe(true);
});

test("--set is not available in M1 and never connects", async () => {
  const h = harness();
  expect(await h.run(["chat", "-p", "x", "--set", "l4.cli.theme=dark"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("--set은 아직 제공하지 않는다");
  expect(h.closed()).toBe(false);
});

test("ctrl+c in print mode asks to exit with 130 and closes the engine", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [userItem(context.turnId, 1, "hello")]);
      },
    },
  });
  const running = h.run(["chat", "-p", "hello"]);
  await waitFor(() => h.methods().includes("turn.start"));
  h.signal("SIGINT");
  expect(await running).toBe(EXIT.interrupted);
  expect(h.closed()).toBe(true);
});

async function exitCodeAfter(signal: "SIGTERM" | "SIGHUP"): Promise<number> {
  const h = harness({ server: { onTurn: () => undefined } });
  const running = h.run(["chat", "-p", "hello"]);
  await waitFor(() => h.methods().includes("turn.start"));
  h.signal(signal);
  return running;
}

test("SIGTERM exits 143", async () => {
  expect(await exitCodeAfter("SIGTERM")).toBe(EXIT.terminated);
});

test("SIGHUP exits 129", async () => {
  expect(await exitCodeAfter("SIGHUP")).toBe(EXIT.hangup);
});

test("a second ctrl+c within two seconds forces the exit without waiting for the engine", async () => {
  const h = harness({ server: { onTurn: () => undefined } });
  const running = h.run(["chat", "-p", "hello"]);
  await waitFor(() => h.methods().includes("turn.start"));
  h.signal("SIGINT");
  h.signal("SIGINT");
  expect(await running).toBe(EXIT.interrupted);
});

test("an approval request in print mode is answered with deny and announced", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          {
            kind: "approval.requested",
            turnId: context.turnId,
            payload: {
              origin: {
                threadId: context.threadId,
                turnId: context.turnId,
                stepId: null,
                toolCallId: "call-1",
                caller: "model",
              },
              requestKey: "k1",
              title: "bash 실행",
              body: {
                kind: "tool",
                tool: {
                  toolName: "bash",
                  risk: "high",
                  args: { command: "ls" },
                  argsHash: "h",
                  ruleId: null,
                },
              },
              remember: ["once"],
              surfaceThreadId: context.threadId,
              requestedAt: 1,
            },
          },
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  expect(await h.run(["chat", "-p", "run it"])).toBe(0);
  expect(h.stderrText()).toContain("승인 요청: bash 실행");
  // 가짜 서버에는 approval.respond가 없다: 거부 응답이 가지 못했음을 알림이 밝힌다
  expect(h.stderrText()).toContain("거부로 답하려 했으나 host가 응답을 받지 못했다");
  expect(h.server().requests.some((request) => request.method === "approval.respond")).toBe(true);
});

test("an engine connection that drops mid-turn ends the run with 1 and says so", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [userItem(context.turnId, 1, "hello")]);
      },
    },
  });
  const running = h.run(["chat", "-p", "hello"]);
  await waitFor(() => h.methods().includes("turn.start"));
  await h.server().closeFromServer();
  expect(await running).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "xeon: 엔진 연결이 끊겼다\n  해결: xeon service status로 엔진 상태를 확인한다\n",
  );
});

test("a broken state file is discarded with one diagnostic line and the run goes on", async () => {
  const h = harness({ server: { onTurn: answer("fine") } });
  mkdirSync(dirname(h.stateFile), { recursive: true });
  writeFileSync(h.stateFile, "{ nope");
  expect(await h.run(["chat", "-p", "hello"])).toBe(0);
  expect(h.stderrText()).toBe("CLI 상태 파일을 읽지 못해 버렸다 (JSON이 아니다)\n");
  expect(h.stdoutText()).toBe("fine\n");
  expect(JSON.parse(readFileSync(h.stateFile, "utf8"))).toMatchObject({ version: 1 });
});
