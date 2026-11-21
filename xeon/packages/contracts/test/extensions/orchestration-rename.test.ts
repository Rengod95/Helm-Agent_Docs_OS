import { describe, expect, test } from "bun:test";
import { validateManifest } from "../../src/extensions/index.ts";
import { WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";
import { orchestrationJson, pluginJson } from "./helpers.ts";

// AGE-33: 그룹을 플러그인 개념으로 흡수하면서 바꾼 이름. 옛 이름은 조용히 받아들이지 않는다(배포 전이라 옛 이름 읽기는 없다).

describe("orchestration rename: old names are not accepted", () => {
  test("the new manifest block validates", () => {
    expect(validateManifest(orchestrationJson()).issues).toEqual([]);
  });

  test("the old top-level group block is rejected as a legacy field, not dropped silently", () => {
    const result = validateManifest(pluginJson({ name: "learning", group: {} }, { layer: "L3" }));
    const legacy = result.issues.filter((found) => found.code === "legacy_field");
    expect(legacy.map((found) => [found.severity, found.path])).toEqual([["error", "/group"]]);
    expect(legacy[0]?.message).toContain("orchestration");
  });

  test("the old wire methods are gone and the new ones exist", () => {
    const names = Object.keys(WIRE_METHODS);
    for (const old of ["group.list", "group.metrics", "group.promotion"]) {
      expect(names).not.toContain(old);
    }
    for (const current of [
      "orchestration.list",
      "orchestration.metrics",
      "orchestration.promotion",
    ]) {
      expect(names).toContain(current);
    }
  });
});
