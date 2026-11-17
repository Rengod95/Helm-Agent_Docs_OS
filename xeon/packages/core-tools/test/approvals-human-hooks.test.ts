import { expect, test } from "bun:test";
import { parse, type Logger } from "@fresnel/contracts";
import { ApprovalResolvedPayloadSchema } from "@fresnel/contracts/records";
import type { ApprovalBody, ApprovalRequestInput } from "@fresnel/contracts/services";
import {
  callTool,
  createHarness,
  expectOk,
  installHandlers,
  registerWorkspace,
  until,
  type Harness,
} from "./support/harness.ts";

// M5e 스펙 §4.3.1(ask.human.before: 카드 없이 취소, 질문에만 답), §4.3.2(ask.human.after), §7 E-3(열린 실패), E-7(복원된 요청은 발화하지 않음).

const QUESTION: ApprovalBody = {
  kind: "question",
  question: {
    questions: [
      { id: "note", text: "Anything?", options: [], multiSelect: false, allowFreeText: true },
    ],
  },
};

function pendingCards(h: Harness) {
  return h.runtime.approvals.pending(h.thread);
}

function questionInput(h: Harness, requestKey: string): ApprovalRequestInput {
  return {
    origin: { threadId: h.thread, turnId: null, stepId: null, toolCallId: null, caller: "main" },
    requestKey,
    title: "Question",
    body: QUESTION,
    remember: ["once"],
  };
}

function resolvedPayloads(h: Harness) {
  return h.session.events
    .filter((event) => event.kind === "approval.resolved")
    .map((event) => {
      const parsed = parse(ApprovalResolvedPayloadSchema, event.payload);
      if (!parsed.ok) throw new Error("approval.resolved payload is not valid");
      return parsed.value;
    });
}

/** 경고 이벤트 이름을 모으는 기록기. 시험이 진단 로그를 확인한다 */
function capturingLogger(): { readonly logger: Logger; readonly warnings: string[] } {
  const warnings: string[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (event) => {
      warnings.push(event);
    },
    error: () => undefined,
    child: () => logger,
  };
  return { logger, warnings };
}

test("ask.human.before cancel resolves a tool card without showing it, as denied by the extension", async () => {
  const h = await createHarness();
  registerWorkspace(h);
  const after: unknown[] = [];
  await installHandlers(
    h,
    "canceller",
    ["tool.call.before", "ask.human.before", "ask.human.after"],
    (g) => {
      g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
      g.on("ask.human.before", () => ({ cancel: true, reason: "not now" }));
      g.on("ask.human.after", (payload) => {
        after.push(payload);
      });
    },
  );
  const out = await callTool(h.runtime.tools, h.run(), {
    id: "call_h1",
    name: "read",
    args: { path: "a.txt" },
  });
  expect(out.blocked).toBe(
    "[fresnel:denied_by_extension] An extension cancelled this approval request.",
  );
  expect(pendingCards(h)).toEqual([]);
  const resolved = resolvedPayloads(h);
  expect(resolved).toHaveLength(1);
  expect(resolved[0]).toMatchObject({
    decision: "deny",
    resolvedBy: "extension",
    resolvedByExtension: "canceller",
  });
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    askKind: "tool",
    resolution: { decision: "deny", resolvedBy: "extension", resolvedByExtension: "canceller" },
  });
});

test("ask.human.before answer resolves a question card with the answer", async () => {
  const h = await createHarness();
  await installHandlers(h, "answerer", ["ask.human.before"], (g) => {
    g.on("ask.human.before", () => ({
      answer: { note: { selected: [], text: "from hook" } },
      reason: "known",
    }));
  });
  const resolution = expectOk(
    await h.runtime.approvals.request(questionInput(h, "q-hook"), new AbortController().signal),
  );
  expect(resolution).toMatchObject({
    decision: "answer",
    answer: { note: { selected: [], text: "from hook" } },
    resolvedBy: "extension",
    resolvedByExtension: "answerer",
  });
  expect(pendingCards(h)).toEqual([]);
});

test("an answer from ask.human.before on a tool card is ignored: the card is shown and the ignore is logged (H-1)", async () => {
  const log = capturingLogger();
  const h = await createHarness({ logger: log.logger });
  const probe = registerWorkspace(h);
  await installHandlers(h, "answerer", ["tool.call.before", "ask.human.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
    g.on("ask.human.before", () => ({
      answer: { note: { selected: [], text: "x" } },
      reason: "nope",
    }));
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "call_h2",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  expect(log.warnings).toContain("tools.ask_human_answer_ignored");
  const [card] = pendingCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("a throwing ask.human.before leaves the question to the human (fail-open, E-3)", async () => {
  const h = await createHarness();
  const probe = registerWorkspace(h);
  await installHandlers(h, "broken", ["tool.call.before", "ask.human.before"], (g) => {
    g.on("tool.call.before", () => ({ ask: true, reason: "check the path" }));
    g.on("ask.human.before", () => {
      throw new Error("boom");
    });
  });
  const done = callTool(h.runtime.tools, h.run(), {
    id: "call_h3",
    name: "read",
    args: { path: "a.txt" },
  });
  await until(() => pendingCards(h).length === 1);
  const [card] = pendingCards(h);
  await h.runtime.approvals.respond(card?.approvalId ?? "", { decision: "allow" });
  await done;
  expect(probe.calls.map((call) => call.method)).toEqual(["read"]);
});

test("a known request does not fire ask.human.before again, and neither does a restored one (E-7)", async () => {
  const h = await createHarness();
  let fired = 0;
  await installHandlers(h, "counter", ["ask.human.before"], (g) => {
    g.on("ask.human.before", () => {
      fired += 1;
      return undefined;
    });
  });
  const input = questionInput(h, "q-known");
  expectOk(await h.runtime.approvals.open(input));
  expect(fired).toBe(1);
  expectOk(await h.runtime.approvals.open(input));
  expect(fired).toBe(1);
  expectOk(await h.runtime.approvals.restore(h.thread));
  expectOk(await h.runtime.approvals.open(input));
  expect(fired).toBe(1);
  const [pending] = pendingCards(h);
  await h.runtime.approvals.respond(pending?.approvalId ?? "", {
    decision: "answer",
    answer: { note: { selected: [], text: "ok" } },
  });
});

test("ask.human.after fires once after the user's answer is committed", async () => {
  const h = await createHarness();
  const after: unknown[] = [];
  await installHandlers(h, "watcher", ["ask.human.after"], (g) => {
    g.on("ask.human.after", (payload) => {
      after.push(payload);
    });
  });
  const opened = expectOk(await h.runtime.approvals.open(questionInput(h, "q-after")));
  await h.runtime.approvals.respond(opened.request.approvalId, {
    decision: "answer",
    answer: { note: { selected: [], text: "yes" } },
  });
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    askKind: "question",
    resolution: { decision: "answer", resolvedBy: "user" },
  });
});
