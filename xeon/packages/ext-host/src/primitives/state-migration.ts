import type { JsonValue } from "@fresnel/contracts/conversation";

/**
 * 저장된 상태 문서를 현재 `StateDecl.version`의 모양으로 옮긴다. 동기 함수이거나 옮긴 문서로 이행하는 약속이다.
 * 격리 호스트의 플러그인은 함수를 경계 너머로 보낼 수 없어 엔진이 `state.migrate` 요청으로 부른다(X.primitives.spec §4.6.1)
 */
export type StateMigration = (
  doc: JsonValue,
  fromVersion: number,
) => JsonValue | Promise<JsonValue>;
