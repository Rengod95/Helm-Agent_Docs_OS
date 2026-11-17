import { createHash } from "node:crypto";
import { canonicalJson, err, ok } from "@fresnel/contracts";
import type { JsonObject } from "@fresnel/contracts/conversation";
import { WRITE_ACCESS_RULE_ID, type L2ApprovalsPort } from "@fresnel/contracts/services";
import type { WriteAccessPort, WriteAccessRequest, WriteAccessVia } from "./ports/write-access.ts";

// 쓰기 허용 요청을 `fresnel.approvals`의 도구 승인 body로 옮긴다. 기존 도구 승인 카드가 그대로 그릴 수 있고, 새 선택지를 아는 화면은 구조화된 값으로 그린다.
// - ruleId는 `WRITE_ACCESS_RULE_ID`, args.subject는 "write_access"라 화면이 이 요청을 알아본다. 제목 문장은 화면이 번역 키로 대신 그린다.
// - args: `{ subject, tool, command?, writePaths, allowRoots, homeWide }`. 명령 원문(bash)은 도구 승인에서 이미 보여 준 것과 같다.
// - 선택지: `remember: ["once", "thread"]`. 허용+once = 이번만, 허용+thread = 앞으로 전부 허용, 거절 = 거절. 옛 카드의 허용은 once(이번만)다.

const METHOD_OF: Readonly<Record<WriteAccessVia, string>> = {
  bash: "run",
  write: "write",
  edit: "edit",
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function subjectOf(request: WriteAccessRequest): JsonObject {
  const args: JsonObject = {
    subject: "write_access",
    tool: request.via,
    ...(request.command === undefined ? {} : { command: request.command }),
    writePaths: [...request.paths],
    allowRoots: [...request.roots],
    homeWide: request.homeWide,
  };
  return {
    toolName: request.via,
    capability: {
      id: request.via === "bash" ? "workspace.shell" : "workspace.files",
      method: METHOD_OF[request.via],
    },
    risk: "write",
    args,
    argsHash: sha256Hex(canonicalJson(args)),
    ruleId: WRITE_ACCESS_RULE_ID,
  };
}

/** 화면 제목. `createBareL2ApprovalsPort(approvals, writeAccessTitle)`처럼 포트를 만들 때 넘긴다 */
export function writeAccessTitle(): string {
  return "Allow writing outside the workspace?";
}

export function createWriteAccessAdapter(approvals: L2ApprovalsPort): WriteAccessPort {
  return {
    async ask(request, signal) {
      const requested = await approvals.request({
        threadId: request.threadId,
        kind: "tool",
        subject: subjectOf(request),
        requestId: request.requestKey,
        remember: ["once", "thread"],
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
        if (!waited.ok) {
          await approvals.cancel(
            request.threadId,
            snapshot.approvalId,
            "write access request abandoned",
          );
          return err({ kind: "unavailable", message: "approval wait was cancelled" });
        }
        snapshot = waited.value;
      }
      if (snapshot.state !== "resolved" || snapshot.resolution?.decision !== "allow") {
        return ok("deny");
      }
      return ok(snapshot.resolution.remember === "thread" ? "allow_all" : "allow");
    },
    granted: async (threadId) =>
      (await approvals.remembered?.(threadId, WRITE_ACCESS_RULE_ID)) === true,
  };
}
