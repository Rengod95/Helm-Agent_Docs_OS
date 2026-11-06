import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { defaultPluginsOf } from "./default-plugins.ts";

test("defaultPluginsOf reads the release bundle list", () => {
  expect(
    defaultPluginsOf({
      templates: "x",
      defaultPlugins: [
        { name: "helm", buildScript: "packages/group-helm/scripts/build-plugin.ts" },
      ],
    }),
  ).toEqual([{ name: "helm", buildScript: "packages/group-helm/scripts/build-plugin.ts" }]);
});

test("defaultPluginsOf rejects a wrong shape or a name that leaves its folder", () => {
  expect(defaultPluginsOf(null)).toBeNull();
  expect(defaultPluginsOf({})).toBeNull();
  expect(defaultPluginsOf({ defaultPlugins: [{ name: "a" }] })).toBeNull();
  expect(defaultPluginsOf({ defaultPlugins: [{ name: "../a", buildScript: "s" }] })).toBeNull();
});

test("the committed release bundle names helm", () => {
  const config: unknown = JSON.parse(
    readFileSync(`${import.meta.dir}/release-bundle.json`, "utf8"),
  );
  expect(defaultPluginsOf(config)?.map((p) => p.name)).toEqual(["helm"]);
});
