import { canonicalJson, err, ok, parse } from "@fresnel/contracts";
import type { JsonObject } from "@fresnel/contracts/conversation";
import {
  WEB_ACCESS_RULE_ID,
  type ApprovalRemember,
  type L2ApprovalRequest,
  type L2ApprovalsPort,
} from "@fresnel/contracts/services";
import { Type } from "typebox";
import type { WebAskAnswer, WebAskPort, WebAskRequest, WebAskScope } from "./ports/ask.ts";
import { sha256Hex } from "./util/hash.ts";

// 도메인·URL 승인 요청을 `fresnel.approvals`의 도구 승인 body(`ToolApprovalDetail`, additionalProperties:false)로 옮긴다.
// 도메인 대상을 body로 바꾸는 규칙은 cap-*가 가진다(core-tools `l2ApprovalsPort` 주석).
//
// - toolName은 기능 id(`web.fetch`)이고 capability.method는 그 기능의 메서드 이름이다.
// - risk는 `ToolRisk`("read"|"write"|"exec") 안에서만 고를 수 있다. 웹 기능은 읽기라 "read"다. 허용 목록에 없는 값은
//   core-tools가 body를 읽지 못해 요청을 거부한다.
// - args는 `{ subject: "web_access", host, url, tool, reasons, scopes }`이고 argsHash는 그 정규화 JSON의 sha256이다. ruleId는 `WEB_ACCESS_RULE_ID`다.
//   화면은 `ruleId`나 `args.subject`로 이 요청을 알아보고 `args.scopes`로 선택지를 그린다. 제목 문장은 영어 대체 문장이다.
// - 선택지: 승인 요청의 `remember`는 `scopes`를 옮긴 목록이다. 허용+once = 이번만, 허용+always = 이 사이트 계속 허용(`site`), 허용+thread = 모든 사이트 허용(`all`),
//   거절 = 거절. 옛 카드의 허용은 once(이번만)다. `thread`는 이름과 달리 그 대화에 묶이지 않는다(L1.tools.spec §4.7 6번 예외 2).

const METHOD_OF: Readonly<Record<WebAskRequest["capability"], string>> = {
  "web.search": "search",
  "web.fetch": "fetch",
  "web.browse": "browse",
};

const HostSubjectSchema = Type.Object({
  tool: Type.Object({ args: Type.Object({ host: Type.String() }) }),
});

const REMEMBER_OF: Readonly<Record<WebAskScope, ApprovalRemember>> = {
  once: "once",
  site: "always",
  all: "thread",
};

/** 승인 요청의 대상(`kind: "tool"`의 body 내용) */
function webAskSubject(request: WebAskRequest): JsonObject {
  const args: JsonObject = {
    subject: "web_access",
    host: request.host,
    url: request.url,
    tool: request.capability,
    reasons: [...request.reasons],
    scopes: [...request.scopes],
  };
  return {
    toolName: request.capability,
    capability: { id: request.capability, method: METHOD_OF[request.capability] },
    risk: "read",
    args,
    argsHash: sha256Hex(canonicalJson(args)),
    ruleId: WEB_ACCESS_RULE_ID,
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

function answerOf(remember: ApprovalRemember | undefined): WebAskAnswer {
  if (remember === "always") return "allow_site";
  if (remember === "thread") return "allow_all";
  return "allow";
}

/** `fresnel.approvals`의 L2 공통 포트를 웹 승인 요청 모양으로 감싼다. 요청 kind는 `tool`, 대상은 `webAskSubject`다 */
export function createAskAdapter(approvals: L2ApprovalsPort): WebAskPort {
  return {
    async ask(request, signal) {
      const requested = await approvals.request({
        threadId: request.threadId,
        kind: "tool",
        subject: webAskSubject(request),
        requestId: request.requestKey,
        remember: request.scopes.map((scope) => REMEMBER_OF[scope]),
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
          // 기다림이 끊기면(호출이 중단됨, 탐구 하위 대화가 끝남) 답을 줄 곳이 없는 요청이므로 닫는다. 남기면 승인 대기 표시가 계속 남는다
          await approvals.cancel(
            request.threadId,
            snapshot.approvalId,
            "web access request abandoned",
          );
          return err({ kind: "unavailable", message: "approval wait was cancelled" });
        }
        snapshot = waited.value;
      }
      if (snapshot.state !== "resolved" || snapshot.resolution?.decision !== "allow") {
        return ok("deny");
      }
      return ok(answerOf(snapshot.resolution.remember));
    },
  };
}
