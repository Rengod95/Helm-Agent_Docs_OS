// 옛 계획 승인 요청의 planRef를 읽는 이름. 투영기가 승인 요청을 계획 판에 잇는 데 쓴다. 쓰지 않는다 [결정: 2026-11-13 사용자]

/** 옛 승인 요청 대상의 planRef 형식 `plan:<planId>:<version>` */
export const PLAN_REF_PATTERN: RegExp = /^plan:(p[1-9][0-9]{0,5}):([1-9][0-9]{0,2})$/;
