import { describe, expect, test } from "bun:test";
import { MODELS_SETTING_DEFS } from "@fresnel/core-models";
import { toSettingDefWire, type SettingDefWire } from "@fresnel/contracts/settings";
import { buildSettingsView } from "../../src/settings/index.ts";
import { effectiveOf } from "./fixtures.ts";

// X10(review.m3b-plan §1.1): 설정 화면의 항목 키 집합이 스키마에서 `ui`를 단 키 집합과 같다.
// 이 패키지가 가져올 수 있는 실제 정의는 core-models의 `l1.models.*`뿐이다(devDependency). 전체 카탈로그
// (모든 층의 정의를 호스트가 조립한 것)의 같은 시험은 `apps/cli/test/x10-settings-keys.int.test.ts`가 맡는다.

describe("the settings view covers the schema keys", () => {
  const wires: readonly SettingDefWire[] = MODELS_SETTING_DEFS.map((def) => toSettingDefWire(def));
  // 값을 기본값으로 채운다. 폐기 정의는 기본값 출처일 때 숨기므로 기대 집합에서 뺀다(정의가 없는 한 빈 집합이다)
  const values = new Map(
    wires.map((wire) => [
      wire.key,
      effectiveOf(wire.key, wire.default ?? null, {
        source: { scope: "default" },
        runtimeChange: wire.runtimeChange,
      }),
    ]),
  );
  const view = buildSettingsView({ defs: wires, values, hasThread: true });

  test("settings.fields-equal-schema-keys", () => {
    const fieldKeys = view.tabs.flatMap((tab) => tab.fields.map((field) => field.key)).toSorted();
    const uiKeys = wires
      .filter(
        (def) => def.ui !== undefined && def.stage !== "reserved" && def.deprecated === undefined,
      )
      .map((def) => def.key)
      .toSorted();
    expect(fieldKeys).toEqual(uiKeys);
    expect(fieldKeys.length).toBeGreaterThan(0);
  });

  test("every definition without a ui lands in the file-only list, and every one is placed exactly once", () => {
    const fileOnlyKeys = view.fileOnly.map((entry) => entry.key).toSorted();
    const plainKeys = wires
      .filter((def) => def.ui === undefined && def.stage !== "reserved")
      .map((def) => def.key)
      .toSorted();
    expect(fileOnlyKeys).toEqual(plainKeys);
    const everyPlaced = [
      ...view.tabs.flatMap((tab) => tab.fields.map((field) => field.key)),
      ...fileOnlyKeys,
    ].toSorted();
    const expectedAll = wires
      .filter((def) => def.stage !== "reserved" && def.deprecated === undefined)
      .map((def) => def.key)
      .toSorted();
    expect(everyPlaced).toEqual(expectedAll);
  });
});
