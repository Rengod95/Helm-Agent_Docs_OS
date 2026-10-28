import { describe, expect, test } from "bun:test";
import type { CallContext, SecretApprovalEvidence } from "../../src/capabilities/index.ts";
import type { ApprovalEvidence, UseCtx } from "../../src/services/index.ts";
import type { Equal, Expect } from "../types/expect.ts";

// L1.tools.spec §8.3 F 요청 13: CallContext.approval은 서비스 쪽 ApprovalEvidence와 같은 타입이다.
export type EvidenceIsOneType = Expect<Equal<SecretApprovalEvidence, ApprovalEvidence>>;
export type ContextCarriesEvidence = Expect<
  Equal<CallContext["approval"], SecretApprovalEvidence | undefined>
>;
// cap-workspace가 CallContext.approval ?? null을 SecretEnvRequest.ctx.approval에 그대로 옮길 수 있다
export type EvidenceFitsTheUseContext = Expect<
  Equal<NonNullable<UseCtx["approval"]>, SecretApprovalEvidence>
>;
export type ContextCarriesInteractivity = Expect<
  Equal<CallContext["interactive"], boolean | undefined>
>;

describe("CallContext", () => {
  test("a headless model call carries no approval and says it is not interactive", () => {
    const context: CallContext = { caller: { kind: "model", agent: "main" }, interactive: false };
    expect(context.approval).toBeUndefined();
    expect(context.interactive).toBe(false);
  });

  test("a secret-using call carries the evidence its tool must pass on", () => {
    const evidence: SecretApprovalEvidence = {
      approvalId: "evt_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      scope: "per-use",
      grantedAt: 1,
      expiresAt: null,
    };
    const context: CallContext = { caller: { kind: "model", agent: "main" }, approval: evidence };
    expect(context.approval).toBe(evidence);
  });
});
