// 내장 그룹(`authoring`, `guide`)의 이름. 대화별 켜짐은 E(T)가 정한다(M5c §4.1). 이 목록은 시작 때 내장 그룹의 기본 켜짐을 고를 때 쓴다.

/** 설정 값(`ext.<이름>.enabled`)이 시작 때의 기본을 정하는 내장 그룹. 정적 카탈로그에 예약 키가 있는 것만이다(HS-113). */
export const BUILTIN_ORCHESTRATION_NAMES: readonly string[] = ["authoring", "guide"];
