// @xeon/cap-knowledge 공개 진입점(L2.knowledge). 조립 루트가 쓰는 이름만 내보낸다.
export { knowledgePlugin, advertisedSkillsDef, IMPLEMENTED_SKILL_TOOLS } from "./plugin.ts";
export type { KnowledgePluginOptions } from "./plugin.ts";
export { knowledgeManifest, KNOWLEDGE_EXTENSION_NAME } from "./manifest.ts";
export {
  DEFAULT_KNOWLEDGE_SETTINGS,
  KNOWLEDGE_SETTING_DEFS,
  readKnowledgeSettings,
} from "./settings.ts";
export type { KnowledgeSettings, KnowledgeSettingsSource } from "./settings.ts";
