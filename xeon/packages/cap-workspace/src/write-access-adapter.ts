import { createHash } from "node:crypto";
import { canonicalJson, err, ok } from "@fresnel/contracts";
import type { JsonObject } from "@fresnel/contracts/conversation";
import type { L2ApprovalsPort } from "@fresnel/contracts/services";
import type { WriteAccessPort, WriteAccessRequest, WriteAccessVia } from "./ports/write-access.ts";

// 쓰기 허용 요청을 `fresnel.approvals`의 도구 승인 body로 옮긴다. 새 화면 부품 없이 기존 도구 승인 카드에 뜬다.
// toolName은 실제 도구 이름(bash, write, edit)이고 args는 `{ writePaths, allowRoots }`다. 명령 원문은 싣지 않는다(비밀이 섞일 수 있고, 명령은 도구 승인에서 이미 봤다).

const METHOD_OF: Readonly<Record<WriteAccessVia, string>> = {
  bash: "run",
  write: "write",
  edit: "edit",
};

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function subjectOf(request: WriteAccessRequest): JsonObject {
  const args: JsonObject = { writePaths: [...request.paths], allowRoots: [...request.roots] };
  return {
    toolName: request.via,
    capability: {
      id: request.via === "bash" ? "workspace.shell" : "workspace.files",
      method: METHOD_OF[request.via],
    },
    risk: "write",
    args,
    argsHash: sha256Hex(canonicalJson(args)),
    ruleId: null,
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
      return ok(
        snapshot.state === "resolved" && snapshot.resolution?.decision === "allow"
          ? "allow"
          : "deny",
      );
    },
  };
}
