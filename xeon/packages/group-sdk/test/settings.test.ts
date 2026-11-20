import { expect, test } from "bun:test";
import { buildCatalog, checkSettingDef } from "@fresnel/contracts/settings";
import { orchestrationSdkSettings } from "../src/index.ts";

test("settings.no-drive-holder-key", () => {
  expect(Object.keys(orchestrationSdkSettings.defs).toSorted()).toEqual(["instrumentation"]);
  expect(orchestrationSdkSettings.namespace).toBe("l3.orchestration");
  for (const def of Object.values(orchestrationSdkSettings.defs)) {
    expect(checkSettingDef(def)).toEqual([]);
  }
  // 구동 그룹 선택과 그룹 켜기 키는 X가 소유하므로 이 묶음에 없다
  const keys = Object.values(orchestrationSdkSettings.defs).map((def) => def.key);
  expect(keys).not.toContain("l3.orchestration.activeDriver");
  expect(keys.some((key) => key.endsWith(".enabled"))).toBe(false);
});

test("settings.build-into-a-catalog", () => {
  const built = buildCatalog([
    {
      owner: "group-sdk",
      namespace: orchestrationSdkSettings.namespace,
      defs: Object.values(orchestrationSdkSettings.defs),
    },
  ]);
  expect(built.ok).toBe(true);
});
