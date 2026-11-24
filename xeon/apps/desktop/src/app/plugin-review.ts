import type { HostConnection } from "@fresnel/contracts/wire";
import type { Result } from "@fresnel/contracts";
import type { CommandError, PluginReviewCommands } from "../views/commands.ts";

// Craft 리뷰 화면(C5)이 부르는 wire(M5c §3.4): `pluginReview.list`, `file`, `decide`와 승인 대상 프로필을 고르는 `profile.list`.
// 버전 탭(AGE-76)은 `history`, `get`으로 이력과 지점의 변경 내용을 읽고 `requestRollback`으로 되돌리기 리뷰를 연다.
// 결정과 되돌리기 요청은 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다(`withWrite`). 알림 `pluginReview.changed`(항목 상태)와 `plugin.changed`(검토본)가 오면 화면이 목록을 다시 읽는다.

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
    file: (itemId, path, side) =>
      withConnection((c) =>
        c.request(
          "pluginReview.file",
          side === undefined ? { itemId, path } : { itemId, path, side },
        ),
      ),
    decide: (itemId, decision) =>
      withWrite((c) => c.request("pluginReview.decide", { itemId, decision })),
    profiles: () => withConnection((c) => c.request("profile.list", {})),
    history: (name) => withConnection((c) => c.request("pluginReview.history", { name })),
    get: (itemId) => withConnection((c) => c.request("pluginReview.get", { itemId })),
    requestRollback: (name, contentHash) =>
      withWrite((c) => c.request("pluginReview.requestRollback", { name, contentHash })),
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
