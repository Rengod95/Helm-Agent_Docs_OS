import { err, ok, type Result } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { TraceTurnResult } from "@fresnel/contracts/extensions";
import type {
  ExtGetResult,
  ExtHealthEntry,
  ExtListEntry,
  ExtVersionsResult,
  HookEntry,
  HooksOrderGetResult,
  HooksOrderPreviewResult,
  HooksOrderResetResult,
  HooksOrderSetResult,
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
  /** `ext.health`(모든 확장). 실패 장부 배열 */
  health(): Promise<Result<readonly ExtHealthEntry[], CommandError>>;
  /** `hooks.list`: 훅마다 핸들러의 기본 순서(`order` 행)를 포함한다 */
  hooks(): Promise<Result<readonly HookEntry[], CommandError>>;
  /** `hooks.order.get`: 저장 값과 적용 중 순서 */
  orderGet(): Promise<Result<HooksOrderGetResult, CommandError>>;
  /** `hooks.order.set`: 저장만 한다. 적용은 다음 단계 경계다 */
  orderSet(
    hook: string,
    order: readonly string[],
  ): Promise<Result<HooksOrderSetResult, CommandError>>;
  /** `hooks.order.reset`: `hook`을 생략하면 모든 훅의 덮어쓰기를 지운다 */
  orderReset(hook?: string): Promise<Result<HooksOrderResetResult, CommandError>>;
  /** `hooks.order.preview`: 저장하지 않고 이 순서를 적용했을 때의 결과를 본다 */
  orderPreview(
    hook: string,
    order: readonly string[],
  ): Promise<Result<HooksOrderPreviewResult, CommandError>>;
  /** `trace.turn`: 한 턴의 훅별 핸들러 계측 */
  trace(threadId: ThreadId, turnId: TurnId): Promise<Result<TraceTurnResult, CommandError>>;
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
    async health() {
      const got = await withConnection((c) => c.request("ext.health", {}));
      return got.ok ? ok(got.value.health) : err(got.error);
    },
    async hooks() {
      const got = await withConnection((c) => c.request("hooks.list", {}));
      return got.ok ? ok(got.value.hooks) : err(got.error);
    },
    orderGet: () => withConnection((c) => c.request("hooks.order.get", {})),
    orderSet: (hook, order) => withConnection((c) => c.request("hooks.order.set", { hook, order })),
    orderReset: (hook) =>
      withConnection((c) => c.request("hooks.order.reset", hook === undefined ? {} : { hook })),
    orderPreview: (hook, order) =>
      withConnection((c) => c.request("hooks.order.preview", { hook, order })),
    trace: (threadId, turnId) =>
      withConnection((c) => c.request("trace.turn", { threadId, turnId })),
  };
}
