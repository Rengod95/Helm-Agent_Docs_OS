import { describe, expect, test } from "bun:test";
import {
  buildCatalog,
  checkSettingDef,
  type ScopeLayer,
  type ScopeStack,
} from "@xeon/contracts/settings";
import {
  DEFAULT_KNOWLEDGE_SETTINGS,
  KNOWLEDGE_SETTING_DEFS,
  readKnowledgeSettings,
} from "../src/settings.ts";

function layer(scope: ScopeLayer["scope"], values: Record<string, unknown>): ScopeLayer {
  return { scope, values: new Map(Object.entries(values)) };
}

const SPEC_KEYS = [
  "l2.knowledge.skills.enabled",
  "l2.knowledge.skills.projectSkills",
  "l2.knowledge.skills.paths",
  "l2.knowledge.skills.indexBudgetChars",
  "l2.knowledge.skills.indexDescriptionChars",
  "l2.knowledge.memory.enabled",
  "l2.knowledge.memory.userLimitChars",
  "l2.knowledge.memory.envLimitChars",
  "l2.knowledge.write.approval",
  "l2.knowledge.write.scan",
  "l2.knowledge.write.proposalExpiryDays",
  "l2.knowledge.write.trustedEvidenceSources",
  "l2.knowledge.search.enabled",
  "l2.knowledge.search.defaultScope",
  "l2.knowledge.search.includeHiddenDefault",
  "l2.knowledge.search.likeScanLimit",
];

describe("knowledge settings", () => {
  test("knowledge settings pass checkSettingDef", () => {
    expect(KNOWLEDGE_SETTING_DEFS.map((def) => def.key)).toEqual(SPEC_KEYS);
    for (const def of KNOWLEDGE_SETTING_DEFS) {
      expect(checkSettingDef(def)).toEqual([]);
      expect(def.layer).toBe("L2");
      expect(def.secret).toBeUndefined();
    }
    const built = buildCatalog([
      { owner: "cap-knowledge", namespace: "l2.knowledge", defs: KNOWLEDGE_SETTING_DEFS },
    ]);
    expect(built.ok).toBe(true);
  });

  test("approval, scan, evidence and path keys are owner scopes only", () => {
    const restricted = new Set([
      "l2.knowledge.write.approval",
      "l2.knowledge.write.scan",
      "l2.knowledge.write.trustedEvidenceSources",
      "l2.knowledge.write.proposalExpiryDays",
      "l2.knowledge.skills.paths",
      "l2.knowledge.skills.projectSkills",
    ]);
    for (const def of KNOWLEDGE_SETTING_DEFS) {
      if (restricted.has(def.key)) expect([...def.allowedScopes]).toEqual(["managed", "user"]);
    }
  });

  test("defaults match the spec table", () => {
    expect(readKnowledgeSettings([])).toEqual(DEFAULT_KNOWLEDGE_SETTINGS);
    expect(DEFAULT_KNOWLEDGE_SETTINGS).toEqual({
      skills: {
        enabled: true,
        projectSkills: true,
        paths: [],
        indexBudgetChars: 8000,
        indexDescriptionChars: 160,
      },
      memory: { enabled: true, userLimitChars: 1375, envLimitChars: 2200 },
      write: { approval: true, scan: true, proposalExpiryDays: 14, trustedEvidenceSources: [] },
      search: {
        enabled: true,
        defaultScope: "all",
        includeHiddenDefault: false,
        likeScanLimit: 20000,
      },
    });
  });

  test("a project file cannot turn off write approval", () => {
    const stack: ScopeStack = [
      layer("project", {
        "l2.knowledge.write.approval": false,
        "l2.knowledge.write.scan": false,
        "l2.knowledge.skills.paths": ["/evil"],
        "l2.knowledge.skills.indexBudgetChars": 2000,
      }),
    ];
    const settings = readKnowledgeSettings(stack);
    expect(settings.write.approval).toBe(true);
    expect(settings.write.scan).toBe(true);
    expect(settings.skills.paths).toEqual([]);
    // 예산 키는 프로젝트 범위를 허용한다
    expect(settings.skills.indexBudgetChars).toBe(2000);
  });

  test("owner scopes apply and invalid values are skipped", () => {
    const stack: ScopeStack = [
      layer("user", {
        "l2.knowledge.write.approval": false,
        "l2.knowledge.skills.paths": ["/opt/skills"],
        "l2.knowledge.memory.userLimitChars": 10,
        "l2.knowledge.search.defaultScope": "project",
      }),
    ];
    const settings = readKnowledgeSettings(stack);
    expect(settings.write.approval).toBe(false);
    expect(settings.skills.paths).toEqual(["/opt/skills"]);
    expect(settings.memory.userLimitChars).toBe(1375);
    expect(settings.search.defaultScope).toBe("project");
  });
});
