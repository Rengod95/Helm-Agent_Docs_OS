import { expect, test } from "bun:test";
import { buildCatalog, checkSettingDef } from "@xeon/contracts/settings";
import { groupKitSettings } from "../src/index.ts";

test("settings.no-drive-holder-key", () => {
  expect(Object.keys(groupKitSettings.defs).toSorted()).toEqual(["instrumentation", "statusLine"]);
  expect(groupKitSettings.namespace).toBe("l3.group-kit");
  for (const def of Object.values(groupKitSettings.defs)) {
    expect(checkSettingDef(def)).toEqual([]);
  }
  // 구동 그룹 선택과 그룹 켜기 키는 X가 소유하므로 이 묶음에 없다
  const keys = Object.values(groupKitSettings.defs).map((def) => def.key);
  expect(keys).not.toContain("l3.group-kit.activeDriveGroup");
  expect(keys.some((key) => key.endsWith(".enabled"))).toBe(false);
});

test("settings.build-into-a-catalog", () => {
  const built = buildCatalog([
    {
      owner: "group-kit",
      namespace: groupKitSettings.namespace,
      defs: Object.values(groupKitSettings.defs),
    },
  ]);
  expect(built.ok).toBe(true);
});
