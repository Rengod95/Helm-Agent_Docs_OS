import { afterEach, expect, test } from "bun:test";
import { wireError, type InvocableEntry } from "@fresnel/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { parseSlash } from "../src/slash.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { FakeHandlers, FakeServerOptions, TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";
import { summary } from "./support/m2.ts";
import { scriptedInput, type Reply } from "./support/script.ts";

// 입력 한 줄의 `/이름`을 플러그인 항목으로 풀어 이 턴에만 얹는다(L4.cli.spec §4.12). `/profile remove <플러그인>`은 프로필에서 뺀다.
// 호스트는 가짜다. 응답은 스키마를 지켜야 한다(클라이언트가 응답을 검증한다).

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;
const T1 = threadId(1);
const HASH = `sha256:${"b".repeat(64)}`;
const AT = "2026-11-17T00:00:00.000Z";
const USAGE = "사용법: /profile remove <플러그인 이름>";

function answer(text: string): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      assistantItem(context.turnId, 1, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

function entry(
  plugin: string,
  name: string,
  kind: InvocableEntry["kind"],
  title = "",
): InvocableEntry {
  return { plugin, entry: name, kind, title, reviewedHash: HASH };
}

/** 프로필 `work`에 든 `helm`, 공통 묶음의 `common-tools`, 밖에 있는 `review-kit`·`alpha`·`beta` */
const ENTRIES: readonly InvocableEntry[] = [
  entry("helm", "review", "skill", "프로필 안 검토"),
  entry("review-kit", "lint", "command", "검사"),
  entry("review-kit", "review-kit", "plugin"),
  entry("alpha", "plan", "skill", "알파 계획"),
  entry("beta", "plan", "command", "베타 계획"),
];

/** 카드의 모양은 PluginCard 스키마를 지킨다. 이름과 사용처만 다르다 */
function card(name: string, usedBy: readonly string[]): Record<string, unknown> {
  return {
    name,
    displayName: name,
    purpose: "시험용 플러그인",
    does: { inject: null, hook: null, drive: null },
    enforcement: "enforced",
    runs: { code: false, isolated: null },
    cost: { always: 0, drive: null, onDemand: 0, toolCount: 0, basis: "declared" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: HASH, pendingItemId: null, approvedAt: AT },
    usedBy,
  };
}

function profile(id: string, plugins: readonly string[], rev: number): Record<string, unknown> {
  return {
    id,
    title: "작업",
    builtin: false,
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
    updatedAt: AT,
    rev,
  };
}

/** 대화 목록과 플러그인 목록. 대화는 프로필 `work`에 속한다 */
const LISTS: FakeHandlers = {
  "thread.list": () => ({ threads: [summary(T1, { profileId: "work" })], nextCursor: null }),
  "plugin.list": () => ({
    plugins: [
      card("helm", ["work"]),
      card("common-tools", ["common"]),
      card("review-kit", []),
      card("alpha", []),
      card("beta", []),
    ],
  }),
};

const INVOCABLES: FakeHandlers = {
  "plugin.invocables": () => ({ entries: ENTRIES }),
};

interface ChatOptions {
  readonly handlers?: FakeHandlers;
  readonly failures?: FakeServerOptions["failures"];
  /** 거짓이면 `plugin.invocables`를 알리지 않는다(이 기능이 없는 오래된 호스트) */
  readonly invocables?: boolean;
}

function chat(replies: readonly Reply[], options: ChatOptions = {}): Harness {
  const input = scriptedInput([...replies, "/quit"]);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      knownThreads: [T1],
      onTurn: answer("ok"),
      handlers: {
        ...LISTS,
        ...(options.invocables === false ? {} : INVOCABLES),
        ...options.handlers,
      },
      ...(options.failures === undefined ? {} : { failures: options.failures }),
    },
  });
  harnesses.push(h);
  return h;
}

/** print 모드(`-p`) 실행. 터미널을 주지 않는다(chat-open 시험과 같다) */
function printHarness(): Harness {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { knownThreads: [T1], onTurn: answer("ok"), handlers: { ...LISTS, ...INVOCABLES } },
  });
  harnesses.push(h);
  return h;
}

function turnStarts(h: Harness): readonly Record<string, unknown>[] {
  return h
    .server()
    .requests.filter((request) => request.method === "turn.start")
    .map((request) => Object.fromEntries(Object.entries(request.params ?? {})));
}

test("parseSlash reads /profile remove <plugin> and reports a bad form as usage", () => {
  expect(parseSlash("/profile remove helm")).toEqual({ kind: "profileRemove", plugin: "helm" });
  expect(parseSlash("/profile")).toEqual({ kind: "usage", message: USAGE });
  expect(parseSlash("/profile remove")).toEqual({ kind: "usage", message: USAGE });
  expect(parseSlash("/profile add helm")).toEqual({ kind: "usage", message: USAGE });
  expect(parseSlash("/profile remove helm extra")).toEqual({ kind: "usage", message: USAGE });
  expect(parseSlash("/profile remove Helm!")).toEqual({ kind: "usage", message: USAGE });
});

test("parseSlash hands a plugin-style name to the engine path, not to a built-in", () => {
  expect(parseSlash("/lint src")).toEqual({ kind: "engine", name: "lint", text: "/lint src" });
  expect(parseSlash("/profile")).toMatchObject({ kind: "usage" });
});

test("a skill of a plugin outside the profile is sent with the turn as one overlay item", async () => {
  const h = chat(["/lint src/"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  const sent = turnStarts(h);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    threadId: T1,
    input: "src/",
    overlay: [{ plugin: "review-kit", entry: "lint" }],
  });
  // 플러그인 이름으로 풀린 줄이라 명령 실행 요청은 보내지 않는다
  expect(h.methods()).not.toContain("command.run");
});

test("a name already in the profile sends the input alone and says so on stderr", async () => {
  const h = chat(["/review 봐 줘"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  const sent = turnStarts(h);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.input).toBe("봐 줘");
  expect(Object.keys(sent[0] ?? {})).not.toContain("overlay");
  expect(h.stderrText()).toContain("이미 이 대화의 프로필에 있어");
  expect(h.stderrText()).toContain("helm");
});

test("a name shared by two outside plugins lists the qualified names and sends nothing", async () => {
  const h = chat(["/plan 세워 줘"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(turnStarts(h)).toHaveLength(0);
  const shown = h.stderrText();
  expect(shown).toContain("/plan");
  expect(shown).toContain("/alpha:plan");
  expect(shown).toContain("/beta:plan");
});

test("a qualified name picks one plugin's item even when the bare name is ambiguous", async () => {
  const h = chat(["/beta:plan 세워 줘"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(turnStarts(h)).toMatchObject([
    { input: "세워 줘", overlay: [{ plugin: "beta", entry: "plan" }] },
  ]);
});

test("/plugin:<name> overlays the whole plugin with no entry", async () => {
  const h = chat(["/plugin:review-kit 해 줘"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  const sent = turnStarts(h);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.overlay).toEqual([{ plugin: "review-kit" }]);
  expect(sent[0]?.input).toBe("해 줘");
});

test("a name with no input after it is not sent and says what to add", async () => {
  const h = chat(["/lint"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(turnStarts(h)).toHaveLength(0);
  expect(h.stderrText()).toContain("/lint 뒤에");
});

test("a name no plugin has keeps the old unknown-command path", async () => {
  const h = chat(["/nothing here"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(turnStarts(h)).toHaveLength(0);
  expect(h.stderrText()).toContain("모르는 슬래시 명령: /nothing");
});

test("a host without plugin.invocables keeps the old unknown-command path", async () => {
  const h = chat(["/lint src/"], { invocables: false });
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(turnStarts(h)).toHaveLength(0);
  expect(h.stderrText()).toContain("모르는 슬래시 명령: /lint");
});

test("print mode sends an outside plugin's item with its input and exits 0", async () => {
  const h = printHarness();
  expect(await h.run(["chat", "-p", "/lint src/", "--resume", T1])).toBe(EXIT.ok);
  expect(turnStarts(h)).toMatchObject([
    { input: "src/", overlay: [{ plugin: "review-kit", entry: "lint" }] },
  ]);
});

test("print mode with an ambiguous name exits as a usage error and sends nothing", async () => {
  const h = printHarness();
  expect(await h.run(["chat", "-p", "/plan 세워 줘", "--resume", T1])).toBe(EXIT.usage);
  expect(turnStarts(h)).toHaveLength(0);
  expect(h.stderrText()).toContain("/alpha:plan");
});

/** 실패를 끼워 넣는 시험에서도 처리기가 있어야 `profile.removePlugin`이 host.hello의 기능에 든다. 실제 응답은 failures가 대신한다 */
const ADVERTISED_REMOVE: FakeHandlers = {
  "profile.removePlugin": () => ({
    profile: profile("work", [], 2),
    preview: { threadsUsing: 1, dropsDrive: null },
  }),
};

function removeHandlers(
  rev: number,
  preview: Record<string, unknown>,
): { readonly handlers: FakeHandlers; readonly removals: Record<string, unknown>[] } {
  const removals: Record<string, unknown>[] = [];
  return {
    removals,
    handlers: {
      "profile.get": () => ({ profile: profile("work", ["helm"], rev) }),
      "profile.removePlugin": (params) => {
        removals.push({ ...params });
        return { profile: profile("work", [], rev + 1), preview };
      },
    },
  };
}

test("/profile remove sends the plugin with the profile's current revision and reports it", async () => {
  const { handlers, removals } = removeHandlers(7, { threadsUsing: 1, dropsDrive: null });
  const h = chat(["/profile remove helm"], { handlers });
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(removals).toEqual([{ id: "work", plugin: "helm", baseRev: 7 }]);
  expect(h.stdoutText()).toContain("프로필 work에서 helm 플러그인을 뺐다");
  expect(h.stdoutText()).not.toContain("Drive 중인");
});

test("/profile remove of a driving plugin adds the Drive line", async () => {
  const { handlers } = removeHandlers(3, { threadsUsing: 1, dropsDrive: { threadCount: 1 } });
  const h = chat(["/profile remove helm"], { handlers });
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("Driving 중인 플러그인이라 실행 중인 Drive가 내려간다");
});

test("/profile remove of a common plugin says it cannot be removed from this profile", async () => {
  const h = chat(["/profile remove common-tools"], {
    handlers: {
      ...ADVERTISED_REMOVE,
      "profile.get": () => ({ profile: profile("work", ["helm"], 1) }),
    },
    failures: {
      "profile.removePlugin": wireError("profile.commonPlugin", {
        details: { name: "common-tools" },
      }),
    },
  });
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain("공통 묶음에서 온 것이라");
  expect(h.methods()).not.toContain("turn.start");
});

test("/profile remove of a plugin the profile does not have says so", async () => {
  const h = chat(["/profile remove alpha"], {
    handlers: {
      ...ADVERTISED_REMOVE,
      "profile.get": () => ({ profile: profile("work", ["helm"], 1) }),
    },
    failures: {
      "profile.removePlugin": wireError("profile.pluginNotInProfile", {
        details: { name: "alpha" },
      }),
    },
  });
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain("alpha 플러그인은 이 대화의 프로필에 없다");
});

test("/profile remove after a conflicting write asks to run it again", async () => {
  const h = chat(["/profile remove helm"], {
    handlers: {
      ...ADVERTISED_REMOVE,
      "profile.get": () => ({ profile: profile("work", ["helm"], 1) }),
    },
    failures: {
      "profile.removePlugin": wireError("profile.conflict", {
        details: { id: "work", rev: 2, baseRev: 1 },
      }),
    },
  });
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain("프로필이 바뀌었다");
  expect(h.stderrText()).toContain("명령을 다시 실행한다");
});

test("/profile with a bad form prints the usage line", async () => {
  const h = chat(["/profile"]);
  expect(await h.run(["chat", "--resume", T1])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain(USAGE);
});
