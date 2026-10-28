// 계획 판을 가리키는 이름들. 투영기와 서비스가 같은 문자열을 쓴다.

/** 권한 모드 세션 설정 키(L1.tools.spec §6) */
export const PERMISSION_MODE_KEY = "l1.tools.permissionMode";

/** 승인 요청 대상의 planRef 형식 `plan:<planId>:<version>`. 승인 요청 멱등 키, 산출물 등록 키와 같은 문자열이다 */
export const PLAN_REF_PATTERN: RegExp = /^plan:(p[1-9][0-9]{0,5}):([1-9][0-9]{0,2})$/;

export function planRefOf(planId: string, version: number): string {
  return `plan:${planId}:${version}`;
}
