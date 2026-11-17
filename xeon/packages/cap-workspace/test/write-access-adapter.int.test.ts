import { expect, test } from "bun:test";
import { repeatAsync } from "@fresnel/contracts";
import { fakeApprovals, l2ApprovalsPort } from "@fresnel/core-tools/testing";
import { createWriteAccessAdapter, writeAccessTitle } from "@fresnel/core-workspace";

// 어댑터를 core-tools의 실제 ApprovalService에 붙인다. 대역 포트로는 body 모양·기억 범위 불일치를 잡지 못한다.

const SIGNAL = new AbortController().signal;

async function setup() {
  const world = await fakeApprovals();
  const threadId = world.ids.next("thr");
  await world.openThread(threadId);
  const port = l2ApprovalsPort(world.approvals, {
    origin: world.originOf(threadId),
    title: writeAccessTitle,
  });
  return { world, threadId, adapter: createWriteAccessAdapter(port) };
}

async function pendingOf(
  approvals: Awaited<ReturnType<typeof fakeApprovals>>["approvals"],
  threadId: Parameters<Awaited<ReturnType<typeof fakeApprovals>>["approvals"]["pending"]>[0],
) {
  let attempts = 0;
  return await repeatAsync(async () => {
    const [first] = approvals.pending(threadId);
    if (first !== undefined) return { value: first };
    attempts += 1;
    if (attempts > 200) throw new Error("no pending approval appeared");
    await Bun.sleep(5);
    return undefined;
  });
}

function request(
  threadId: Parameters<ReturnType<typeof createWriteAccessAdapter>["ask"]>[0]["threadId"],
  key: string,
) {
  return {
    threadId,
    via: "bash",
    command: "npm ci",
    paths: ["/Users/u/.npm/_logs/1.log"],
    roots: ["/Users/u/.npm"],
    homeWide: false,
    requestKey: key,
  } as const;
}

test("the request is a valid tool approval with structured values and offers once and thread", async () => {
  const { world, threadId, adapter } = await setup();
  const asked = adapter.ask(request(threadId, "wa-a"), SIGNAL);
  const pending = await pendingOf(world.approvals, threadId);
  expect(pending.remember).toEqual(["once", "thread"]);
  expect(pending.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "bash",
      risk: "write",
      ruleId: "sandbox.write_access",
      args: {
        subject: "write_access",
        tool: "bash",
        command: "npm ci",
        writePaths: ["/Users/u/.npm/_logs/1.log"],
        allowRoots: ["/Users/u/.npm"],
        homeWide: false,
      },
    },
  });
  await world.approvals.respond(pending.approvalId, { decision: "deny" });
  expect(await asked).toEqual({ ok: true, value: "deny" });
});

test("allow once, allow all (thread) and deny map to the three answers, and granted follows the record", async () => {
  const { world, threadId, adapter } = await setup();
  expect(await adapter.granted?.(threadId)).toBe(false);

  const once = adapter.ask(request(threadId, "wa-once"), SIGNAL);
  const first = await pendingOf(world.approvals, threadId);
  await world.approvals.respond(first.approvalId, { decision: "allow" });
  expect(await once).toEqual({ ok: true, value: "allow" });
  expect(await adapter.granted?.(threadId)).toBe(false);

  const all = adapter.ask(request(threadId, "wa-all"), SIGNAL);
  const second = await pendingOf(world.approvals, threadId);
  await world.approvals.respond(second.approvalId, { decision: "allow", remember: "thread" });
  expect(await all).toEqual({ ok: true, value: "allow_all" });
  expect(await adapter.granted?.(threadId)).toBe(true);
  expect(await adapter.granted?.(world.ids.next("thr"))).toBe(false);
});
