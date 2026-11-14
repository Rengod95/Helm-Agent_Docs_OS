// 코어가 싣는 기본 서브에이전트 정의(L1.agents.spec §4.9 [제안]). 출처 builtin이라 사용자·확장·프로젝트 정의가 같은 이름이면 그쪽이 이긴다.
import type { AgentDefinition } from "@fresnel/contracts/services";

const GENERAL_AGENT_NAME = "general";
const EXPLORE_AGENT_NAME = "explore";

/** 읽기 전용 정의가 쓰는 도구. bash는 `permissions.sandbox: read-only`라 읽기 전용 샌드박스에서만 돈다. 쓰기 도구는 목록에 없다 */
const EXPLORE_TOOLS: readonly string[] = ["read", "grep", "bash"];

/** 코어 기본 정의 둘. 모델 역할은 subagent(생략 기본값) */
export function coreAgentDefinitions(): readonly AgentDefinition[] {
  return [
    {
      name: GENERAL_AGENT_NAME,
      description: "General-purpose worker. Can use every tool the parent may use.",
      prompt: [
        "You are a subagent working on one self-contained task for the parent agent.",
        "Do the task with the tools you have, then finish with a short, factual report of what you found or did.",
      ].join("\n"),
      source: { kind: "builtin" },
    },
    {
      name: EXPLORE_AGENT_NAME,
      description:
        "Read-only explorer. Reads and searches files; its shell is a read-only sandbox.",
      prompt: [
        "You are a read-only exploration subagent. Use read, grep and the read-only shell.",
        "Investigate the task, then finish with a short report: what you looked at and what you found, with file paths.",
      ].join("\n"),
      tools: [...EXPLORE_TOOLS],
      permissions: { sandbox: "read-only" },
      source: { kind: "builtin" },
    },
  ];
}
