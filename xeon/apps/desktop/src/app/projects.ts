import type { HostConnection } from "@fresnel/contracts/wire";
import type { Result } from "@fresnel/contracts";
import type { CommandError, ProjectCommands } from "../views/commands.ts";

// 프로젝트 패널(C10)이 부르는 wire(M5c §3.4): `project.list/get/create/rename/delete/instructions`.
// 만들기, 이름 바꾸기, 빼기는 쓰기라 엔진 대상을 바꾸는 중이면 `switching`으로 거절한다(`withWrite`).
// 알림 `project.changed`(목록)와 `pluginReview.changed`(리뷰 대기 수)가 오면 화면이 다시 읽는다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export function createProjectCommands(
  withConnection: WithConnection,
  withWrite: WithConnection,
  connection: () => Pick<HostConnection, "onNotification"> | null,
): ProjectCommands {
  return {
    list: () => withConnection((c) => c.request("project.list", {})),
    get: (projectId) => withConnection((c) => c.request("project.get", { projectId })),
    create: (root) => withWrite((c) => c.request("project.create", { root })),
    rename: (projectId, name) => withWrite((c) => c.request("project.rename", { projectId, name })),
    remove: (projectId) => withWrite((c) => c.request("project.delete", { projectId })),
    instructions: (workspace) =>
      withConnection((c) => c.request("project.instructions", { workspace })),
    onChanged(listener) {
      const c = connection();
      if (c === null) return () => {};
      const offProject = c.onNotification("project.changed", () => {
        listener();
      });
      const offReview = c.onNotification("pluginReview.changed", () => {
        listener();
      });
      return () => {
        offProject();
        offReview();
      };
    },
  };
}
