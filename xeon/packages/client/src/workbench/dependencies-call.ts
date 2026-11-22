import { attemptAsync, type Result } from "@fresnel/contracts";
import type { WireParams, WireRequestOptions, WireResult } from "@fresnel/contracts/wire";
import { membersFailureOf, type MembersConnection, type MembersFailure } from "./members-call.ts";

// 의존 편집의 호출 틀(AGE-33). 구성원 호출 틀(members-call.ts)과 같은 모양이다. 연결은 `request`만 쓰고,
// 실패는 wire 오류(`host`)와 응답을 받지 못한 전송 실패(`transport`)로 나눈다. 실패 갈래는 구성원 호출과 같다.

/** 의존 wire 메서드 이름 */
export type DependenciesMethod = "ext.dependencies.edit" | "ext.dependencies.read";

/** 의존 호출이 실패한 이유. 구성원 호출과 갈래가 같다(`host`는 wire 오류, `transport`는 응답 없음) */
export type DependenciesFailure = MembersFailure;

async function callDependencies<M extends DependenciesMethod>(
  connection: MembersConnection,
  method: M,
  params: WireParams<M>,
  options?: WireRequestOptions,
): Promise<Result<WireResult<M>, DependenciesFailure>> {
  const outcome = await attemptAsync(() => connection.request(method, params, options));
  if (outcome.ok) return outcome;
  return { ok: false, error: membersFailureOf(outcome.error.cause) };
}

/**
 * 원본 폴더의 의존 줄을 고친다(`ext.dependencies.edit`). 설치하지 않고 승인하지 않는다. 결과의 `changedFiles`를 받은 화면이
 * 이어서 `plugin.draft.create(dir)`를 불러 새 초안으로 다시 검토를 지난다
 */
export function editDependencies(
  connection: MembersConnection,
  params: WireParams<"ext.dependencies.edit">,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.dependencies.edit">, DependenciesFailure>> {
  return callDependencies(connection, "ext.dependencies.edit", params, options);
}

/** 의존 줄을 읽는다(`ext.dependencies.read`). 쓰지 않는다 */
export function readDependencies(
  connection: MembersConnection,
  dir: string,
  options?: WireRequestOptions,
): Promise<Result<WireResult<"ext.dependencies.read">, DependenciesFailure>> {
  return callDependencies(connection, "ext.dependencies.read", { dir }, options);
}
