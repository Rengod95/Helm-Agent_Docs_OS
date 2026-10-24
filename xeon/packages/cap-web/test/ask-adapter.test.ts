import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type {
  L2ApprovalRequest,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
} from "@xeon/contracts/services";
import { createAskAdapter } from "../src/ask-adapter.ts";
import { approvalIdOf, threadIdOf } from "./support/ids.ts";

const SIGNAL = new AbortController().signal;

const REQUEST = {
  threadId: threadIdOf(1),
  capability: "web.fetch",
  host: "docs.example.com",
  reasons: ["policy_ask", "unseen_url"],
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
}): { port: L2ApprovalsPort; requests: L2ApprovalRequest[] } {
  const requests: L2ApprovalRequest[] = [];
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
    cancel: () => Promise.resolve({ applied: true }),
    wait() {
      if (options.waitCancelled === true) return Promise.resolve(err({ kind: "cancelled" }));
      return Promise.resolve(ok(options.waited ?? snapshot("resolved", "deny")));
    },
  };
  return { port, requests };
}

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
        capability: "web.fetch",
        host: "docs.example.com",
        reasons: ["policy_ask", "unseen_url"],
      },
    });
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
  });
});
