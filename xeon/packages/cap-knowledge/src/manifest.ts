import { KnowledgeLedger, KnowledgeMemory, KnowledgeSkills } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const KNOWLEDGE_EXTENSION_NAME = "cap-knowledge";

/**
 * 내장 L2 플러그인 매니페스트(L2.knowledge.plan §2 manifest.ts). KN.3까지 제공하는 능력은 `knowledge.skills`(읽기, 쓰기,
 * 재색인), `knowledge.memory`, `knowledge.ledger`다. `knowledge.search`는 K8·K9가 `provides`에 더한다.
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
      { id: KnowledgeLedger.id, version: KnowledgeLedger.version },
    ],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
