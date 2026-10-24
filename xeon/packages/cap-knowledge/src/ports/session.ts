import type { SessionService } from "@xeon/contracts/records";

// cap-knowledge가 쓰는 xeon.session의 부분: 투영기 등록(세션 목록), 내구 피드 구독과 읽기(색인 소비자), detached 필드 복원.
// 실제 이름이 바뀌면 이 파일만 고친다(L2.knowledge.plan §2 "포트 파일은 L1 서비스의 실제 이름을 한 곳에서 감싼다").
export type KnowledgeSessionPort = Pick<SessionService, "projectors" | "subscribe" | "hydrate">;

function isFunction(value: unknown): boolean {
  return typeof value === "function";
}

/**
 * 운영 `xeon.session`은 `SessionService` 전체이고 테스트 호스트 같은 부분 구현은 일부 멤버만 가진다. 필요한 멤버가 모두 있을 때만 쓴다.
 * 없으면 세션 투영·색인 없이 시작한다(스킬·메모리 기능은 그대로 동작한다).
 */
export function isKnowledgeSessionPort(value: unknown): value is KnowledgeSessionPort {
  if (typeof value !== "object" || value === null) return false;
  const projectors: unknown = Reflect.get(value, "projectors");
  if (typeof projectors !== "object" || projectors === null) return false;
  return (
    isFunction(Reflect.get(projectors, "register")) &&
    isFunction(Reflect.get(value, "subscribe")) &&
    isFunction(Reflect.get(value, "hydrate"))
  );
}
