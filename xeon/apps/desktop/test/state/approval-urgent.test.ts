import { describe, expect, test } from "bun:test";
import type { MirrorInput } from "../../src/state/engine/input.ts";
import { reduceMirror } from "../../src/state/engine/reduce.ts";
import { selectApprovalUrgent } from "../../src/state/engine/selectors.ts";
import { INITIAL_MIRROR, type EngineMirror } from "../../src/state/engine/state.ts";
import { approvalRequest, evt, STORE, thr } from "./helpers.ts";

// 크리스탈 표시의 급함(DP-223): 시한(`expiresAt`)이 있는 대기 승인이 있는지. 대화마다 본다

function mirrorWith(expiring: boolean): EngineMirror {
  const inputs: MirrorInput[] = [
    { type: "subscribed", sub: "s1", storeId: STORE, start: 5, live: true, from: "head" },
    {
      type: "approvals",
      approvals: [
        { approvalId: evt(7), seq: 4, request: approvalRequest(thr(1)) },
        {
          approvalId: evt(8),
          seq: 5,
          request: expiring
            ? { ...approvalRequest(thr(2)), expiresAt: 1_000 }
            : approvalRequest(thr(2)),
        },
      ],
    },
  ];
  return inputs.reduce((state, input) => reduceMirror(state, input).state, INITIAL_MIRROR);
}

describe("approval urgency", () => {
  test("only the thread whose waiting approval has a deadline is urgent", () => {
    const s = mirrorWith(true);
    expect([
      selectApprovalUrgent(s, thr(1)),
      selectApprovalUrgent(s, thr(2)),
      selectApprovalUrgent(s, thr(3)),
    ]).toEqual([false, true, false]);
  });

  test("no deadline anywhere is calm", () => {
    const s = mirrorWith(false);
    expect([selectApprovalUrgent(s, thr(1)), selectApprovalUrgent(s, thr(2))]).toEqual([
      false,
      false,
    ]);
    expect(selectApprovalUrgent(INITIAL_MIRROR, thr(1))).toBe(false);
  });
});
