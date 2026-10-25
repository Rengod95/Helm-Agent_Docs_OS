import { afterEach, expect, test } from "bun:test";
import { EXIT } from "../src/exit-codes.ts";
import { completionsOf, parseSlash, SLASH_ALIASES } from "../src/slash.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";
import { def, fakeSettings, summary } from "./support/m2.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;
const T1 = threadId(1);
const T2 = threadId(2);
const MODEL = { name: "model", key: "l1.models.default" };

test("parseSlash reads the built-in commands, set, the model alias and resume", () => {
  expect(parseSlash("/help")).toEqual({ kind: "help" });
  expect(parseSlash("/quit")).toEqual({ kind: "quit" });
  expect(parseSlash("/exit")).toEqual({ kind: "quit" });
  expect(parseSlash("/set l4.cli.theme dark")).toEqual({
    kind: "set",
    key: "l4.cli.theme",
    raw: "dark",
  });
  expect(parseSlash("/set  l1.loop.maxSteps   80  ")).toEqual({
    kind: "set",
    key: "l1.loop.maxSteps",
    raw: "80",
  });
  expect(parseSlash("/model")).toEqual({ kind: "alias", alias: MODEL, raw: null });
  expect(parseSlash("/model tape/tape-1")).toEqual({
    kind: "alias",
    alias: MODEL,
    raw: "tape/tape-1",
  });
  expect(parseSlash("/resume")).toEqual({ kind: "resume", target: null });
  expect(parseSlash("/resume 2")).toEqual({ kind: "resume", target: "2" });
  expect(parseSlash("/frob x")).toEqual({ kind: "engine", name: "frob", text: "/frob x" });
});

test("parseSlash reports a missing key or value and a malformed key", () => {
  expect(parseSlash("/set")).toMatchObject({ kind: "usage" });
  expect(parseSlash("/set l4.cli.theme")).toMatchObject({ kind: "usage" });
  expect(parseSlash("/set NotAKey value")).toMatchObject({
    kind: "usage",
    message: "설정 키 형식이 아니다: NotAKey",
  });
});

test("the model alias points at the models default key", () => {
  expect(SLASH_ALIASES).toEqual([{ name: "model", key: "l1.models.default" }]);
});

test("completionsOf completes /set keys from the session-scoped list and slash names", () => {
  const keys = ["l4.cli.theme", "l4.cli.outputMode", "l1.loop.maxSteps"];
  expect(completionsOf("/set l4.cli.", keys)).toEqual([
    "/set l4.cli.theme",
    "/set l4.cli.outputMode",
  ]);
  expect(completionsOf("/set ", keys)).toHaveLength(3);
  expect(completionsOf("/re", keys)).toEqual(["/resume", "/rename"]);
  expect(completionsOf("/mo", keys)).toEqual(["/model"]);
  expect(completionsOf("hello", keys)).toEqual([]);
  expect(completionsOf("/model x", keys)).toEqual([]);
});

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      assistantItem(context.turnId, 1, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

function session(replies: readonly Reply[], extra: Parameters<typeof createHarness>[0] = {}) {
  const settings = fakeSettings(
    [
      def("l4.cli.theme", {
        allowedScopes: ["user", "session"],
        default: "system",
        range: { enum: ["system", "dark", "light"] },
      }),
      def("l1.models.default", {
        layer: "L1",
        allowedScopes: ["user", "session"],
        default: "auto",
        range: { enum: ["auto", "tape/tape-1"] },
      }),
      def("l1.loop.maxSteps", {
        layer: "L1",
        type: { type: "integer" },
        allowedScopes: ["user"],
        default: 50,
      }),
    ],
    {},
  );
  const input = scriptedInput([...replies, "/quit"]);
  const unsubscribed: Record<string, unknown>[] = [];
  const s = { unsubscribed };
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    ...extra,
    server: {
      knownThreads: [T1, T2],
      onTurn: answer("ok"),
      handlers: {
        ...settings.handlers,
        "events.unsubscribe": (params) => (s.unsubscribed.push({ ...params }), {}),
        "thread.list": () => ({
          threads: [summary(T1, { title: "하나" }), summary(T2, { title: "둘" })],
          nextCursor: null,
        }),
        "thread.open": (params) => ({
          threadId: params["threadId"],
          role: "owner",
          position: { storeId: "sto_00000000000000000000000001", seq: 0 },
        }),
      },
      ...extra.server,
    },
  });
  harnesses.push(h);
  return { h, settings, input, unsubscribed };
}

test("/set writes the session scope of the current thread and prints the effective value", async () => {
  const s = session(["/set l4.cli.theme dark"]);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.settings.writes).toHaveLength(1);
  expect(s.settings.writes[0]).toMatchObject({
    key: "l4.cli.theme",
    value: "dark",
    scope: "session",
  });
  expect(typeof s.settings.writes[0]?.threadId).toBe("string");
  expect(s.h.stdoutText()).toContain('l4.cli.theme = "dark"  (session)');
});

test("/set on a key that has no session scope shows the host's scope error and keeps the session", async () => {
  const s = session(["/set l1.loop.maxSteps 80", "/set l4.cli.theme light"]);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stderrText()).toContain("허용 범위: user");
  expect(s.settings.writes.map((w) => w.key)).toEqual(["l4.cli.theme"]);
});

test("/model without a value shows the current value and the choices; with a value it sets the alias key", async () => {
  const s = session(["/model", "/model tape/tape-1"]);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stdoutText()).toContain('l1.models.default = "auto"');
  expect(s.h.stdoutText()).toContain("선택지: auto, tape/tape-1");
  expect(s.settings.writes[0]).toMatchObject({
    key: "l1.models.default",
    value: "tape/tape-1",
    scope: "session",
  });
});

test("the completer gets the keys that allow the session scope", async () => {
  const s = session([]);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  const complete = s.h.completer();
  expect(complete?.("/set l")).toEqual(["/set l4.cli.theme", "/set l1.models.default"]);
  expect(complete?.("/set l1.loop")).toEqual([]);
  expect(complete?.("/res")).toEqual(["/resume"]);
});

test("/resume lists the sessions of the folder and switches to the chosen one", async () => {
  const s = session(["/resume", "2", "hello"]);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  const shown = s.h.stdoutText();
  expect(shown).toContain(`1) ${T1}`);
  expect(shown).toContain("둘");
  expect(shown).toContain(`세션 ${T2}으로 바꿨다`);
  expect(s.h.server().requests.find((r) => r.method === "turn.start")?.params).toMatchObject({
    threadId: T2,
  });
  // 이전 세션의 구독은 해제했다
  expect(s.unsubscribed.length).toBeGreaterThanOrEqual(1);
});

test("/resume with an unknown choice says so and stays on the current session", async () => {
  const s = session(["/resume 99", "hello"]);
  expect(await s.h.run(["chat"])).toBe(EXIT.ok);
  expect(s.h.stderrText()).toContain("세션을 고를 수 없다: 99");
  const turn = s.h.server().requests.find((r) => r.method === "turn.start");
  expect(turn?.params).toMatchObject({ threadId: expect.not.stringMatching(String(T2)) });
});
