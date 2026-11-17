import type { Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";

/** 쓰기 허용을 묻는 도구. 파일 도구는 작업 폴더 밖 경로를, bash는 샌드박스가 막은 경로를 묻는다 */
export type WriteAccessVia = "bash" | "write" | "edit";

export interface WriteAccessRequest {
  readonly threadId: ThreadId;
  readonly via: WriteAccessVia;
  /** 막힌 경로(정규 절대 경로). 사용자에게 보이는 대상이다 */
  readonly paths: readonly string[];
  /** 허용하면 쓰기 루트에 더할 경로. 파일 도구는 `paths`와 같다 */
  readonly roots: readonly string[];
  /** 후보에 홈 폴더 전체가 들어 있다 */
  readonly homeWide: boolean;
  /** bash면 명령 원문 */
  readonly command?: string;
  /** 같은 호출의 같은 질문을 다시 보내도 새 요청을 만들지 않는 멱등 키(승인 요청 키 모양) */
  readonly requestKey: string;
}

export type WriteAccessError = { readonly kind: "unavailable"; readonly message: string };

/**
 * 작업 폴더 밖 쓰기 허용 요청(L2.workspace.spec §4.3.1). 구현은 `fresnel.approvals`의 L2 공통 포트(`L2ApprovalsPort`)를 감싸는
 * 어댑터다(`write-access-adapter.ts`). 선택지는 앞으로 전부 허용, 이번만 허용, 거절이다([결정: 2026-11-13 사용자]).
 */
export interface WriteAccessPort {
  /** `allow_all`은 "앞으로 전부 허용"(이 대화에서 이후 샌드박스 밖 쓰기 전체), `allow`는 이번만 */
  ask(
    request: WriteAccessRequest,
    signal: AbortSignal,
  ): Promise<Result<"allow" | "allow_all" | "deny", WriteAccessError>>;
  /** 이 대화(또는 부모 대화)에서 "앞으로 전부 허용"을 골랐는가. 기록에서 읽으므로 재시작 뒤에도 같다 */
  granted?(threadId: ThreadId): Promise<boolean>;
}
