import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../src/extensions/index.ts";
import { codesOf, pluginJson } from "./helpers.ts";

// M5e 스펙 §5.1 H-4(내부 훅은 내장만, 발화하지 않는 훅은 경고)와 §4.1.1(`hookDecides` 결정 선언).

describe("internal hooks (H-4)", () => {
  test("a user-tier manifest that declares thread.fork.before is refused with hook_internal", () => {
    const result = validateManifest(
      pluginJson({ trust: { level: "user" } }, { hooks: ["thread.fork.before"] }),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["hook_internal", "error", "/plugins/0/hooks/0"],
    ]);
  });

  test("a builtin-tier manifest may declare thread.fork.before", () => {
    const result = validateManifest(
      pluginJson({ name: "web", trust: { level: "builtin" } }, { hooks: ["thread.fork.before"] }),
    );
    expect(result.manifest).toBeDefined();
    expect(result.issues).toEqual([]);
  });

  test("a manifest with no trust level is not builtin, so every internal hook is refused", () => {
    for (const hook of [
      "request.cache.before",
      "thread.trust.before",
      "thread.switch.before",
      "thread.fork.before",
      "thread.tree.before",
    ] as const) {
      const result = validateManifest(pluginJson({}, { hooks: [hook] }));
      expect(result.manifest).toBeUndefined();
      expect(codesOf(result.issues)).toContain("hook_internal");
    }
  });

  test("an internal hook that this build does not fire also draws the hook_not_fired warning", () => {
    const result = validateManifest(pluginJson({}, { hooks: ["thread.trust.before"] }));
    expect(result.issues.map((i) => [i.code, i.severity])).toEqual([
      ["hook_internal", "error"],
      ["hook_not_fired", "warning"],
    ]);
  });
});

describe("hook_not_fired (H-4)", () => {
  test("a declared hook that this build does not fire is a warning, and the manifest is accepted", () => {
    const result = validateManifest(
      pluginJson({ name: "web", trust: { level: "builtin" } }, { hooks: ["request.cache.before"] }),
    );
    expect(result.manifest).toBeDefined();
    expect(result.issues.map((i) => [i.code, i.severity, i.path])).toEqual([
      ["hook_not_fired", "warning", "/plugins/0/hooks/0"],
    ]);
  });
});

describe("hookDecides (§4.1.1)", () => {
  test("tool.call.before may declare block and ask", () => {
    const result = validateManifest(
      pluginJson(
        {},
        {
          hooks: ["tool.call.before"],
          hookDecides: [{ hook: "tool.call.before", decides: ["block", "ask"] }],
        },
      ),
    );
    expect(result.manifest).toBeDefined();
    expect(result.issues).toEqual([]);
  });

  test("a hook that cannot decide refuses a declared kind with hook_decision_not_allowed", () => {
    const result = validateManifest(
      pluginJson(
        {},
        {
          hooks: ["thread.compact.before"],
          hookDecides: [{ hook: "thread.compact.before", decides: ["ask"] }],
        },
      ),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["hook_decision_not_allowed", "/plugins/0/hookDecides/0/decides/0"],
    ]);
  });

  test("a decision declared for a hook the plugin does not list is refused", () => {
    const result = validateManifest(
      pluginJson(
        {},
        { hooks: [], hookDecides: [{ hook: "tool.call.before", decides: ["block"] }] },
      ),
    );
    expect(result.manifest).toBeUndefined();
    expect(result.issues.map((i) => [i.code, i.path])).toEqual([
      ["hook_decision_not_allowed", "/plugins/0/hookDecides/0"],
    ]);
  });
});
