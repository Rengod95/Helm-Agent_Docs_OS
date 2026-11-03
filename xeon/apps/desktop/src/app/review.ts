import type { HostConnection } from "@fresnel/contracts/wire";
import type { Result } from "@fresnel/contracts";
import type { CommandError, ReviewCommands } from "../views/commands.ts";

// 변경 검토 화면(P-04)이 부르는 wire. hunk 본문은 `review.get`(W-02)으로 읽는다. 제출과 거부는 승인 답(`approval.respond`)이라
// `respondApproval`이 맡는다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createReviewCommands(withConnection: WithConnection): ReviewCommands {
  return {
    get: (reviewId) => withConnection((c) => c.request("review.get", { reviewId })),
  };
}
