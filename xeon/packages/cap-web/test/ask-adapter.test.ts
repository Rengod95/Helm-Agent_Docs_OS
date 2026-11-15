import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type {
  L2ApprovalRequest,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
} from "@fresnel/contracts/services";
import { createAskAdapter } from "../src/ask-adapter.ts";
import { approvalIdOf, threadIdOf } from "./support/ids.ts";

const SIGNAL = new AbortController().signal;

const REQUEST = {
  threadId: threadIdOf(1),
  capability: "web.fetch",
  host: "docs.example.com",
  url: "https://docs.example.com/a?q=1",
  reasons: ["policy_ask", "unseen_url"],
  scopes: ["once", "site", "all"],
  requestKey: "web-abc",
} as const;

function snapshot(
  state: L2ApprovalSnapshot["state"],
  decision?: "allow" | "deny",
): L2ApprovalSnapshot {
  return {
    approvalId: approvalIdOf(1),
    state,
    resolution: decision === undefined ? null : { decision, answer: null },
  };
}

function portOf(options: {
  requested: L2ApprovalSnapshot;
  waited?: L2ApprovalSnapshot;
  requestFails?: boolean;
  waitCancelled?: boolean;
}): { port: L2ApprovalsPort; requests: L2ApprovalRequest[]; cancelled: string[] } {
  const requests: L2ApprovalRequest[] = [];
  const cancelled: string[] = [];
  const port: L2ApprovalsPort = {
    request(input) {
      requests.push(input);
      if (options.requestFails === true) {
        return Promise.resolve(err({ kind: "key_reused", requestId: input.requestId }));
      }
      return Promise.resolve(ok(options.requested));
    },
    get: () => Promise.resolve(ok(null)),
    respond: () => Promise.resolve({ applied: true }),
    cancel: (_threadId, approvalId) => {
      cancelled.push(approvalId);
      return Promise.resolve({ applied: true });
    },
    wait() {
      if (options.waitCancelled === true) return Promise.resolve(err({ kind: "cancelled" }));
      return Promise.resolve(ok(options.waited ?? snapshot("resolved", "deny")));
    },
  };
  return { port, requests, cancelled };
}

const withRemember = (remember: "once" | "always" | "thread"): L2ApprovalSnapshot => ({
  approvalId: approvalIdOf(1),
  state: "resolved",
  resolution: { decision: "allow", answer: null, remember },
});

describe("ask adapter", () => {
  test("sends a tool approval with the host and reasons, then waits for the answer", async () => {
    const { port, requests } = portOf({
      requested: snapshot("pending"),
      waited: snapshot("resolved", "allow"),
    });
    const answer = await createAskAdapter(port).ask(REQUEST, SIGNAL);
    expect(answer).toEqual({ ok: true, value: "allow" });
    expect(requests[0]).toMatchObject({
      kind: "tool",
      requestId: "web-abc",
      subject: {
        toolName: "web.fetch",
        capability: { id: "web.fetch", method: "fetch" },
        risk: "read",
        args: {
          subject: "web_access",
          host: "docs.example.com",
          url: "https://docs.example.com/a?q=1",
          tool: "web.fetch",
          reasons: ["policy_ask", "unseen_url"],
          scopes: ["once", "site", "all"],
        },
        ruleId: "web.access",
      },
      remember: ["once", "always", "thread"],
    });
  });

  test("the remember scope of an allow maps to the answer", async () => {
    const answers = await Promise.all(
      (["once", "always", "thread"] as const).map((remember) =>
        createAskAdapter(portOf({ requested: withRemember(remember) }).port).ask(REQUEST, SIGNAL),
      ),
    );
    expect(answers).toEqual([
      { ok: true, value: "allow" },
      { ok: true, value: "allow_site" },
      { ok: true, value: "allow_all" },
    ]);
  });

  test("an allow without a remember field (an old card) is once", async () => {
    const { port } = portOf({ requested: snapshot("resolved", "allow") });
    expect(await createAskAdapter(port).ask(REQUEST, SIGNAL)).toEqual({ ok: true, value: "allow" });
  });

  test("a once-only question offers only once", async () => {
    const { port, requests } = portOf({ requested: snapshot("resolved", "allow") });
    await createAskAdapter(port).ask({ ...REQUEST, scopes: ["once"] }, SIGNAL);
    expect(requests[0]?.remember).toEqual(["once"]);
  });

  test("an already resolved request is not waited for", async () => {
    const { port } = portOf({
      requested: snapshot("resolved", "deny"),
      waited: snapshot("resolved", "allow"),
    });
    expect(await createAskAdapter(port).ask(REQUEST, SIGNAL)).toEqual({ ok: true, value: "deny" });
  });

  test("a cancelled request counts as a refusal", async () => {
    const { port } = portOf({ requested: snapshot("cancelled") });
    expect(await createAskAdapter(port).ask(REQUEST, SIGNAL)).toEqual({ ok: true, value: "deny" });
  });

  test("request failure and wait cancellation are unavailable", async () => {
    const failed = portOf({ requested: snapshot("pending"), requestFails: true });
    const one = await createAskAdapter(failed.port).ask(REQUEST, SIGNAL);
    expect(one.ok).toBe(false);
    const cancelled = portOf({ requested: snapshot("pending"), waitCancelled: true });
    const two = await createAskAdapter(cancelled.port).ask(REQUEST, SIGNAL);
    expect(two.ok).toBe(false);
    // 기다림이 끊긴 요청은 닫는다(남은 승인 정리)
    expect(cancelled.cancelled).toEqual([snapshot("pending").approvalId]);
    expect(failed.cancelled).toEqual([]);
  });
});
