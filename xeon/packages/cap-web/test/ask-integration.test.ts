import { expect, test } from "bun:test";
import { repeatAsync } from "@fresnel/contracts";
import { fakeApprovals, l2ApprovalsPort } from "@fresnel/core-tools/testing";
import { createAskAdapter, webApprovalTitle } from "../src/ask-adapter.ts";

// cap-web의 질문 어댑터를 core-tools의 실제 ApprovalService에 붙인다(E4/E5). 대역 포트로는 body 모양 불일치를 잡지 못한다.

const SIGNAL = new AbortController().signal;

async function setup() {
  const world = await fakeApprovals();
  const threadId = world.ids.next("thr");
  await world.openThread(threadId);
  const port = l2ApprovalsPort(world.approvals, {
    origin: world.originOf(threadId),
    title: webApprovalTitle,
  });
  return { world, threadId, adapter: createAskAdapter(port) };
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

test("a web ask becomes a valid tool approval and an allow answer resumes the caller", async () => {
  const { world, threadId, adapter } = await setup();
  const asked = adapter.ask(
    {
      threadId,
      capability: "web.fetch",
      host: "docs.example.com",
      url: "https://docs.example.com/a",
      reasons: ["policy_ask", "unseen_url"],
      scopes: ["once", "site", "all"],
      requestKey: "web-call-1",
    },
    SIGNAL,
  );
  const request = await pendingOf(world.approvals, threadId);
  expect(request.title).toBe("Allow web access to docs.example.com?");
  expect(request.body).toMatchObject({
    kind: "tool",
    tool: {
      toolName: "web.fetch",
      capability: { id: "web.fetch", method: "fetch" },
      risk: "read",
      args: {
        subject: "web_access",
        host: "docs.example.com",
        url: "https://docs.example.com/a",
        tool: "web.fetch",
        reasons: ["policy_ask", "unseen_url"],
        scopes: ["once", "site", "all"],
      },
      ruleId: "web.access",
    },
  });
  expect(await world.approvals.respond(request.approvalId, { decision: "allow" })).toEqual({
    applied: true,
  });
  expect(await asked).toEqual({ ok: true, value: "allow" });
});

test("allow + always means this site, allow + thread means all sites, both through the real service", async () => {
  const { world, threadId, adapter } = await setup();
  const ask = (key: string) =>
    adapter.ask(
      {
        threadId,
        capability: "web.fetch",
        host: "docs.example.com",
        url: "https://docs.example.com/a",
        reasons: ["policy_ask"],
        scopes: ["once", "site", "all"],
        requestKey: key,
      },
      SIGNAL,
    );
  const site = ask("web-site");
  const first = await pendingOf(world.approvals, threadId);
  expect(first.remember).toEqual(["once", "always", "thread"]);
  await world.approvals.respond(first.approvalId, { decision: "allow", remember: "always" });
  expect(await site).toEqual({ ok: true, value: "allow_site" });
  const all = ask("web-all");
  const second = await pendingOf(world.approvals, threadId);
  await world.approvals.respond(second.approvalId, { decision: "allow", remember: "thread" });
  expect(await all).toEqual({ ok: true, value: "allow_all" });
});

test("a deny answer is a refusal and the same key does not open a second request", async () => {
  const { world, threadId, adapter } = await setup();
  const input = {
    threadId,
    capability: "web.search",
    host: "search.example",
    url: "https://search.example/",
    reasons: ["policy_ask"],
    scopes: ["once"],
    requestKey: "web-call-2",
  } as const;
  const asked = adapter.ask(input, SIGNAL);
  const request = await pendingOf(world.approvals, threadId);
  await world.approvals.respond(request.approvalId, { decision: "deny" });
  expect(await asked).toEqual({ ok: true, value: "deny" });
  expect(await adapter.ask(input, SIGNAL)).toEqual({ ok: true, value: "deny" });
  expect(world.session.events.filter((event) => event.kind === "approval.requested").length).toBe(
    1,
  );
});
