import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { extSettingsOf } from "../../src/assembly/ext-settings.ts";
import { createSettingsEngine } from "../../src/assembly/settings-engine.ts";

// AGE-74 reqLock: 엔진이 필요로 하는 플러그인의 꺼짐 값은 로더가 읽을 때 무시한다. 저장돼 있어도 실린다.

const scratch = mkdtempSync(join(tmpdir(), "xh-reqlock-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function sourceWith(values: Readonly<Record<string, unknown>>) {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const settings = createSettingsEngine(built.catalog);
  const path = join(scratch, "settings.json");
  writeFileSync(path, JSON.stringify(values));
  await settings.loadUserFile(path);
  return extSettingsOf(built.catalog, settings);
}

test("a stored off value is ignored for a core-required plugin and still read for others", async () => {
  // 키가 카탈로그에 아직 없을 때 로더는 사용자 파일의 값을 읽는다(예전 동작)
  const source = await sourceWith({
    "ext.cap-workspace.enabled": false,
    "ext.cap-dialog.enabled": false,
    "ext.other-plugin.enabled": false,
  });
  expect(source.enabled("cap-workspace")).toBeUndefined();
  expect(source.enabled("cap-dialog")).toBeUndefined();
  expect(source.enabled("other-plugin")).toBe(false);
});
