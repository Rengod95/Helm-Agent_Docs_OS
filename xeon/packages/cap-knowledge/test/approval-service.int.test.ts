import { idem } from "./support/helpers.ts";
import { afterEach, expect, test } from "bun:test";
import { eachAsync, repeatAsync } from "@xeon/contracts";
import { fakeApprovals } from "@xeon/core-tools/testing";
import type { CallContext } from "@xeon/contracts/capabilities";
import { createWriteApprovals } from "../src/ports/approvals.ts";
import { SCAN_RULESET_VERSION } from "../src/scan/rules.ts";
import { agentActor, contextOf, createPlan, request } from "./support/plans.ts";
import { closeWorlds, createWorld } from "./support/world.ts";

// 쓰기 승인 포트를 core-tools의 실제 `ApprovalService` 위에 얹어 본다(E5와 같은 레코드 모양). 대역 포트로는 승인 body가
// 서비스의 스키마에 맞는지 알 수 없다.

afterEach(closeWorlds);

async function pendingOf(
  approvals: Awaited<ReturnType<typeof fakeApprovals>>["approvals"],
  threadId: Parameters<Awaited<ReturnType<typeof fakeApprovals>>["approvals"]["pending"]>[0],
) {
  let attempts = 0;
  return await repeatAsync(async () => {
    const [first] = approvals.pending(threadId);
    if (first !== undefined) return { value: first };
    attempts += 1;
    if (attempts > 400) throw new Error("no pending approval appeared");
    await Bun.sleep(5);
    return undefined;
  });
}

async function setup() {
  const service = await fakeApprovals();
  const threadId = service.ids.next("thr");
  await service.openThread(threadId);
  const world = await createWorld({ approvals: createWriteApprovals(service.approvals) });
  const context = contextOf(threadId, { kind: "model", agent: "main" }, { toolCallId: "call-1" });
  return { service, threadId, world, context };
}

test("an agent write becomes a tool approval and an allow answer applies it", async () => {
  const { service, threadId, world, context } = await setup();
  const running = request(world.runtime.writer, {
    plan: createPlan(),
    actor: agentActor("main"),
    context,
    requestId: idem("write-1"),
  });
  const pending = await pendingOf(service.approvals, threadId);
  expect(pending.title).toBe("Approve skill.create on skill deploy?");
  expect(pending.remember).toEqual(["once"]);
  expect(pending.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "skill_manage",
      capability: { id: "knowledge.skills", method: "create" },
      risk: "write",
      ruleId: null,
      args: { op: "skill.create", afterUntrusted: false, baseHash: null },
    },
  });
  expect(world.fs.has("/data/skills/deploy/SKILL.md")).toBe(false);
  expect(await service.approvals.respond(pending.approvalId, { decision: "allow" })).toEqual({
    applied: true,
  });
  const outcome = await running;
  expect(outcome).toMatchObject({ ok: true, value: { status: "applied", approvedBy: "approval" } });
  expect(world.fs.has("/data/skills/deploy/SKILL.md")).toBe(true);

  // 같은 requestId로 다시 부르면 원장의 첫 결과가 돌아오고 승인 요청이 늘지 않는다
  const again = await request(world.runtime.writer, {
    plan: createPlan(),
    actor: agentActor("main"),
    context,
    requestId: idem("write-1"),
  });
  expect(again).toEqual(outcome);
  expect(
    service.session.events.filter((event) => event.kind === "approval.requested"),
  ).toHaveLength(1);
});

test("a deny answer with feedback refuses the write and keeps the files", async () => {
  const { service, threadId, world, context } = await setup();
  const running = request(world.runtime.writer, {
    plan: createPlan(),
    actor: agentActor("main"),
    context,
    requestId: idem("write-2"),
  });
  const pending = await pendingOf(service.approvals, threadId);
  await service.approvals.respond(pending.approvalId, {
    decision: "deny",
    answer: { feedback: "not now" },
  });
  expect(await running).toMatchObject({
    ok: false,
    error: { kind: "approval_denied", detail: { feedback: "not now" } },
  });
  expect(world.fs.has("/data/skills/deploy/SKILL.md")).toBe(false);
});

test("cancelling the wait leaves the approval request open", async () => {
  const { service, threadId, world, context } = await setup();
  const abort = new AbortController();
  const running = request(world.runtime.writer, {
    plan: createPlan(),
    actor: agentActor("main"),
    context,
    requestId: idem("write-3"),
    signal: abort.signal,
  });
  await pendingOf(service.approvals, threadId);
  abort.abort();
  expect(await running).toMatchObject({ ok: false, error: { kind: "aborted" } });
  expect(service.approvals.pending(threadId)).toHaveLength(1);
  expect(world.fs.has("/data/skills/deploy/SKILL.md")).toBe(false);
});

test("the approval origin caller is what approvalCallerOf makes from the call context (G1-09)", async () => {
  const cases: readonly (readonly [string, CallContext["caller"], string])[] = [
    ["main conversation", { kind: "model", agent: "main" }, "main"],
    ["subagent", { kind: "model", agent: "subagent", agentName: "explore" }, "subagent:explore"],
    ["background fork", { kind: "model", agent: "background" }, "background"],
    ["extension", { kind: "extension", extension: "grp-helm" }, "ext:grp-helm"],
    ["host", { kind: "host" }, "host"],
  ];
  await eachAsync(cases, async ([name, caller, expected]) => {
    const service = await fakeApprovals();
    const threadId = service.ids.next("thr");
    await service.openThread(threadId);
    const abort = new AbortController();
    const asking = createWriteApprovals(service.approvals).ask(
      {
        threadId,
        context: contextOf(threadId, caller, { toolCallId: "call-1" }),
        requestKey: "write-1",
        toolName: "skill_manage",
        capability: { id: "knowledge.skills", method: "create" },
        op: "skill.create",
        target: { kind: "skill", name: "deploy", scope: "user" },
        baseHash: null,
        preview: "+ new skill",
        scan: { rulesetVersion: SCAN_RULESET_VERSION, findings: [] },
        afterUntrusted: false,
      },
      abort.signal,
    );
    const pending = await pendingOf(service.approvals, threadId);
    expect([name, pending.origin.caller]).toEqual([name, expected]);
    abort.abort();
    await asking;
    return undefined;
  });
});
