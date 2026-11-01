import { expect, test } from "bun:test";
import { validateManifest } from "@fresnel/contracts/extensions";
import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };

test("__ID__.manifest-passes-validateManifest", () => {
  const result = validateManifest(manifestJson);
  expect(result.issues.filter((found) => found.severity === "error")).toEqual([]);
  expect(result.manifest?.name).toBe("__ID__");
  expect(result.manifest?.group).toEqual({});
  expect(result.manifest?.plugins.map((plugin) => plugin.layer)).toEqual(["L3"]);
});
