import { err, ok, type Result } from "@fresnel/contracts";
import type {
  ExtGetResult,
  ExtListEntry,
  ExtVersionsResult,
  HostConnection,
} from "@fresnel/contracts/wire";
import type { ToggleRequest } from "@fresnel/client/workbench";
import type { CommandError } from "../views/commands.ts";

// 크래프트 명령. 결과는 요청의 반환값이다(거울에 넣지 않는다). 상태 반영은 `views/workbench`의 컨트롤러가 스토어에 한다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

export interface WorkbenchCommands {
  /** `ext.list`. 전역 값이라 `threadId`를 보내지 않는다 */
  list(): Promise<Result<readonly ExtListEntry[], CommandError>>;
  /** `ext.get`: 매니페스트 훅·기능 바인딩·진단 */
  get(name: string): Promise<Result<ExtGetResult, CommandError>>;
  /** 켜기·끄기: `settings.set { key: "ext.<이름>.enabled", scope: "user" }` */
  toggle(request: ToggleRequest): Promise<Result<null, CommandError>>;
  /** 자동 꺼짐 다시 켜기. 적용은 다음 단계 경계다 */
  reenable(name: string): Promise<Result<null, CommandError>>;
  versions(name: string): Promise<Result<ExtVersionsResult, CommandError>>;
  /** 되돌리기. `restart`면 다음 시작에 적용된다(HS-108) */
  rollback(
    name: string,
    version: string,
    clearState: boolean,
  ): Promise<Result<"nextStepBoundary" | "restart", CommandError>>;
}

export function createWorkbenchCommands(withConnection: WithConnection): WorkbenchCommands {
  return {
    async list() {
      const listed = await withConnection((c) => c.request("ext.list", {}));
      return listed.ok ? ok(listed.value.extensions) : err(listed.error);
    },
    get: (name) => withConnection((c) => c.request("ext.get", { name })),
    async toggle(request) {
      const done = await withConnection((c) =>
        c.request("settings.set", {
          key: request.key,
          value: request.value,
          scope: request.scope,
        }),
      );
      return done.ok ? ok(null) : err(done.error);
    },
    async reenable(name) {
      const done = await withConnection((c) => c.request("ext.reenable", { name }));
      return done.ok ? ok(null) : err(done.error);
    },
    versions: (name) => withConnection((c) => c.request("ext.versions", { name })),
    async rollback(name, version, clearState) {
      const done = await withConnection((c) =>
        c.request("ext.rollback", { name, version, ...(clearState ? { clearState } : {}) }),
      );
      return done.ok ? ok(done.value.appliesAt) : err(done.error);
    },
  };
}
