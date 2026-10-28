import type { DelegateToolPolicy } from "@xeon/group-kit";

// L3.learning.spec §3.4 도구 정책. 광고 도구 배열은 부모와 같게 두고 실행 시점에 거른다(keepParentList, 캐시 접두 공유).

export const LEARNING_PROPOSE_TOOL = "learning_propose";

/** 기본 허용 목록 [제안]. 읽기와 제안 도구뿐이다. 쓰기, 편집, 셸, 웹, 위임, 사용자 질문, 지식 쓰기 도구는 모두 거부한다 */
export const REVIEW_ALLOWED_TOOLS: readonly string[] = [
  LEARNING_PROPOSE_TOOL,
  "skill_view",
  "knowledge_search",
  "session_scroll",
  "session_read",
  "read",
  "grep",
  "find",
  "ls",
];

export function reviewToolPolicy(): DelegateToolPolicy {
  return {
    allow: [...REVIEW_ALLOWED_TOOLS],
    keepParentList: true,
    denyHint: `Submit candidates with ${LEARNING_PROPOSE_TOOL}. This review cannot write, edit, run commands or delegate.`,
  };
}
