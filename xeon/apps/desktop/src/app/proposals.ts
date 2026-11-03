import { decisionOutcomeOf, proposalListView } from "@fresnel/client/settings";
import { ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, ProposalCommands } from "../views/commands.ts";

// 제안 화면(P-06)이 부르는 wire. 목록은 `proposalListView`로, 결정은 `decisionOutcomeOf`로 화면 값이 된다.
// 결정은 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다(`withWrite`). 기대한 실패는 값이고 연결과 host 실패만 `CommandError`다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createProposalCommands(
  withConnection: WithConnection,
  withWrite: WithConnection,
): ProposalCommands {
  return {
    async list(params) {
      const listed = await withConnection((c) => c.request("proposal.list", params));
      return listed.ok ? ok(proposalListView(listed.value)) : listed;
    },
    async decide(params) {
      const decided = await withWrite((c) => c.request("proposal.decide", params));
      return decided.ok ? ok(decisionOutcomeOf(decided.value)) : decided;
    },
  };
}
