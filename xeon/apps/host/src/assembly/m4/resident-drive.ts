import type { Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { RegistrationId } from "@fresnel/contracts/extensions";

// 테스트 대화의 상주 시작 Drive(M5c §4.8.6 [제안]). `craftChat` 표지가 있는 대화는 사용자 입력마다 주도 스택에 플러그인 프레임이 있어야 한다.
// 중지나 오류로 스택이 비었으면 입력을 받기 전에 프로필의 시작 Drive를 다시 요청한다. 일반 대화는 첫 턴 앞에서만 쌓는다(§4.2.6).
// 요청 계기는 `user`다. 계기 `profile`은 사용자 중지 뒤 다음 턴이 정착할 때까지 버려지거나 막혀(lease.ts `decide`), 입력이 주도 프레임에
// 닿지 못하기 때문이다. 사용자가 방금 보낸 입력이 곧 사용자의 명령이다.

export interface ResidentDriveDeps {
  /** 테스트 대화(`craftChat` 표지)인가. 읽지 못하면 호출자가 거짓으로 준다 */
  readonly isCraftChat: (threadId: ThreadId) => boolean;
  /** 주도 스택에 든 플러그인 이름(코어 제외). 열려 있지 않으면 빈 목록이다 */
  readonly framePlugins: (threadId: ThreadId) => readonly string[];
  /** 대화가 참조하는 프로필의 시작 Drive를 Registration id로 푼다. 없으면 undefined다 */
  readonly startDriveOf: (threadId: ThreadId) => Promise<RegistrationId | undefined>;
  /** 주도 시작 요청. 계기는 항상 `user`다 */
  readonly startDrive: (
    threadId: ThreadId,
    scopeId: RegistrationId,
    requested: { readonly trigger: "user" },
  ) => Result<void, { readonly kind: string }>;
  /** 진단 기록. 요청이 거절되었을 때만 쓴다(입력은 막지 않는다) */
  readonly report: (message: string, fields: Readonly<Record<string, string>>) => void;
}

/**
 * 입력 앞에서 상주 시작 Drive를 맞춘다. 요청했으면 참이다. 일반 대화, 플러그인 프레임이 이미 있는 대화, 시작 Drive가 없는 대화,
 * 요청이 거절된 대화는 입력을 그대로 받는다(거절은 기록만 남긴다).
 */
export async function ensureResidentDrive(
  deps: ResidentDriveDeps,
  threadId: ThreadId,
): Promise<boolean> {
  if (!deps.isCraftChat(threadId)) return false;
  if (deps.framePlugins(threadId).length > 0) return false;
  const scopeId = await deps.startDriveOf(threadId);
  if (scopeId === undefined) return false;
  const started = deps.startDrive(threadId, scopeId, { trigger: "user" });
  if (!started.ok) {
    deps.report("craft.drive_start_failed", { threadId, kind: started.error.kind });
    return false;
  }
  return true;
}
