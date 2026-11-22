// 엔진이 코어가 아직 필요로 하는 플러그인을 프로필에서 빼는 것을 거절한 오류(3626)를 가려낸다.
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import type { CommandError } from "../commands.ts";

/**
 * 엔진은 코어가 아직 필요로 하는 플러그인을 뺄 수 없게 막는다(M5c §4.1.17). 엔진은 이 사정을 플러그인 카드에 미리 알려 주지 않으므로,
 * 화면은 이 오류를 받은 뒤에야 안다
 */
export function isRequiredByCore(error: CommandError): boolean {
  return error.kind === "rejected" && error.code === WIRE_ERRORS["plugin.requiredByCore"].code;
}
