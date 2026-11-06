import { describe, expect, test } from "bun:test";
import { targetNamesOf } from "../../../src/views/tests/tests-actions.ts";
import { entry } from "../workbench/support.tsx";

describe("새 테스트 대상 이름", () => {
  test("host units and safe-mode exclusions are not offered, loaded extensions are", () => {
    const names = targetNamesOf([
      entry("core-loop", { origin: "builtin" }),
      entry("helm", { origin: "managed" }),
      entry("mine", { origin: "user" }),
      entry("old-host"),
      entry("held-back", { origin: "user", safeModeExcluded: "safe mode" }),
    ]);
    expect(names).toEqual(["helm", "mine", "old-host"]);
  });
});
