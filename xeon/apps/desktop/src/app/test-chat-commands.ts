import { err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection, ThreadSummary } from "@fresnel/contracts/wire";
import type { CommandError, TestChatCommands } from "../views/commands.ts";

// 테스트 챗 창(C7)의 쓰기(M5c §3.6, §4.8.10). 열기와 드래프트 보내기는 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다.
// 고른 대화 비우기(`leave`)는 화면 상태라 연결과 무관하게 바로 된다(앱 명령이 만든다).
// 엔진의 기본 목록(`thread.list`)은 테스트 챗을 빼므로, 연 뒤에 그 플러그인의 테스트 챗 요약을 읽어 거울에 더한다(`known`).
// 그래야 다시 연 테스트 챗(앱을 다시 띄운 뒤)도 창이 제목, 실행 상태, 표지를 읽는다. 요약을 읽지 못해도 열기는 성공이다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export interface TestChatDeps {
  readonly withRead: WithConnection;
  readonly withWrite: WithConnection;
  /** 테스트 챗 요약을 거울에 더한다 */
  readonly known: (threads: readonly ThreadSummary[]) => void;
  readonly leave: () => void;
}

export function createTestChatCommands(deps: TestChatDeps): TestChatCommands {
  return {
    open: async (params) => {
      const opened = await deps.withWrite((c) => c.request("craftChat.open", params));
      if (!opened.ok) return opened;
      const listed = await deps.withRead((c) =>
        c.request("craftChat.list", { plugin: opened.value.plugin }),
      );
      if (listed.ok) deps.known(listed.value.threads);
      return opened;
    },
    submitDraft: async (draftId) => {
      const sent = await deps.withWrite((c) => c.request("pluginReview.submitDraft", { draftId }));
      if (!sent.ok) return err(sent.error);
      return ok({ itemId: sent.value.itemId });
    },
    leave: deps.leave,
  };
}
