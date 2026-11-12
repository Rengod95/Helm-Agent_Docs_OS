import type { WireHandlers } from "@fresnel/contracts/wire";
import type { Engine } from "../types.ts";

// F wire-settings `provider.checkAuth`(M4, L1.models.spec §3.13). 사람이 연결 시험을 누른 설정 동작이다.
// 읽기 전용이고 쓰기 소유를 얻지 않는다. 키 값은 엔진 밖으로 나가지 않는다(L1 `checkProviderAuth`가 가린다).
// 취소는 처리기가 던지는 값(`AbortError`)을 연결 계층이 `request.cancelled`(5001)로 옮긴다.

export function createProviderHandlers(engine: Engine): Pick<WireHandlers, "provider.checkAuth"> {
  const { models } = engine.ports;
  return {
    "provider.checkAuth": (params, context) => models.checkAuth(params.provider, context.signal),
  };
}
