import { canonicalJson, err, ok, parse } from "@xeon/contracts";
import type { JsonObject } from "@xeon/contracts/conversation";
import type { L2ApprovalRequest, L2ApprovalsPort } from "@xeon/contracts/services";
import { Type } from "typebox";
import type { WebAskPort, WebAskRequest } from "./ports/ask.ts";
import { sha256Hex } from "./util/hash.ts";

// 도메인·URL 승인 요청을 `xeon.approvals`의 도구 승인 body(`ToolApprovalDetail`, additionalProperties:false)로 옮긴다.
// 도메인 대상을 body로 바꾸는 규칙은 cap-*가 가진다(core-tools `l2ApprovalsPort` 주석).
//
// - toolName은 능력 id(`web.fetch`)이고 capability.method는 그 능력의 메서드 이름이다.
// - risk는 `ToolRisk`("read"|"write"|"exec") 안에서만 고를 수 있다. 웹 능력은 읽기라 "read"다. 허용 목록에 없는 값은
//   core-tools가 body를 읽지 못해 요청을 거부한다.
// - args는 `{ host, reasons }`이고 argsHash는 그 정규화 JSON의 sha256이다. ruleId는 도메인 규칙이 아니라 웹 정책이 낸 질문이라 null이다.

const METHOD_OF: Readonly<Record<WebAskRequest["capability"], string>> = {
  "web.search": "search",
  "web.fetch": "fetch",
  "web.browse": "browse",
};

const HostSubjectSchema = Type.Object({
  tool: Type.Object({ args: Type.Object({ host: Type.String() }) }),
});

/** 승인 요청의 대상(`kind: "tool"`의 body 내용) */
function webAskSubject(request: WebAskRequest): JsonObject {
  const args: JsonObject = { host: request.host, reasons: [...request.reasons] };
  return {
    toolName: request.capability,
    capability: { id: request.capability, method: METHOD_OF[request.capability] },
    risk: "read",
    args,
    argsHash: sha256Hex(canonicalJson(args)),
    ruleId: null,
  };
}

/**
 * 화면 제목. `l2ApprovalsPort(..., { title: webApprovalTitle })`처럼 포트를 만들 때 넘긴다.
 * L2 요청에는 제목 칸이 없어 호스트 이름을 대상에서 읽어 만든다
 */
export function webApprovalTitle(request: L2ApprovalRequest): string {
  const parsed = parse(HostSubjectSchema, { tool: request.subject });
  return parsed.ok
    ? `Allow web access to ${parsed.value.tool.args.host}?`
    : "Allow this web access?";
}

/** `xeon.approvals`의 L2 공통 포트를 웹 승인 요청 모양으로 감싼다. 요청 kind는 `tool`, 대상은 `webAskSubject`다 */
export function createAskAdapter(approvals: L2ApprovalsPort): WebAskPort {
  return {
    async ask(request, signal) {
      const requested = await approvals.request({
        threadId: request.threadId,
        kind: "tool",
        subject: webAskSubject(request),
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
