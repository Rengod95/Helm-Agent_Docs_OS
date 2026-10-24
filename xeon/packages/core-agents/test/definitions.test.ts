import { describe, expect, test } from "bun:test";
import type { AgentDefinition } from "@xeon/contracts/services";
import {
  createDefinitionRegistry,
  loadDefinitionFiles,
  parseDefinitionFile,
} from "../src/index.ts";

const GOOD = `---
name: explorer
description: Explores the repository.
tools: [read, grep]
model: review
permissions:
  mode: plan
  rules:
    - id: no-bash
      action: tool.call
      resource: { tool: bash }
      effect: deny
---

You explore the repository.
`;

describe("definition files", () => {
  test("a good file becomes a definition with the body as its prompt", () => {
    const parsed = parseDefinitionFile("/ext/explorer.md", GOOD, {
      kind: "extension",
      extension: "helm",
      path: "/ext/explorer.md",
    });
    expect("definition" in parsed).toBe(true);
    if ("definition" in parsed) {
      expect(parsed.definition).toMatchObject({
        name: "explorer",
        prompt: "You explore the repository.",
        tools: ["read", "grep"],
        model: "review",
        permissions: { mode: "plan" },
        source: { kind: "extension", extension: "helm" },
      });
    }
  });

  // spec plan definition_file_frontmatter_parse_errors
  test("definition_file_frontmatter_parse_errors: each bad file is one diagnostic and the others still load", async () => {
    const files = new Map<string, string>([
      ["/a/good.md", GOOD],
      ["/a/yaml.md", "---\nname: [oops\n---\nBody"],
      ["/a/missing.md", "---\nname: no-description\n---\nBody"],
      ["/a/badname.md", "---\nname: Bad_Name\ndescription: x\n---\nBody"],
      ["/a/empty-body.md", "---\nname: empty\ndescription: x\n---\n"],
    ]);
    const loaded = await loadDefinitionFiles({
      paths: [...files.keys(), "/a/not-there.md"],
      readText: (path) => Promise.resolve(files.get(path) ?? null),
      sourceOf: (path) => ({ kind: "user", path }),
    });
    expect(loaded.definitions.map((definition) => definition.name)).toEqual(["explorer"]);
    expect(loaded.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      "/a/yaml.md",
      "/a/missing.md",
      "/a/badname.md",
      "/a/empty-body.md",
      "/a/not-there.md",
    ]);
  });
});

function make(source: AgentDefinition["source"], prompt: string): AgentDefinition {
  return { name: "explorer", description: "d", prompt, source };
}

describe("definition registry", () => {
  // spec plan definition_priority_project_over_user (2차 우선순위를 등록부가 이미 지킨다)
  test("project beats user beats extension beats builtin; later wins within a source; dispose falls back", () => {
    let changes = 0;
    const registry = createDefinitionRegistry(() => {
      changes += 1;
    });
    const builtin = registry.define(make({ kind: "builtin" }, "builtin"));
    expect(registry.get("explorer")?.prompt).toBe("builtin");
    const extension = registry.define(
      make({ kind: "extension", extension: "helm", path: "p" }, "extension"),
    );
    const user = registry.define(make({ kind: "user", path: "u" }, "user"));
    expect(registry.get("explorer")?.prompt).toBe("user");
    const project = registry.define(make({ kind: "project", path: "q" }, "project"));
    const laterProject = registry.define(make({ kind: "project", path: "r" }, "project-2"));
    expect(registry.get("explorer")?.prompt).toBe("project-2");
    laterProject();
    expect(registry.get("explorer")?.prompt).toBe("project");
    project();
    user();
    expect(registry.get("explorer")?.prompt).toBe("extension");
    extension();
    builtin();
    expect(registry.get("explorer")).toBeUndefined();
    expect(registry.list()).toEqual([]);
    expect(changes).toBe(10);
  });
});
