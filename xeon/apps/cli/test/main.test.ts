import { afterEach, expect, test } from "bun:test";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
import type { HostCommand } from "@xeon/host";
import { EXIT } from "../src/exit-codes.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

test("version prints the CLI, contract and Bun versions without connecting", async () => {
  const h = harness();
  expect(await h.run(["version"])).toBe(0);
  expect(h.stdoutText()).toBe(`xeon 0.0.0\n계약 ${WIRE_PROTOCOL_VERSION}\nBun 1.4.3\n`);
  expect(h.methods()).toEqual([]);
});

test("version --json is one JSON line", async () => {
  const h = harness();
  await h.run(["version", "--json"]);
  expect(JSON.parse(h.stdoutText())).toEqual({
    cli: "0.0.0",
    contract: WIRE_PROTOCOL_VERSION,
    bun: "1.4.3",
  });
  expect(h.stdoutText().endsWith("\n")).toBe(true);
});

test("help lists the commands that exist and marks the ones that come later", async () => {
  const h = harness();
  expect(await h.run(["--help"])).toBe(0);
  const text = h.stdoutText();
  for (const word of [
    "chat -p",
    "--continue",
    "--resume",
    "config get",
    "config schema",
    "config set",
    "sessions ls",
    "secret ls",
    "doctor",
    "version",
  ]) {
    expect(text).toContain(word);
  }
  // 모든 명령이 있다: 마일스톤 표시가 남지 않는다
  expect(text).not.toContain("(M2)");
  expect(text).not.toContain("(M3)");
  expect(text).toContain("service start|status|stop|ensure");
  expect(text).toContain("--safe-mode");
  expect(text).not.toContain("launch-mode");
  expect(text).not.toContain("host --stdio");
  expect(h.methods()).toEqual([]);
});

test("help <topic> shows the topic and falls back to the overview", async () => {
  const chat = harness();
  await chat.run(["chat", "--help"]);
  expect(chat.stdoutText()).toContain("사용법: xeon chat");
  const other = harness();
  await other.run(["help", "nothing"]);
  expect(other.stdoutText()).toContain("명령");
});

test("service commands run through runHostCommand and its code is the exit code", async () => {
  const seen: HostCommand[] = [];
  const h = harness({
    runHostCommand: (command) => {
      seen.push(command);
      return Promise.resolve(command.kind === "service-status" ? 1 : 0);
    },
  });
  expect(await h.run(["service", "start"])).toBe(0);
  expect(await h.run(["service", "start", "--safe-mode", "--listen-tcp", "127.0.0.1:7777"])).toBe(
    0,
  );
  expect(
    await h.run(["service", "run", "--listen-tcp", "0.0.0.0:7777", "--allow-non-loopback"]),
  ).toBe(0);
  expect(await h.run(["service", "status", "--json"])).toBe(1);
  expect(await h.run(["service", "stop"])).toBe(0);
  expect(await h.run(["service", "ensure", "--safe-mode"])).toBe(0);
  expect(await h.run(["service", "run", "--safe-mode"])).toBe(0);
  expect(seen).toEqual([
    { kind: "service-start" },
    { kind: "service-start", safeMode: true, tcp: { host: "127.0.0.1", port: 7777 } },
    {
      kind: "service-run",
      safeMode: false,
      tcp: { host: "0.0.0.0", port: 7777 },
      allowNonLoopback: true,
    },
    { kind: "service-status", json: true },
    { kind: "service-stop" },
    { kind: "service-ensure", safeMode: true },
    { kind: "service-run", safeMode: true },
  ]);
  // 엔진을 이 프로세스에서 열지 않는다
  expect(h.methods()).toEqual([]);
});

test("service flags that do not fit the sub-command are usage errors", async () => {
  const cases: readonly (readonly string[])[] = [
    ["service", "status", "--safe-mode"],
    ["service", "stop", "--listen-tcp", "127.0.0.1:1"],
    ["service", "ensure", "--listen-tcp", "127.0.0.1:1"],
    ["service", "start", "--listen-tcp", "nohost"],
    ["service", "start", "--listen-tcp", "x:70000"],
    ["service", "start", "--listen-tcp", "0.0.0.0:7777"],
    ["service", "start", "--allow-non-loopback"],
    ["service"],
    ["service", "bogus"],
  ];
  const codes = await Promise.all(cases.map((argv) => harness().run(argv)));
  expect(codes).toEqual(cases.map(() => EXIT.usage));
});

test("--safe-mode on chat is handed to the engine as AssembleOptions.safeMode and is off otherwise", async () => {
  const on = harness({ server: { onTurn: oneAnswer } });
  await on.run(["chat", "--safe-mode", "-p", "x"]);
  expect(on.startOptions[0]?.safeMode).toBe(true);
  const off = harness({ server: { onTurn: oneAnswer } });
  await off.run(["chat", "-p", "x"]);
  expect(off.startOptions[0]).not.toHaveProperty("safeMode");
  const bare = harness({ server: { onTurn: oneAnswer } });
  await bare.run(["--safe-mode", "-p", "x"]);
  expect(bare.startOptions[0]?.safeMode).toBe(true);
});

function oneAnswer(context: TurnContext): void {
  context.server.commit(context.threadId, [
    assistantItem(context.turnId, 1, { text: "ok" }),
    turnCompleted(context.turnId),
  ]);
}

test("-C sets the working folder: absolute as given, relative against the current folder", async () => {
  const absolute = harness({ server: { onTurn: oneAnswer } });
  await absolute.run(["-C", "/srv/app", "chat", "-p", "x"]);
  expect(absolute.server().requests.find((r) => r.method === "thread.create")?.params).toEqual({
    workspace: "/srv/app",
  });
  const relative = harness({ server: { onTurn: oneAnswer }, cwd: "/home/u/work" });
  await relative.run(["chat", "-p", "x", "-C", "sub/dir"]);
  expect(relative.server().requests.find((r) => r.method === "thread.create")?.params).toEqual({
    workspace: "/home/u/work/sub/dir",
  });
});

test("--continue looks the session up under the -C folder", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          assistantItem(context.turnId, 1, { text: "a" }),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  await h.run(["-C", "/one", "chat", "-p", "x"]);
  expect(await h.run(["-C", "/two", "chat", "--continue", "-p", "x"])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("이어 열 세션이 없다");
  h.stderr.length = 0;
  expect(await h.run(["-C", "/one", "chat", "--continue", "-p", "x"])).toBe(0);
  const turn = h.server().requests.findLast((request) => request.method === "turn.start");
  expect(turn?.params).toMatchObject({ threadId: threadId(101) });
});
