import { afterEach, expect, test } from "bun:test";
import { WIRE_PROTOCOL_VERSION } from "@xeon/contracts/wire";
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
  // 아직 없는 명령만 마일스톤을 밝힌다
  expect(text).not.toContain("(M2)");
  expect(text).toContain("(M3)");
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

test("service commands come with M3 and say so on two lines and exit 1", async () => {
  const cases: readonly (readonly [readonly string[], string, string])[] = [
    [["service", "status"], "service", "M3"],
  ];
  await Promise.all(
    cases.map(async ([argv, name, milestone]) => {
      const h = harness();
      expect(await h.run(argv)).toBe(EXIT.error);
      expect(h.stderrText()).toBe(
        `xeon: ${name}은 아직 제공하지 않는다\n  해결: ${milestone}에서 제공한다. xeon --help로 지금 쓸 수 있는 명령을 확인한다\n`,
      );
      expect(h.closed()).toBe(false);
    }),
  );
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
