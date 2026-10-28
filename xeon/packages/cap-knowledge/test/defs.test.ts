import { describe, expect, test } from "bun:test";
import {
  KnowledgeLedger,
  KnowledgeMemory,
  KnowledgeSearch,
  KnowledgeSkills,
  validateCapability,
  validateCapabilitySet,
} from "@xeon/contracts/capabilities";
import { advertisedSkillsDef, IMPLEMENTED_SKILL_TOOLS } from "../src/plugin.ts";
import { knowledgeManifest } from "../src/manifest.ts";

const DEFS = [KnowledgeSkills, KnowledgeMemory, KnowledgeSearch, KnowledgeLedger];

describe("knowledge definitions", () => {
  test("four knowledge capabilities validate with zero issues", () => {
    for (const def of DEFS) expect(validateCapability(def)).toEqual([]);
    expect(validateCapabilitySet(DEFS)).toEqual([]);
  });

  test("write tool params exclude approval and overrideScan", () => {
    for (const def of [KnowledgeSkills, KnowledgeMemory]) {
      for (const tool of def.tools) {
        if (tool.name !== "skill_manage" && tool.name !== "memory_manage") continue;
        const parameters: unknown = tool.parameters;
        if (typeof parameters !== "object" || parameters === null) throw new Error("not a schema");
        const properties: unknown = Reflect.get(parameters, "properties");
        const names =
          typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
        expect(names).toContain("action");
        expect(names).not.toContain("approval");
        expect(names).not.toContain("overrideScan");
      }
    }
  });

  test("both skill tools are advertised once the gated write path exists", () => {
    const advertised = advertisedSkillsDef();
    expect(advertised.tools.map((tool) => tool.name)).toEqual([...IMPLEMENTED_SKILL_TOOLS]);
    expect(advertised.tools.map((tool) => tool.name)).toEqual(["skill_view", "skill_manage"]);
    expect(validateCapability(advertised)).toEqual([]);
  });

  test("the manifest provides only what is implemented", () => {
    expect(knowledgeManifest().provides?.map((entry) => entry.id)).toEqual([
      "knowledge.skills",
      "knowledge.memory",
      "knowledge.search",
      "knowledge.ledger",
    ]);
  });
});
