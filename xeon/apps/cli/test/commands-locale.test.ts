import { afterEach, beforeEach, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { describeResumable, resumeResultText } from "../src/commands/resume-turn.ts";
import { EXIT } from "../src/exit-codes.ts";
import { parseSlash } from "../src/slash.ts";
import { summary } from "./support/m2.ts";
import { approvalRequested, turnCompleted } from "./support/events.ts";
import { createMemoryGroupFs } from "./support/group-fs.ts";
import { createHarness, type Harness } from "./support/harness.ts";
import { threadId, turnId } from "./support/ids.ts";

// schedule, sessions, group new, chat, slash, 끊긴 turn의 문장을 영어 로케일에서 전체 문자열로 비교한다.
// 시험 프로세스의 로케일은 ko이므로 끝나면 되돌린다.

const harnesses: Harness[] = [];
let before: Locale = "ko";

beforeEach(() => {
  before = activeLocale();
  setActiveLocale("en");
});

afterEach(() => {
  setActiveLocale(before);
  for (const harness of harnesses.splice(0)) harness.dispose();
});

test("schedule add refused for a short interval names the minimum in English", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: {
        "schedule.create": () => ({
          ok: false,
          error: { kind: "interval_too_short", minSeconds: 300 },
        }),
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["schedule", "add", "--every", "60", "요약"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "fresnel: The interval is shorter than the minimum (300s)\n  Fix: Use --every with 300 or more\n",
  );
});

test("sessions ls in an empty folder says so in English and names --all", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: { handlers: { "thread.list": () => ({ threads: [], nextCursor: null }) } },
  });
  harnesses.push(h);
  expect(await h.run(["sessions", "ls"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("There are no conversations in this folder (use --all to see all)\n");
});

test("sessions ls marks each conversation with its flags in English", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: {
        "thread.list": () => ({
          threads: [
            summary(threadId(1), {
              title: null,
              pendingApprovals: 2,
              queuedInputs: 1,
              resumable: {
                turnId: turnId(7),
                runningSince: "2026-01-05T00:05:00.000Z",
                resumeAttempts: 0,
              },
            }),
          ],
          nextCursor: null,
        }),
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["sessions", "ls", "--all"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe(
    "thr_00000000000000000000000001  2026-01-05T00:10:00.000Z  idle  (untitled)  [resumable, pending approvals: 2, queued inputs: 1]\n",
  );
});

test("group new refuses a name that clashes with an installed extension, in English", async () => {
  const index = JSON.stringify({
    schemaVersion: 1,
    templates: {
      observe: { description: "d", files: ["common/package.json"], drives: false },
      drive: { description: "d", files: ["common/package.json"], drives: true },
      policy: { description: "d", files: ["common/package.json"], drives: false },
    },
  });
  const fake = createMemoryGroupFs({ index, installed: ["helm"] });
  const h = createHarness({
    env: { NO_COLOR: "1" },
    cwd: "/work/project",
    groupTemplates: fake.port,
  });
  harnesses.push(h);
  expect(await h.run(["group", "new", "helm"])).toBe(EXIT.usage);
  expect(h.stderrText()).toBe(
    'fresnel: "helm" overlaps with an installed extension name\n  Fix: Choose another name\n',
  );
});

test("a failed print turn with --json names the error and the fix in English", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [turnCompleted(context.turnId, "failed", "boom")]);
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "x", "--json"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "fresnel: The turn failed: boom\n  Fix: Run without --json to see the reason in readable output\n",
  );
});

test("a failed print turn names the reason and the fix in English, without the raw JSON", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          turnCompleted(
            context.turnId,
            "failed",
            '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
          ),
        ]);
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "x"])).toBe(EXIT.error);
  expect(h.stderrText()).toBe(
    "fresnel: The API key was not accepted\n  Fix: Register the key again with `fresnel secret set <name>`\n",
  );
});

test("--auto-approve says in English that an already resolved approval was handled", async () => {
  const h = createHarness({
    env: { NO_COLOR: "1" },
    server: {
      handlers: { "approval.respond": () => ({ applied: false, reason: "already_resolved" }) },
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          approvalRequested(context.threadId, context.turnId, { title: "run ls" }),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  expect(await h.run(["chat", "-p", "run it", "--auto-approve"])).toBe(EXIT.ok);
  expect(h.stderrText()).toContain('Approval request "run ls" was already handled\n');
});

test("a usage slash command names its syntax in English", () => {
  expect(parseSlash("/set")).toEqual({ kind: "usage", message: "Usage: /set <key> <value>" });
});

test("the resumable question counts attempts in English, with the plural form", () => {
  const resumable = {
    turnId: turnId(7),
    runningSince: "2026-01-05T00:05:00.000Z",
    resumeAttempts: 0,
  };
  expect(describeResumable(resumable)).toBe(
    "This conversation has an interrupted turn (started 2026-01-05T00:05:00.000Z)\n",
  );
  expect(describeResumable({ ...resumable, resumeAttempts: 1 })).toBe(
    "This conversation has an interrupted turn (started 2026-01-05T00:05:00.000Z, tried to resume 1 time)\n",
  );
  expect(describeResumable({ ...resumable, resumeAttempts: 2 })).toBe(
    "This conversation has an interrupted turn (started 2026-01-05T00:05:00.000Z, tried to resume 2 times)\n",
  );
  expect(resumeResultText({ status: "closed", turnId: turnId(7), reason: "owner_cancelled" })).toBe(
    "The owner cancelled the turn, so it was closed without resuming\n",
  );
});
