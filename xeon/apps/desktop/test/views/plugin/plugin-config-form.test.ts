import { describe, expect, test } from "bun:test";
import { pluginFieldsOf } from "../../../src/views/plugin/plugin-config-form.tsx";
import { defOf, settingOf, viewOf } from "../settings-fixtures.ts";

// 플러그인 상세 "설정" 구역이 고르는 항목(DP-92). 값을 그대로 비교한다.

const TEXT = { type: "string" };
const KEYS = [
  "ext.notes.enabled",
  "ext.notes.folder",
  "l3.notes.apiKey",
  "ext.notesx.folder",
  "ext.notes.",
  "l1.models.default",
];

describe("pluginFieldsOf", () => {
  test("takes the plugin's own ext. and l3. keys, without its enabled switch or another plugin's keys", () => {
    const view = viewOf(
      KEYS.map((key) => defOf(key, "plugins", "text", TEXT)),
      KEYS.map((key) => settingOf(key, "")),
    );
    const fields = view.tabs.flatMap((tab) => tab.fields);
    expect(pluginFieldsOf(fields, "notes").map((field) => field.key)).toEqual([
      "ext.notes.folder",
      "l3.notes.apiKey",
    ]);
  });
});
