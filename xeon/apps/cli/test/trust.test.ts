import { afterEach, expect, test } from "bun:test";
import { WireError, wireError, type TrustStatus } from "@xeon/contracts/wire";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";
import { failureOfWire } from "../src/errors.ts";
import { EXIT } from "../src/exit-codes.ts";
import { describeTrust, optionText } from "../src/render/trust.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { FakeHandlers, TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

// G1-03: 프로젝트 신뢰. trust.get으로 상태를 읽고 trust.decide로 결정을 보낸다. 호스트 처리기는 가짜다
// (실제 처리기와 trust.json 쓰기는 trust-host.int.test.ts가 실제 호스트로 확인한다).

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
const ROOT = "/work/project";

const OPTIONS: TrustStatus["options"] = [
  { choice: { kind: "folder", verdict: "allow" }, label: "trust-folder", savedPath: ROOT },
  { choice: { kind: "parent", verdict: "allow" }, label: "trust-parent", savedPath: "/work" },
  { choice: { kind: "session", verdict: "allow" }, label: "trust-session", savedPath: null },
  { choice: { kind: "folder", verdict: "deny" }, label: "deny-folder", savedPath: ROOT },
  { choice: { kind: "session", verdict: "deny" }, label: "deny-session", savedPath: null },
];

function status(overrides: Partial<TrustStatus> = {}): TrustStatus {
  return {
    projectRoot: ROOT,
    required: true,
    verdict: "undecided",
    via: "headless",
    resources: [".mcp.json", ".xeon/commands"],
    options: OPTIONS,
    ...overrides,
  };
}

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      assistantItem(context.turnId, 1, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

interface FakeTrust {
  readonly handlers: FakeHandlers;
  readonly decided: Record<string, unknown>[];
  readonly asked: Record<string, unknown>[];
}

function fakeTrust(
  initial: TrustStatus,
  failures: { readonly get?: Error; readonly decide?: Error } = {},
): FakeTrust {
  const decided: Record<string, unknown>[] = [];
  const asked: Record<string, unknown>[] = [];
  const current = { status: initial };
  return {
    decided,
    asked,
    handlers: {
      "trust.get": (params) => {
        asked.push(Object.fromEntries(Object.entries(params)));
        if (failures.get !== undefined) throw failures.get;
        return current.status;
      },
      "trust.decide": (params) => {
        if (failures.decide !== undefined) throw failures.decide;
        decided.push(Object.fromEntries(Object.entries(params)));
        const choice = params["choice"];
        const verdict =
          typeof choice === "object" && choice !== null && "verdict" in choice
            ? choice.verdict
            : null;
        current.status = {
          ...current.status,
          verdict: verdict === "allow" ? "allow" : "deny",
          via: "prompt",
        };
        return current.status;
      },
    },
  };
}

function harness(handlers: FakeHandlers, replies: readonly Reply[] = []) {
  const input = scriptedInput([...replies, "/quit"]);
  const h = createHarness({
    terminal: { ...TTY, columns: 80 },
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: { onTurn: answer("ok"), handlers },
  });
  harnesses.push(h);
  return { h, input };
}

const CARD = `프로젝트: /work/project
불러오려는 자원: .mcp.json, .xeon/commands
판정: 아직 정하지 않음 (신뢰하지 않은 것으로 다룬다) - 묻는 화면이 없어 정하지 못했다
신뢰하면 이 자원의 지시문, 명령, MCP 서버가 사용자 권한으로 쓰인다. 신뢰하지 않으면 읽지 않는다
  1) 이 폴더를 신뢰한다 (저장: /work/project)
  2) 상위 폴더 전체를 신뢰한다 (저장: /work)
  3) 이번 실행에서만 신뢰한다 (저장하지 않는다)
  4) 이 폴더를 신뢰하지 않는다 (저장: /work/project)
  5) 이번 실행에서만 신뢰하지 않는다 (저장하지 않는다)
`;

test("describeTrust prints the project, resources, verdict and numbered choices", () => {
  expect(describeTrust(status())).toBe(CARD);
  expect(OPTIONS.map(optionText)).toEqual([
    "이 폴더를 신뢰한다 (저장: /work/project)",
    "상위 폴더 전체를 신뢰한다 (저장: /work)",
    "이번 실행에서만 신뢰한다 (저장하지 않는다)",
    "이 폴더를 신뢰하지 않는다 (저장: /work/project)",
    "이번 실행에서만 신뢰하지 않는다 (저장하지 않는다)",
  ]);
});

function parse(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

test("trust commands parse: status, allow and deny with a scope", () => {
  expect(parse(["trust"])).toEqual({ kind: "trust.status", output: "text" });
  expect(parse(["trust", "status", "--json"])).toEqual({ kind: "trust.status", output: "json" });
  expect(parse(["trust", "--json"])).toEqual({ kind: "trust.status", output: "json" });
  expect(parse(["trust", "allow"])).toEqual({
    kind: "trust.set",
    verdict: "allow",
    scope: "folder",
  });
  expect(parse(["trust", "deny", "--scope", "session"])).toEqual({
    kind: "trust.set",
    verdict: "deny",
    scope: "session",
  });
  expect(parse(["trust", "allow", "--scope", "everywhere"])).toBe("unexpectedArgument");
  expect(parse(["trust", "maybe"])).toBe("unknownCommand");
});

test("xeon trust shows the card for this workspace and asks trust.get with the workspace", async () => {
  const trust = fakeTrust(status());
  const { h } = harness(trust.handlers);
  expect(await h.run(["trust"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe(CARD);
  expect(trust.asked).toEqual([{ workspace: ROOT }]);
  expect(trust.decided).toEqual([]);
});

test("xeon trust --json prints the TrustStatus as is", async () => {
  const trust = fakeTrust(status());
  const { h } = harness(trust.handlers);
  expect(await h.run(["trust", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(h.stdoutText())).toEqual(status());
});

test("a workspace with nothing to trust says so on stderr", async () => {
  const trust = fakeTrust(
    status({ required: false, verdict: "allow", via: "notRequired", resources: [], options: [] }),
  );
  const { h } = harness(trust.handlers);
  expect(await h.run(["trust"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toBe("/work/project: 신뢰가 필요한 프로젝트 자원이 없다\n");
});

test("xeon trust allow --scope parent sends exactly that choice for this workspace", async () => {
  const trust = fakeTrust(status());
  const { h } = harness(trust.handlers);
  expect(await h.run(["trust", "allow", "--scope", "parent"])).toBe(EXIT.ok);
  expect(trust.decided).toEqual([
    { workspace: ROOT, choice: { kind: "parent", verdict: "allow" } },
  ]);
  expect(h.stdoutText()).toBe("상위 폴더 전체를 신뢰한다 (저장: /work): /work/project\n");
});

test("a scope the host did not offer is a usage error and nothing is sent", async () => {
  const trust = fakeTrust(status({ options: OPTIONS.slice(0, 1) }));
  const { h } = harness(trust.handlers);
  expect(await h.run(["trust", "deny", "--scope", "session"])).toBe(EXIT.usage);
  expect(trust.decided).toEqual([]);
  expect(h.stderrText()).toContain("xeon: 이 폴더에는 session 범위의 deny 선택지가 없다");
  expect(h.stderrText()).toContain("이 폴더를 신뢰한다 (저장: /work/project)");
});

test("a host without trust methods is an environment problem for xeon trust", async () => {
  const { h } = harness({});
  expect(await h.run(["trust"])).toBe(EXIT.environment);
  expect(h.stderrText()).toContain("연결한 host가 프로젝트 신뢰 결정을 아직 지원하지 않는다");
  expect(h.methods()).not.toContain("trust.get");
});

test("a save failure of the trust file is reported with its own phrase", () => {
  const failure = failureOfWire(wireError("store.io", { details: { code: "trust_store" } }));
  expect(failure).toEqual({
    message: "프로젝트 신뢰 결정을 저장하지 못했다",
    fix: "신뢰 저장 파일(trust.json)의 권한과 내용을 확인한다",
    code: EXIT.environment,
  });
});

test("interactive chat asks the card before the thread is created and sends the picked choice", async () => {
  const trust = fakeTrust(status());
  const { h, input } = harness(trust.handlers, ["2"]);
  expect(await h.run(["chat"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain(CARD);
  expect(input.prompts[0]).toBe("번호 (엔터는 나중에) > ");
  expect(trust.decided).toEqual([
    { workspace: ROOT, choice: { kind: "parent", verdict: "allow" } },
  ]);
  const methods = h.methods();
  expect(methods.indexOf("trust.decide")).toBeLessThan(methods.indexOf("thread.create"));
});

test("a wrong number asks again; enter postpones and nothing is stored", async () => {
  const trust = fakeTrust(status());
  const { h, input } = harness(trust.handlers, ["9", ""]);
  expect(await h.run(["chat"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("목록의 번호를 입력한다\n");
  expect(input.prompts.slice(0, 2)).toEqual(["번호 (엔터는 나중에) > ", "번호 (엔터는 나중에) > "]);
  expect(trust.decided).toEqual([]);
  expect(h.stderrText()).toContain("정하지 않았다. 이 프로젝트의 자원은 읽지 않는다");
  expect(h.methods()).toContain("thread.create");
});

test("an already decided or not required workspace is not asked", async () => {
  const decided = fakeTrust(status({ verdict: "allow", via: "store" }));
  const first = harness(decided.handlers);
  expect(await first.h.run(["chat"])).toBe(EXIT.ok);
  expect(first.input.prompts).toEqual(["> "]);

  const none = fakeTrust(status({ required: false, verdict: "allow", via: "notRequired" }));
  const second = harness(none.handlers);
  expect(await second.h.run(["chat"])).toBe(EXIT.ok);
  expect(second.input.prompts).toEqual(["> "]);
});

test("a failed trust.get or trust.decide never blocks the chat and keeps the project untrusted", async () => {
  const unreadable = fakeTrust(status(), { get: wireError("internal") });
  const a = harness(unreadable.handlers);
  expect(await a.h.run(["chat"])).toBe(EXIT.ok);
  expect(a.h.stderrText()).toContain("프로젝트 신뢰 상태를 읽지 못해 확인을 건너뛴다");

  const unsaved = fakeTrust(status(), {
    decide: new WireError(5006, "x", {
      kind: "store.io",
      retryable: false,
      details: { code: "trust_store" },
    }),
  });
  const b = harness(unsaved.handlers, ["1"]);
  expect(await b.h.run(["chat"])).toBe(EXIT.ok);
  expect(b.h.stderrText()).toContain("xeon: 프로젝트 신뢰 결정을 저장하지 못했다");
  expect(b.h.stderrText()).toContain("이 프로젝트는 신뢰하지 않은 채로 연다");
  expect(b.h.methods()).toContain("thread.create");
});

test("print mode notes an undecided trust on stderr without asking; json mode does not call trust.get", async () => {
  const trust = fakeTrust(status());
  const text = harness(trust.handlers);
  expect(await text.h.run(["chat", "-p", "hello"])).toBe(EXIT.ok);
  expect(text.h.stderrText()).toBe(
    "프로젝트 신뢰가 정해지지 않아 .mcp.json, .xeon/commands을(를) 읽지 않는다 (xeon trust로 정한다)\n",
  );
  expect(text.input.prompts).toEqual([]);
  expect(trust.decided).toEqual([]);

  const json = harness(trust.handlers);
  expect(await json.h.run(["chat", "-p", "hello", "--json"])).toBe(EXIT.ok);
  expect(json.h.methods()).not.toContain("trust.get");
});
