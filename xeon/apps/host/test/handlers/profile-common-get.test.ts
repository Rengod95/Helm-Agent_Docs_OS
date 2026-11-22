import type { ExtensionManifest } from "@fresnel/contracts/extensions";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileIssue } from "@fresnel/contracts/wire";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { DeclaredInventory } from "../../src/assembly/m4/profile-cost.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4, §4.1.5: `profile.common.get`은 공통 묶음과, 지금 설치된 라이브러리에 비춘 검사 이슈 목록을 준다.
// 저장된 묶음이 라이브러리와 맞지 않게 바뀌면(플러그인이 빠지면) 같은 묶음의 이슈가 달라진다. 가짜 엔진 위의 실제 처리기다.

/** 시험용 최소 매니페스트. 의존과 구성원이 없다 */
function manifestStub(name: string): ExtensionManifest {
  return { schemaVersion: 2, name, version: "1.0.0" };
}

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-common-get-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PERMISSION = "l1.tools.permissionMode";
const NONE: DeclaredInventory = {
  code: false,
  root: "/nonexistent",
  tools: [],
  instructions: [],
  skills: [],
};
/** 필수 설정 키가 있는 플러그인. 공통 묶음이 그 키를 주지 않으면 경고가 난다 */
const DEMO: PluginFact = {
  name: "demo",
  replaces: [],
  drives: false,
  requiredKeys: [PERMISSION],
  version: "1.0.0",
  manifest: manifestStub("demo"),
  declared: NONE,
};

test("profile.common.get on a store nothing was saved to is the empty common set at rev 0 with no issues, and writes no file", async () => {
  const dir = tempDir();
  const host = createFakeHost({
    profiles: { configDir: dir, pluginFacts: () => [DEMO] },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("profile.common.get", {})).toEqual({
    common: {
      plugins: [],
      settings: [],
      updatedAt: "1970-01-01T00:00:00.000Z",
      rev: 0,
    },
    issues: [],
  });
  expect(existsSync(join(dir, "profiles.json"))).toBe(false);
  await connection.close();
});

test("profile.common.get returns the stored set and the issues the library gives it now: an unset required key is a warning, a plugin that left the library is a warning", async () => {
  const dir = tempDir();
  // 설치된 플러그인 목록을 시험 중에 바꾼다. 검사는 매번 지금 목록으로 한다
  let facts: readonly PluginFact[] = [DEMO];
  const host = createFakeHost({
    profiles: { configDir: dir, pluginFacts: () => facts },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  // 필수 키를 주지 않은 묶음은 저장되고, 저장 응답의 이슈와 조회의 이슈가 같다
  const put = await connection.request("profile.common.put", {
    common: { plugins: [{ name: "demo" }], settings: [] },
    baseRev: 0,
  });
  const requiredUnset: readonly ProfileIssue[] = [
    { code: "required_unset", severity: "warning", plugin: "demo", key: PERMISSION },
  ];
  expect(put.issues).toEqual(requiredUnset);
  expect(await connection.request("profile.common.get", {})).toEqual({
    common: {
      plugins: [{ name: "demo" }],
      settings: [],
      updatedAt: put.common.updatedAt,
      rev: 1,
    },
    issues: requiredUnset,
  });

  // 필수 키를 채우면 이슈가 없어진다. 묶음의 개정은 한 번 더 오른다
  const filled = await connection.request("profile.common.put", {
    common: { plugins: [{ name: "demo" }], settings: [{ key: PERMISSION, value: "default" }] },
    baseRev: 1,
  });
  expect(filled.issues).toEqual([]);
  expect(await connection.request("profile.common.get", {})).toEqual({
    common: {
      plugins: [{ name: "demo" }],
      settings: [{ key: PERMISSION, value: "default" }],
      updatedAt: filled.common.updatedAt,
      rev: 2,
    },
    issues: [],
  });

  // `demo`가 라이브러리에서 빠지면 저장된 묶음은 그대로이고, 이미 든 이름이라 이슈는 경고 `plugin_unknown`으로 바뀐다(AGE-34)
  facts = [];
  expect(await connection.request("profile.common.get", {})).toEqual({
    common: {
      plugins: [{ name: "demo" }],
      settings: [{ key: PERMISSION, value: "default" }],
      updatedAt: filled.common.updatedAt,
      rev: 2,
    },
    issues: [{ code: "plugin_unknown", severity: "warning", plugin: "demo" }],
  });
  await connection.close();
});
