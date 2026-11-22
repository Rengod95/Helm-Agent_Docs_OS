import { attemptAsync, type Result } from "@fresnel/contracts";
import {
  WireError,
  type HostConnection,
  type WireParams,
  type WireRequestOptions,
  type WireResult,
} from "@fresnel/contracts/wire";

// 구성원 편집의 호출 틀(L3.authoring.spec §3.3, F.wire-settings §3.3.4c). 연결은 `request`만 쓴다.
// 오류는 wire 오류(`host`, 판별은 `error.code`)와 응답을 받지 못한 전송 실패(`transport`)로 나눈다.

/** 구성원 wire 메서드 이름 */
export type MembersMethod = "ext.members.edit" | "ext.members.read";

/**
 * 구성원 호출이 실패한 이유. `host`는 호스트가 준 wire 오류 그대로이고(입력 문제는 `jsonrpc.invalidParams`의 `issues`,
 * 설치본·저장소 폴더는 `denied`다), `transport`는 응답을 받지 못했다(연결이 닫혔거나 시한이 지났거나 중단됐다)
 */
export type MembersFailure =
  | { readonly kind: "host"; readonly error: WireError }
  | { readonly kind: "transport"; readonly cause: unknown };

/** 구성원 호출에 쓰는 연결. `HostConnection`이 이 모양을 만족하고, 시험은 가짜 연결을 쓴다 */
export type MembersConnection = Pick<HostConnection, "request">;

/** 던져진 값을 실패 갈래로 바꾼다. `WireError`가 아니면 전송 실패다 */
export function membersFailureOf(cause: unknown): MembersFailure {
  return cause instanceof WireError ? { kind: "host", error: cause } : { kind: "transport", cause };
}

async function callMembers<M extends MembersMethod>(
  connection: MembersConnection,
  method: M,
  params: WireParams<M>,
  options?: WireRequestOptions,
): Promise<Result<WireResult<M>, MembersFailure>> {
  const outcome = await attemptAsync(() => connection.request(method, params, options));
  if (outcome.ok) return outcome;
  return { ok: false, error: membersFailureOf(outcome.error.cause) };
}

/**
 * 원본 폴더의 구성원을 고친다(`ext.members.edit`). 설치하지 않고 승인하지 않는다. 결과의 `changedFiles`를 받은 화면이
 * 이어서 `plugin.draft.create(dir)`를 불러 새 초안으로 다시 검토를 지난다
 */
export function editMembers(
  connection: MembersConnection,
  params: WireParams<"ext.members.edit">,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.members.edit">, MembersFailure>> {
  return callMembers(connection, "ext.members.edit", params, options);
}

/** 구성원을 읽는다(`ext.members.read`). 쓰지 않는다 */
export function readMembers(
  connection: MembersConnection,
  dir: string,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.members.read">, MembersFailure>> {
  return callMembers(connection, "ext.members.read", { dir }, options);
}
