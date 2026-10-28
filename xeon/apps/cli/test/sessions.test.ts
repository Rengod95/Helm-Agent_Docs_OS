import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { assistantItem, turnCompleted, userItem } from "./support/events.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId, turnId } from "./support/ids.ts";
import { summary } from "./support/m2.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness({ env: { NO_COLOR: "1" }, ...options });
  harnesses.push(created);
  return created;
}

const T1 = threadId(1);
const T2 = threadId(2);

test("sessions ls asks for the current working folder and prints one line per session", async () => {
  const seen: unknown[] = [];
  const h = harness({
    server: {
      handlers: {
        "thread.list": (params) => {
          seen.push(params);
          return {
            threads: [
              summary(T1, {
                title: "첫 세션",
                resumable: {
                  turnId: turnId(1),
                  runningSince: "2026-01-05T00:00:00.000Z",
                  resumeAttempts: 0,
                },
              }),
              summary(T2, { pendingApprovals: 2 }),
            ],
            nextCursor: null,
          };
        },
      },
    },
  });
  expect(await h.run(["sessions", "ls"])).toBe(EXIT.ok);
  expect(seen).toEqual([{ limit: 20, workspace: "/work/project" }]);
  const lines = h.stdoutText().trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain(T1);
  expect(lines[0]).toContain("첫 세션");
  expect(lines[0]).toContain("이어서 실행 가능");
  expect(lines[1]).toContain("(제목 없음)");
  expect(lines[1]).toContain("승인 대기 2");
  expect(h.closed()).toBe(true);
});

test("sessions ls --all drops the workspace filter and follows the cursor up to --limit", async () => {
  const pages: unknown[] = [];
  const h = harness({
    server: {
      handlers: {
        "thread.list": (params) => {
          pages.push(params);
          return params["cursor"] === undefined
            ? { threads: [summary(T1)], nextCursor: "c2" }
            : { threads: [summary(T2)], nextCursor: null };
        },
      },
    },
  });
  expect(await h.run(["sessions", "ls", "--all", "--limit", "5", "--json"])).toBe(EXIT.ok);
  expect(pages).toEqual([{ limit: 5 }, { limit: 4, cursor: "c2" }]);
  const parsed: unknown = JSON.parse(h.stdoutText());
  expect(Array.isArray(parsed) ? parsed.length : -1).toBe(2);
});

test("sessions ls says so on stderr when there is nothing", async () => {
  const h = harness({
    server: { handlers: { "thread.list": () => ({ threads: [], nextCursor: null }) } },
  });
  expect(await h.run(["sessions", "ls"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("");
  expect(h.stderrText()).toContain("세션이 없다");
});

test("sessions show draws the durable events as a transcript and unsubscribes", async () => {
  const h = harness();
  const turn = turnId(1);
  h.seed(T1, [
    userItem(turn, 1, "안녕"),
    assistantItem(turn, 2, { text: "반가워" }),
    turnCompleted(turn),
  ]);
  expect(await h.run(["sessions", "show", T1])).toBe(EXIT.ok);
  expect(h.stdoutText()).toContain("> 안녕");
  expect(h.stdoutText()).toContain("반가워");
  expect(h.methods()).toContain("events.unsubscribe");
  expect(h.closed()).toBe(true);
});

test("sessions show --json prints the events as one JSON document", async () => {
  const h = harness();
  const turn = turnId(1);
  h.seed(T1, [userItem(turn, 1, "안녕"), turnCompleted(turn)]);
  expect(await h.run(["sessions", "show", T1, "--json"])).toBe(EXIT.ok);
  const parsed: unknown = JSON.parse(h.stdoutText());
  expect(Array.isArray(parsed) ? parsed.length : -1).toBe(2);
});

test("sessions show on an unknown id exits 1 with the not-found message", async () => {
  const h = harness();
  expect(await h.run(["sessions", "show", T2])).toBe(EXIT.error);
  expect(h.stderrText()).toContain(`세션 ${T2}이(가) 없다`);
  expect(h.stderrText()).toContain("xeon sessions ls");
});

test("sessions fork prints the new id and passes --at", async () => {
  const seen: unknown[] = [];
  const h = harness({
    server: {
      handlers: {
        "thread.fork": (params) => {
          seen.push(params);
          return { threadId: T2, position: { storeId: "sto_00000000000000000000000001", seq: 3 } };
        },
      },
    },
  });
  expect(await h.run(["sessions", "fork", T1])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe(`${T2}\n`);
  expect(seen).toEqual([{ threadId: T1 }]);
});

test("sessions fork maps thread.invalidTarget to a readable error", async () => {
  const h = harness({
    server: {
      handlers: {
        "thread.fork": () => {
          throw wireError("thread.invalidTarget", { details: { reason: "inside_turn" } });
        },
      },
    },
  });
  expect(await h.run(["sessions", "fork", T1])).toBe(EXIT.error);
  expect(h.stderrText()).toContain("분기할 수 없는 위치다 (inside_turn)");
});

test("sessions rm without --yes on a pipe exits 2 without touching the engine", async () => {
  const h = harness();
  expect(await h.run(["sessions", "rm", T1])).toBe(EXIT.usage);
  expect(h.stderrText()).toContain("--yes");
  expect(h.closed()).toBe(false);
});

test("sessions rm --yes deletes; a session with forks reports it", async () => {
  const deleted: unknown[] = [];
  const ok = harness({
    server: { handlers: { "thread.delete": (params) => (deleted.push(params), {}) } },
  });
  expect(await ok.run(["sessions", "rm", T1, "--yes"])).toBe(EXIT.ok);
  expect(deleted).toEqual([{ threadId: T1 }]);
  expect(ok.stdoutText()).toBe(`지웠다: ${T1}\n`);

  const blocked = harness({
    server: {
      handlers: {
        "thread.delete": () => {
          throw wireError("thread.hasForks", { details: { forks: [String(T2)] } });
        },
      },
    },
  });
  expect(await blocked.run(["sessions", "rm", T1, "--yes"])).toBe(EXIT.error);
  expect(blocked.stderrText()).toContain("분기한 세션이 있어 지울 수 없다");
});

test("sessions rm on a terminal asks first: y deletes, anything else keeps the session", async () => {
  const asked: string[] = [];
  const yes = harness({
    terminal: { stdinIsTty: true, stdoutIsTty: true },
    readLine: (prompt) => (asked.push(prompt), Promise.resolve("y")),
    server: { handlers: { "thread.delete": () => ({}) } },
  });
  expect(await yes.run(["sessions", "rm", T1])).toBe(EXIT.ok);
  expect(asked[0]).toContain(`세션 ${T1}`);

  const no = harness({
    terminal: { stdinIsTty: true, stdoutIsTty: true },
    readLine: () => Promise.resolve("n"),
    server: { handlers: { "thread.delete": () => ({}) } },
  });
  expect(await no.run(["sessions", "rm", T1])).toBe(EXIT.error);
  expect(no.methods()).toEqual([]);
  expect(no.closed()).toBe(false);
  expect(no.stderrText()).toContain("지우지 않았다");
});
