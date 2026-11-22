import { attemptAsync, type Result } from "@fresnel/contracts";
import type { WireParams, WireRequestOptions, WireResult } from "@fresnel/contracts/wire";
import { membersFailureOf, type MembersConnection, type MembersFailure } from "./members-call.ts";

// 구성원 합치기의 호출 틀(AGE-33). 구성원 호출 틀(members-call.ts)과 같은 모양이다. 연결은 `request`만 쓰고,
// 실패는 wire 오류(`host`)와 응답을 받지 못한 전송 실패(`transport`)로 나눈다.

/**
 * 독립 플러그인 폴더들을 한 플러그인의 구성원으로 합친다(`ext.members.merge`). 원본 폴더들은 읽기만 하고 설치하지도
 * 승인하지도 않는다. 결과의 `outDir`을 받은 화면이 `plugin.draft.create(outDir)`를 부르면 새 초안이 검토를 지난다.
 * `profileMove`는 승인 때 프로필 참조를 옮길지 묻는 값이다
 */
export function mergeMembers(
  connection: MembersConnection,
  params: WireParams<"ext.members.merge">,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.members.merge">, MembersFailure>> {
  return callMerge(connection, params, options);
}

async function callMerge(
  connection: MembersConnection,
  params: WireParams<"ext.members.merge">,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.members.merge">, MembersFailure>> {
  const outcome = await attemptAsync(() =>
    connection.request("ext.members.merge", params, options),
  );
  if (outcome.ok) return outcome;
  return { ok: false, error: membersFailureOf(outcome.error.cause) };
}
