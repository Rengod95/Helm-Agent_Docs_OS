import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import type { SecretCommandError, SecretCommands } from "../views/commands.ts";
import type { DesktopIpc } from "../transport/ipc.ts";
import { errorOf } from "./command-error.ts";
import { keyRegisterErrorOf } from "./setup.ts";
import type { Session } from "./session.ts";

// 시크릿 화면(P-10)이 부르는 wire. 화면이 `secret.reauthRequired`, `secret.notFound`, `secret.inUse`를 구분하므로
// 공통 명령 오류(`errorOf`)보다 자세히 나눈다. 값은 wire를 지나지 않는다: 값 입력은 셸 명령(`registerSecret`)이 받는다.

/** wire 오류를 화면이 구분하는 오류로 바꾼다. 구분하지 않는 나머지는 `failed`다 */
function secretErrorOf(cause: unknown): SecretCommandError {
  if (cause instanceof WireError) {
    if (cause.data.kind === "secret.reauthRequired") return { kind: "reauthRequired" };
    if (cause.data.kind === "secret.notFound") return { kind: "notFound" };
    if (cause.data.kind === "secret.inUse") return { kind: "inUse" };
  }
  const generic = errorOf(cause);
  return generic.kind === "unsupported" ? { kind: "unsupported" } : { kind: "failed" };
}

export interface SecretDeps {
  readonly session: Pick<Session, "connection">;
  readonly ipc: Pick<DesktopIpc, "registerSecret">;
  readonly clipboard: { writeText(text: string): Promise<void> };
}

export function createSecretCommands(deps: SecretDeps): SecretCommands {
  // 연결이 없으면 `offline`이고, 요청이 실패하면 wire 오류를 화면의 종류로 바꾼다
  const run = async <T>(
    work: (connection: HostConnection) => Promise<T>,
  ): Promise<Result<T, SecretCommandError>> => {
    const connection = deps.session.connection();
    if (connection === null) return err({ kind: "offline" });
    const result = await attemptAsync(() => work(connection));
    return result.ok ? ok(result.value) : err(secretErrorOf(result.error.cause));
  };

  return {
    async list() {
      const listed = await run((c) => c.request("secret.list", { meta: true, usage: true }));
      return listed.ok ? ok(listed.value.secrets) : listed;
    },
    references: (name) => run((c) => c.request("secret.references", { name })),
    test: (name) => run((c) => c.request("secret.test", { name })),
    audit: (name) => run((c) => c.request("secret.audit", { name })),
    async editMeta(params) {
      const edited = await run((c) => c.request("secret.meta", params));
      return edited.ok ? ok(edited.value.secret) : edited;
    },
    async remove(name) {
      const removed = await run((c) => c.request("secret.remove", { name }));
      return removed.ok ? ok(removed.value.removed) : removed;
    },
    async beginEntry(name, action) {
      const begun = await run((c) => c.request("secret.beginEntry", { name, action }));
      return begun.ok ? ok(begun.value.started) : begun;
    },
    async registerKey(name, action, value) {
      const registered = await deps.ipc.registerSecret(name, action, value);
      return registered.ok ? ok(null) : err(keyRegisterErrorOf(registered.error));
    },
    async beginReveal(name) {
      const begun = await run((c) => c.request("secret.beginReveal", { name }));
      return begun.ok ? ok(begun.value.started) : begun;
    },
    writeClipboard: (text) => deps.clipboard.writeText(text),
  };
}
