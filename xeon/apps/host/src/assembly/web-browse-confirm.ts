import { createHash } from "node:crypto";
import { err, ok } from "@xeon/contracts";
import type { JsonValue } from "@xeon/contracts/conversation";
import { requestKeyFor } from "@xeon/contracts/records";
import type { ApprovalService } from "@xeon/contracts/services";
import type { BrowseConfirmPort, BrowseConfirmRequest } from "@xeon/cap-web";

type BrowseConfirmReason = BrowseConfirmRequest["reason"];

// L2.web.spec §4.10.3, host-service spec §10 43번. cap-web의 `BrowseConfirmPort`를 `xeon.approvals`에 잇는다. 민감한 클릭, 다른 출처 폼,
// 신뢰할 수 없는 입력 뒤 동작, 이름 있는 프로필은 사람의 확인 뒤에만 한다. 확인 요청은 kind `tool`의 승인이고 차단형이다.
// 대화를 알 수 없으면(`threadId` 없음) 물을 곳이 없어 `unavailable`이고 cap-web은 동작을 거부한다(안전한 쪽). 조립 루트 코드(DR-14 예외 2).

const REASON_TEXT: Readonly<Record<BrowseConfirmReason, string>> = {
  sensitive_click: "click a sensitive control",
  cross_origin_form: "submit a form to another site",
  after_untrusted_input: "act after reading untrusted content",
  named_profile: "use a saved browser profile",
};

const TITLE_MAX = 120;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createBrowseConfirm(
  approvals: Pick<ApprovalService, "request">,
): BrowseConfirmPort {
  return {
    async confirm(request, signal) {
      if (request.threadId === undefined) {
        return err({ kind: "unavailable", message: "there is no conversation to ask in" });
      }
      const args: Record<string, JsonValue> = {
        reason: request.reason,
        url: request.url,
        session: request.sessionId,
        ...(request.role === undefined ? {} : { role: request.role }),
        ...(request.name === undefined ? {} : { name: request.name }),
      };
      const title = `Allow the browser to ${REASON_TEXT[request.reason]} on ${request.url}?`;
      const answered = await approvals.request(
        {
          origin: {
            threadId: request.threadId,
            turnId: null,
            stepId: null,
            toolCallId: null,
            caller: "main",
          },
          requestKey: requestKeyFor(`webconfirm:${request.requestKey}`, sha256),
          title: title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1)}…`,
          body: {
            kind: "tool",
            tool: {
              toolName: "web_browse_confirm",
              risk: "write",
              args,
              argsHash: sha256(JSON.stringify(args)),
              ruleId: "web.browse.confirm",
            },
          },
          remember: ["once"],
        },
        signal,
      );
      if (!answered.ok) {
        return err({ kind: "unavailable", message: "the confirmation could not be requested" });
      }
      return ok(answered.value.decision === "allow" ? "allow" : "deny");
    },
  };
}
