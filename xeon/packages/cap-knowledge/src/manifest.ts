import {
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
} from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const KNOWLEDGE_EXTENSION_NAME = "cap-knowledge";

/**
 * 내장 L2 플러그인 매니페스트(L2.knowledge.plan §2 manifest.ts). 제공하는 능력은 `knowledge.skills`(읽기, 쓰기, 재색인),
 * `knowledge.memory`, `knowledge.search`(스킬·메모리·세션 전문 검색), `knowledge.ledger`다.
 */
export function knowledgeManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: KNOWLEDGE_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Knowledge and memory",
    description: "Skills, memory, session search and the change ledger (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [
      { id: KnowledgeSkills.id, version: KnowledgeSkills.version },
      { id: KnowledgeMemory.id, version: KnowledgeMemory.version },
      { id: KnowledgeSearch.id, version: KnowledgeSearch.version },
      { id: KnowledgeLedger.id, version: KnowledgeLedger.version },
    ],
    points: ["session.start", "input.agent.before", "session.shutdown"],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
