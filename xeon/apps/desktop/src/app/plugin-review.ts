import type { HostConnection } from "@fresnel/contracts/wire";
import type { Result } from "@fresnel/contracts";
import type { CommandError, PluginReviewCommands } from "../views/commands.ts";

// Craft 리뷰 화면(C5)이 부르는 wire(M5c §3.4): `pluginReview.list`, `file`, `decide`와 승인 대상 프로필을 고르는 `profile.list`.
// 결정은 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다(`withWrite`). 알림 `pluginReview.changed`(항목 상태)와 `plugin.changed`(검토본)가 오면 화면이 목록을 다시 읽는다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createPluginReviewCommands(
  withConnection: WithConnection,
  withWrite: WithConnection,
  connection: () => Pick<HostConnection, "onNotification"> | null,
): PluginReviewCommands {
  return {
    list: () => withConnection((c) => c.request("pluginReview.list", {})),
    file: (itemId, path) => withConnection((c) => c.request("pluginReview.file", { itemId, path })),
    decide: (itemId, decision) =>
      withWrite((c) => c.request("pluginReview.decide", { itemId, decision })),
    profiles: () => withConnection((c) => c.request("profile.list", {})),
    onChanged(listener) {
      const c = connection();
      if (c === null) return () => {};
      const offItem = c.onNotification("pluginReview.changed", () => {
        listener();
      });
      const offPlugin = c.onNotification("plugin.changed", () => {
        listener();
      });
      return () => {
        offItem();
        offPlugin();
      };
    },
  };
}
