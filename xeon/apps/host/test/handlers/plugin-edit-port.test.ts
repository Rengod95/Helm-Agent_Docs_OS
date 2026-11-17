import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { ProfilesChange } from "../../src/assembly/m4/profile-store.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";

// M5c §4.7.3 승인의 프로필 쓰기: 실제 프로필 저장소(파일 잠금, 개정, `profile.changed` 알림) 위에서 돈다.
// 플러그인 사실과 검사는 시험이 정한다. 쓰기는 `applyPluginEdit`만 한다.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const KIT: PluginFact = { name: "kit", replaces: [], drives: false, requiredKeys: [] };
const HELM: PluginFact = { name: "helm", replaces: [], drives: false, requiredKeys: [] };

function rigOf(): {
  readonly port: ReturnType<
    typeof createFakeHost
  >["fake"]["engine"]["ports"]["m4"]["profileTestRun"];
  readonly changes: ProfilesChange[];
} {
  const dir = mkdtempSync(join(tmpdir(), "xh-plugin-edit-"));
  roots.push(dir);
  const host = createFakeHost({ profiles: { configDir: dir, pluginFacts: () => [HELM] } });
  const port = host.fake.engine.ports.m4.profileTestRun;
  const changes: ProfilesChange[] = [];
  port.onProfilesChanged((change) => changes.push(change));
  return { port, changes };
}

test("applying an add writes the plugin at the end of the chosen profile and tells the profile listeners", async () => {
  const { port, changes } = rigOf();
  expect(await port.applyPluginEdit({ kind: "add", plugin: KIT, profileIds: ["default"] })).toEqual(
    ok(["default"]),
  );
  expect(changes.map((change) => [change.ids, change.commonChanged])).toEqual([
    [["default"], false],
  ]);
  const stored = await port.get("default");
  // 공장 기본 프로필은 `helm`을 이미 든다. 승인한 `kit`은 맨 뒤다
  expect(stored.ok ? [stored.value.plugins, stored.value.rev] : null).toEqual([
    [{ name: "helm" }, { name: "kit" }],
    1,
  ]);
});

test("an add whose target profile is gone is refused as profile_not_found and writes nothing", async () => {
  const { port, changes } = rigOf();
  const request = { kind: "add", plugin: KIT, profileIds: ["gone"] } as const;
  expect(await port.checkPluginEdit(request)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [{ profile: "gone", code: "profile_not_found", severity: "error" }],
    }),
  );
  expect(await port.applyPluginEdit(request)).toEqual(
    err({
      kind: "plugin_invalid",
      issues: [{ profile: "gone", code: "profile_not_found", severity: "error" }],
    }),
  );
  expect(changes).toEqual([]);
});

test("a remove takes the plugin out, and a repeat of the same remove changes nothing", async () => {
  const { port, changes } = rigOf();
  await port.applyPluginEdit({ kind: "add", plugin: KIT, profileIds: ["default"] });
  expect(await port.applyPluginEdit({ kind: "remove", plugin: "kit" })).toEqual(ok(["default"]));
  expect(await port.applyPluginEdit({ kind: "remove", plugin: "kit" })).toEqual(ok([]));
  expect(changes.map((change) => change.ids)).toEqual([["default"], ["default"]]);
  const stored = await port.get("default");
  expect(stored.ok ? stored.value.plugins : null).toEqual([{ name: "helm" }]);
});
