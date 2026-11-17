// 코드가 없는 플러그인(매니페스트에 entry가 없다, §4.5.4): 검사와 묶기는 엔트리 검사를 건너뛰고,
// 묶을 것이 없으니 폴더를 그대로 옮긴다. 묶음 매니페스트에 entry를 새로 적지 않는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { packExtension, scaffoldExtension, validateExtensionDir } from "../src/index.ts";
import { tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();
const templates = templateDirs();

test("a plugin without entry validates and packs as a folder with no bundle", async () => {
  const dir = root.path("no-code");
  const made = await scaffoldExtension(
    { kind: "single-plugin", name: "no-code", dir },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  const manifestPath = join(dir, ".fresnel-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.entry;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const checked = await validateExtensionDir(dir);
  expect(checked.ok && checked.value.ok).toBe(true);

  const packed = await packExtension({ dir });
  if (!packed.ok) throw new Error(packed.error.message);
  expect(existsSync(join(packed.value.path, "dist"))).toBe(false);
  const packedManifest = JSON.parse(
    readFileSync(join(packed.value.path, ".fresnel-plugin", "plugin.json"), "utf8"),
  );
  expect(packedManifest.entry).toBeUndefined();
});
