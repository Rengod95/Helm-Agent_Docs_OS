import { err, ok, type Result } from "@fresnel/contracts";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { CommandError, WorkbenchCommands } from "../views/commands.ts";

// 크래프트 명령. 결과는 요청의 반환값이다(거울에 넣지 않는다). 상태 반영은 `views/workbench`의 컨트롤러가 스토어에 한다.

type WithConnection = <T>(
  run: (connection: HostConnection) => Promise<T>,
) => Promise<Result<T, CommandError>>;

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
