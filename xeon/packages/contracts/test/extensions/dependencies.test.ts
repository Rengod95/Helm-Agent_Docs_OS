import { describe, expect, test } from "bun:test";
import {
  dependenciesOf,
  dependencyKindOf,
  splitDependencyTarget,
  validateManifest,
  validateManifestSet,
} from "../../src/extensions/index.ts";
import { orchestrationJson, pluginJson, validManifest } from "./helpers.ts";

describe("dependsOn declaration defaults", () => {
  test("kind is soft, range is null, and a bare extension name has a null member", () => {
    const manifest = validManifest(
      pluginJson({ name: "alpha" }, { dependsOn: [{ plugin: "beta" }] }),
    );
    expect(dependenciesOf(manifest)).toEqual([
      {
        from: "alpha",
        target: "beta",
        targetExtension: "beta",
        targetMember: null,
        range: null,
        kind: "soft",
      },
    ]);
  });

  test("`name/id` splits into the member id and keeps the declared range and kind", () => {
    const manifest = validManifest(
      orchestrationJson({
        name: "alpha",
        plugins: [
          { layer: "L3", hooks: [] },
          {
            id: "ui",
            layer: "L3",
            hooks: [],
            dependsOn: [{ plugin: "beta/core", kind: "hard", range: "^1.0.0" }],
          },
        ],
      }),
    );
    expect(dependenciesOf(manifest)).toEqual([
      {
        from: "alpha/ui",
        target: "beta/core",
        targetExtension: "beta",
        targetMember: "core",
        range: "^1.0.0",
        kind: "hard",
      },
    ]);
  });

  test("dependencyKindOf and splitDependencyTarget return the default kind and the member id", () => {
    expect(dependencyKindOf({})).toBe("soft");
    expect(dependencyKindOf({ kind: "hard" })).toBe("hard");
    expect(splitDependencyTarget("beta")).toEqual({ extension: "beta", member: null });
    expect(splitDependencyTarget("beta/core")).toEqual({ extension: "beta", member: "core" });
  });
});

describe("validateManifest dependsOn checks", () => {
  test("a malformed range is dependency_range_invalid", () => {
    const result = validateManifest(
      pluginJson({ name: "alpha" }, { dependsOn: [{ plugin: "beta", range: "latest" }] }),
    );
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["dependency_range_invalid", "error", "/plugins/0/dependsOn/0/range"],
    ]);
  });

  test("listing the same target twice is dependency_duplicate, pointing at the second entry", () => {
    const result = validateManifest(
      pluginJson(
        { name: "alpha" },
        { dependsOn: [{ plugin: "beta" }, { plugin: "beta", range: "^1.0.0" }] },
      ),
    );
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["dependency_duplicate", "error", "/plugins/0/dependsOn/1"],
    ]);
  });

  test("pointing into the same extension is dependency_self, for a root and for a member", () => {
    const root = validateManifest(
      pluginJson({ name: "alpha" }, { dependsOn: [{ plugin: "alpha/ui" }] }),
    );
    expect(root.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["dependency_self", "error", "/plugins/0/dependsOn/0/plugin"],
    ]);

    const member = validateManifest(
      orchestrationJson({
        name: "alpha",
        plugins: [
          { layer: "L3", hooks: [] },
          { id: "ui", layer: "L3", hooks: [], dependsOn: [{ plugin: "alpha" }] },
        ],
      }),
    );
    expect(member.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["dependency_self", "error", "/plugins/1/dependsOn/0/plugin"],
    ]);
  });
});

describe("validateManifestSet dependency_cycle checks", () => {
  test("a hard cycle (A -> B -> A) is a dependency_cycle error", () => {
    const issues = validateManifestSet([
      validManifest(
        pluginJson({ name: "alpha" }, { dependsOn: [{ plugin: "beta", kind: "hard" }] }),
      ),
      validManifest(
        pluginJson({ name: "beta" }, { dependsOn: [{ plugin: "alpha", kind: "hard" }] }),
      ),
    ]);
    expect(issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["dependency_cycle", "error", "alpha/dependsOn"],
    ]);
  });

  test("a soft cycle (A -> B -> A) raises no issue", () => {
    const issues = validateManifestSet([
      validManifest(pluginJson({ name: "alpha" }, { dependsOn: [{ plugin: "beta" }] })),
      validManifest(
        pluginJson({ name: "beta" }, { dependsOn: [{ plugin: "alpha", kind: "soft" }] }),
      ),
    ]);
    expect(issues).toEqual([]);
  });

  test("viewed per member it is not a cycle (alpha/ui -> beta, beta -> alpha/core)", () => {
    const issues = validateManifestSet([
      validManifest(
        orchestrationJson({
          name: "alpha",
          plugins: [
            { layer: "L3", hooks: [] },
            { id: "ui", layer: "L3", hooks: [], dependsOn: [{ plugin: "beta", kind: "hard" }] },
            { id: "core", layer: "L3", hooks: [] },
          ],
        }),
      ),
      validManifest(
        orchestrationJson({
          name: "beta",
          plugins: [
            {
              layer: "L3",
              hooks: [],
              dependsOn: [{ plugin: "alpha/core", kind: "hard" }],
            },
            { id: "core", layer: "L3", hooks: [] },
          ],
        }),
      ),
    ]);
    expect(issues).toEqual([]);
  });

  test("members that depend on each other (alpha/ui -> beta/core -> alpha/ui) are a dependency_cycle", () => {
    const issues = validateManifestSet([
      validManifest(
        orchestrationJson({
          name: "alpha",
          plugins: [
            { layer: "L3", hooks: [] },
            {
              id: "ui",
              layer: "L3",
              hooks: [],
              dependsOn: [{ plugin: "beta/core", kind: "hard" }],
            },
          ],
        }),
      ),
      validManifest(
        orchestrationJson({
          name: "beta",
          plugins: [
            { layer: "L3", hooks: [] },
            {
              id: "core",
              layer: "L3",
              hooks: [],
              dependsOn: [{ plugin: "alpha/ui", kind: "hard" }],
            },
          ],
        }),
      ),
    ]);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([["dependency_cycle", "error"]]);
  });
});
