import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { WireError, type HostConnection } from "@fresnel/contracts/wire";
import type { SecretCommandError, SecretCommands } from "../views/commands.ts";
import type { DesktopIpc } from "../transport/ipc.ts";
import { errorOf } from "./command-error.ts";
import { keyRegisterErrorOf } from "./setup.ts";
import type { Session } from "./session.ts";

// 시크릿 화면(P-10)이 부르는 wire. 화면이 `secret.reauthRequired`, `secret.notFound`, `secret.inUse`를 구분하므로
// 공통 명령 오류(`errorOf`)보다 자세히 나눈다. 값은 wire를 지나지 않는다: 값 입력은 셸 명령(`registerSecret`)이 받고,
// 값 보기는 셸의 로컬 일회용 채널(`secret_reveal_*`)로 받는다. wire에는 채널 경로와 재인증 증거만 실린다.

/** wire 오류를 화면이 구분하는 오류로 바꾼다. 구분하지 않는 나머지는 `failed`다 */
function secretErrorOf(cause: unknown): SecretCommandError {
  if (cause instanceof WireError) {
    if (cause.data.kind === "secret.reauthRequired") return { kind: "reauthRequired" };
    if (cause.data.kind === "secret.notFound") return { kind: "notFound" };
    if (cause.data.kind === "secret.inUse") return { kind: "inUse" };
    if (cause.data.kind === "secret.localOnly") return { kind: "localOnly" };
    if (cause.data.kind === "secret.keyUnavailable") return { kind: "keyUnavailable" };
    if (cause.data.kind === "secret.alreadyExists") return { kind: "alreadyExists" };
    if (cause.data.kind === "secret.decryptFailed") return { kind: "decryptFailed" };
    if (cause.data.kind === "secret.providerUnavailable") return { kind: "providerUnavailable" };
    if (cause.data.kind === "secret.writeFailed") return { kind: "writeFailed" };
    if (cause.data.kind === "secret.readOnlyProvider") return { kind: "readOnlyProvider" };
  }
  const generic = errorOf(cause);
  return generic.kind === "unsupported" ? { kind: "unsupported" } : { kind: "failed" };
}

export interface SecretDeps {
  readonly session: Pick<Session, "connection">;
  readonly ipc: Pick<DesktopIpc, "registerSecret" | "revealOpen" | "revealTake" | "revealClose">;
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
    async reveal(name, reauth) {
      const opened = await deps.ipc.revealOpen();
      if (!opened.ok) return err({ kind: "failed" });
      const { id, path: channel } = opened.value;
      // 받기를 먼저 건다. 호스트는 `secret.beginReveal` 처리 중에 소켓에 쓰므로 그 전에 기다리고 있어야 한다
      const taken = deps.ipc.revealTake(id);
      const begun = await run((c) => c.request("secret.beginReveal", { name, channel, reauth }));
      if (!begun.ok || !begun.value.started) {
        // 열람이 없었다(거절이나 호스트의 불시작). 채널을 닫아 기다리던 받기를 끝내고, 받은 것이 있어도 버린다
        await deps.ipc.revealClose(id);
        const stray = await taken;
        if (stray.ok && stray.value !== null) stray.value.fill(0);
        return begun.ok ? ok(null) : err(begun.error);
      }
      const received = await taken;
      if (!received.ok || received.value === null) return err({ kind: "failed" });
      return ok(received.value);
    },
    keyStatus: () => run((c) => c.request("secret.keyStatus", {})),
    keyMove: (to) => run((c) => c.request("secret.keyMove", { to })),
    writeClipboard: (text) => deps.clipboard.writeText(text),
  };
}
