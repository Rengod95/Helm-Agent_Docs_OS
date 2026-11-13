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
  /** 같은 호출의 같은 질문을 다시 보내도 새 요청을 만들지 않는 멱등 키(승인 요청 키 모양) */
  readonly requestKey: string;
}

export type WriteAccessError = { readonly kind: "unavailable"; readonly message: string };

/**
 * 작업 폴더 밖 쓰기 허용 요청(L2.workspace.spec §4.3.1). 구현은 `fresnel.approvals`의 L2 공통 포트(`L2ApprovalsPort`)를 감싸는
 * 어댑터다(`write-access-adapter.ts`). 승인 기억은 도구 승인과 같이 요청 단위(이번만)다.
 */
export interface WriteAccessPort {
  ask(
    request: WriteAccessRequest,
    signal: AbortSignal,
  ): Promise<Result<"allow" | "deny", WriteAccessError>>;
}
