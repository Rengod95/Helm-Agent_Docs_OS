import { expect, test } from "bun:test";
import { validateManifest } from "@xeon/contracts/extensions";
import manifestJson from "../.xeon-plugin/plugin.json" with { type: "json" };

test("__ID__.manifest-passes-validateManifest", () => {
  const result = validateManifest(manifestJson);
  expect(result.issues.filter((found) => found.severity === "error")).toEqual([]);
  expect(result.manifest?.name).toBe("__ID__");
  expect(result.manifest?.kind).toBe("group");
  expect(result.manifest?.layer).toBe("L3");
});
