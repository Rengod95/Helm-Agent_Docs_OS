// 정의 등록부(L1.agents.spec §3.3 define·definition·definitions, §4.9). 같은 이름은 우선순위가 높은 출처가 이긴다:
// 프로젝트 > 사용자 > 확장 > 내장. 같은 출처끼리는 나중에 등록한 것이 이긴다.
import type { AgentDefinition, AgentDefinitionSource } from "@xeon/contracts/services";

const SOURCE_RANK: Readonly<Record<AgentDefinitionSource["kind"], number>> = {
  builtin: 0,
  extension: 1,
  user: 2,
  project: 3,
};

export interface DefinitionRegistry {
  /** 정의를 등록하고 해제 함수를 돌려준다 */
  define(definition: AgentDefinition): () => void;
  get(name: string): AgentDefinition | undefined;
  /** 이름마다 이긴 정의, 이름순 */
  list(): readonly AgentDefinition[];
}

/** 등록이나 해제로 이긴 정의가 바뀔 수 있을 때 부른다(차단 규칙 다시 등록) */
export function createDefinitionRegistry(onChange: () => void): DefinitionRegistry {
  const entries: AgentDefinition[] = [];

  const winner = (name: string): AgentDefinition | undefined => {
    let best: AgentDefinition | undefined;
    for (const entry of entries) {
      if (entry.name !== name) continue;
      if (best === undefined || SOURCE_RANK[entry.source.kind] >= SOURCE_RANK[best.source.kind]) {
        best = entry;
      }
    }
    return best;
  };

  return {
    define(definition): () => void {
      entries.push(definition);
      onChange();
      return () => {
        const index = entries.indexOf(definition);
        if (index < 0) return;
        entries.splice(index, 1);
        onChange();
      };
    },
    get: winner,
    list() {
      const names = [...new Set(entries.map((entry) => entry.name))].toSorted();
      return names.flatMap((name) => {
        const entry = winner(name);
        return entry === undefined ? [] : [entry];
      });
    },
  };
}
