import { err, ok } from "@xeon/contracts";
import type { L2ApprovalsPort } from "@xeon/contracts/services";
import type { WebAskPort } from "./ports/ask.ts";

/** `xeon.approvals`의 L2 공통 포트를 웹 승인 요청 모양으로 감싼다. 요청 kind는 `tool`, 대상은 `{ capability, host, reasons }`다 */
export function createAskAdapter(approvals: L2ApprovalsPort): WebAskPort {
  return {
    async ask(request, signal) {
      const requested = await approvals.request({
        threadId: request.threadId,
        kind: "tool",
        subject: {
          capability: request.capability,
          host: request.host,
          reasons: [...request.reasons],
        },
        requestId: request.requestKey,
      });
      if (!requested.ok) {
        return err({
          kind: "unavailable",
          message: `approval request failed: ${requested.error.kind}`,
        });
      }
      let snapshot = requested.value;
      if (snapshot.state === "pending") {
        const waited = await approvals.wait(request.threadId, snapshot.approvalId, signal);
        if (!waited.ok) return err({ kind: "unavailable", message: "approval wait was cancelled" });
        snapshot = waited.value;
      }
      return ok(
        snapshot.state === "resolved" && snapshot.resolution?.decision === "allow"
          ? "allow"
          : "deny",
      );
    },
  };
}
