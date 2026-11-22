import { attemptAsync, type Result } from "@fresnel/contracts";
import type { WireParams, WireRequestOptions, WireResult } from "@fresnel/contracts/wire";
import { membersFailureOf, type MembersConnection, type MembersFailure } from "./members-call.ts";

// 구성원 떼기의 호출 틀(AGE-33). 구성원 호출 틀(members-call.ts)과 같은 모양이다. 연결은 `request`만 쓰고,
// 실패는 wire 오류(`host`)와 응답을 받지 못한 전송 실패(`transport`)로 나눈다.

/**
 * 구성원을 새 폴더로 떼어 낸다(`ext.members.detach`). 원본 폴더는 읽기만 하고 설치하지도 승인하지도 않는다.
 * 결과의 `outDir`을 받은 화면이 `plugin.draft.create(outDir)`를 부르면 새 초안이 검토를 지난다.
 * `profileMove`는 승인 때 프로필 참조를 옮길지 묻는 값이다
 */
export function detachMember(
  connection: MembersConnection,
  params: WireParams<"ext.members.detach">,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.members.detach">, MembersFailure>> {
  return callDetach(connection, params, options);
}

async function callDetach(
  connection: MembersConnection,
  params: WireParams<"ext.members.detach">,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.members.detach">, MembersFailure>> {
  const outcome = await attemptAsync(() =>
    connection.request("ext.members.detach", params, options),
  );
  if (outcome.ok) return outcome;
  return { ok: false, error: membersFailureOf(outcome.error.cause) };
}
