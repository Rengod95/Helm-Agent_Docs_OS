import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { HumanReauth } from "@fresnel/contracts/services";

// 사람 재인증(L4.desktop.spec §4.17). 창은 Rust `os_reauth`가 띄운다(macOS Touch ID나 기기 암호).
// 성공하면 reveal이 받는 `HumanReauth`(`os-auth`) 증거를 돌려준다. 값 보기 관문(`createOsReauthGate`, `src/app/secret-reveal-gate.ts`)이 이 함수를 쓴다.
// 운영은 main.tsx가 셸 다리의 `invoke`를 넘기고, 시험은 가짜를 넣는다(folder-pick.ts와 같은 방식).

/** `os_reauth`의 invoke 모양. 인자는 시스템 창에 보일 한 줄 사유다 */
export type OsReauthInvoke = (
  command: "os_reauth",
  args: { readonly reason: string },
) => Promise<unknown>;

/** Rust `ReauthError`의 kind와 같다 */
type OsReauthKind = "cancelled" | "denied" | "unavailable" | "failed";

export type OsReauthError = { readonly kind: OsReauthKind };

const KINDS: readonly OsReauthKind[] = ["cancelled", "denied", "unavailable", "failed"];

/**
 * 사람 재인증 창을 띄운다. 인증되면 `os-auth` 증거(인증 시각 포함)를, 아니면 종류가 있는 오류를 돌려준다.
 * 답이 모양과 다르거나 종류를 모르면 `failed`다. 명령이 거부한 값도 같은 규칙으로 읽는다.
 */
export async function requestOsReauth(
  invoke: OsReauthInvoke,
  reason: string,
): Promise<Result<HumanReauth, OsReauthError>> {
  const reply = await attemptAsync(() => invoke("os_reauth", { reason }));
  if (!reply.ok) return err({ kind: kindOf(reply.error.cause) });
  return grantOf(reply.value);
}

function grantOf(reply: unknown): Result<HumanReauth, OsReauthError> {
  if (typeof reply === "object" && reply !== null && "verifiedAtMs" in reply) {
    const verifiedAt = reply.verifiedAtMs;
    if (typeof verifiedAt === "number" && Number.isSafeInteger(verifiedAt) && verifiedAt >= 0) {
      return ok({ method: "os-auth", verifiedAt });
    }
  }
  return err({ kind: "failed" });
}

/** 거부된 값에서 종류를 읽는다. `{ kind }` 모양이 아니거나 모르는 종류면 `failed`다 */
function kindOf(cause: unknown): OsReauthKind {
  if (typeof cause !== "object" || cause === null || !("kind" in cause)) return "failed";
  const kind = cause.kind;
  return KINDS.find((candidate) => candidate === kind) ?? "failed";
}
