import type { CallContext, KnowledgeActor } from "@xeon/contracts/capabilities";
import { assertNever, err, ok, type Result } from "@xeon/contracts";
import { failure, type KnowledgeFailure } from "./errors.ts";

// L2.knowledge.spec §3.1 행위자는 입력 필드가 아니다. 서비스가 `CallOptions.context.caller`에서 만든다.
// 호출 문맥이 없으면 거부한다: 문맥은 L1.tools 어댑터와 X의 capability 래퍼가 채우므로, 없는 호출은 그 경로를 지나지 않았다.

export function actorOf(
  context: CallContext | undefined,
): Result<KnowledgeActor, KnowledgeFailure> {
  if (context === undefined) {
    return err(
      failure("denied", "the call carries no caller context, so the actor cannot be determined"),
    );
  }
  const { caller } = context;
  switch (caller.kind) {
    case "host":
      return ok({ kind: "user" });
    case "model":
      return ok({
        kind: "agent",
        sessionId: context.threadId ?? "unknown",
        ...(context.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
        agent: caller.agent ?? "main",
      });
    case "extension":
      return ok({ kind: "extension", extension: caller.extension ?? "unknown" });
    default:
      return assertNever(caller.kind, "CallerKind");
  }
}
