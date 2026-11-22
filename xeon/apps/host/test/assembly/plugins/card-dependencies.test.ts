import { expect, test } from "bun:test";
import {
  validateManifest,
  type ExtensionManifest,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import type { DependencyNode } from "@fresnel/ext-host";
import {
  buildPluginCard,
  withInstalledDependencies,
  type CardSubject,
} from "../../../src/assembly/plugins/card.ts";

// AGE-33 enDep: 카드의 의존 칸. 매니페스트만 아는 `buildPluginCard`는 `dependsOn`(problem null)까지만 싣고,
// 검토 서비스의 `withInstalledDependencies`가 설치된 사실로 `problem`과 `dependents`를 다시 채운다. 값을 비교한다.

const EMPTY_MATERIALS: CardSubject["materials"] = {
  instructions: [],
  skills: [],
  mcpServers: [],
  agents: [],
  commands: [],
};

function manifestOf(
  name: string,
  declared: Record<string, unknown>,
  version = "1.0.0",
): ExtensionManifest {
  const checked = validateManifest({
    schemaVersion: 2,
    name,
    version,
    purpose: "Keeps the kit",
    ...declared,
  });
  if (checked.manifest === undefined) throw new Error("the test manifest is invalid");
  return checked.manifest;
}

function nodeOf(name: string, version: string, declared: Record<string, unknown>): DependencyNode {
  return { name, version, manifest: manifestOf(name, declared, version) };
}

function cardOf(name: string, declared: Record<string, unknown>): PluginCard {
  return buildPluginCard({
    folder: { name, manifest: manifestOf(name, declared), materials: EMPTY_MATERIALS },
    origin: { kind: "user" },
    review: { state: "pending", currentHash: null, pendingItemId: "itm_1", approvedAt: null },
    usedBy: [],
    health: { state: "idle", lastActiveAt: null, lastError: null },
  });
}

/** `app`는 root에서 `kit`(hard, ^1.0.0)과 `ghost`(soft)에, 구성원 `ui`에서 `kit/core`(soft)에 기댄다 */
const APP = {
  orchestration: {},
  plugins: [
    {
      layer: "plugin",
      hooks: [],
      dependsOn: [{ plugin: "kit", kind: "hard", range: "^1.0.0" }, { plugin: "ghost" }],
    },
    { id: "ui", layer: "plugin", hooks: [], dependsOn: [{ plugin: "kit/core" }] },
  ],
};

/** 설치된 `kit`은 root만 있고 `tool`은 `app`에 hard로 기댄다 */
function installed(kitVersion: string): DependencyNode[] {
  return [
    nodeOf("kit", kitVersion, { plugins: [{ layer: "plugin", hooks: [] }] }),
    nodeOf("tool", "1.0.0", {
      plugins: [{ layer: "plugin", hooks: [], dependsOn: [{ plugin: "app", kind: "hard" }] }],
    }),
  ];
}

test("a new card carries its dependsOn lines in declaration order, with no problem and no dependents", () => {
  expect(cardOf("app", APP).dependencies).toEqual({
    dependsOn: [
      { from: "app", target: "kit", kind: "hard", range: "^1.0.0", problem: null },
      { from: "app", target: "ghost", kind: "soft", range: null, problem: null },
      { from: "app/ui", target: "kit/core", kind: "soft", range: null, problem: null },
    ],
    dependents: [],
  });
});

test("a plugin without dependsOn carries an empty dependsOn cell", () => {
  expect(cardOf("plain", {}).dependencies).toEqual({ dependsOn: [], dependents: [] });
});

test("the installed facts judge each dependsOn line and list the installed plugins that depend on this one", () => {
  const card = withInstalledDependencies(cardOf("app", APP), installed("1.2.0"));
  expect(card.dependencies).toEqual({
    dependsOn: [
      // 1.2.0은 ^1.0.0을 만족하므로 문제가 없다
      { from: "app", target: "kit", kind: "hard", range: "^1.0.0", problem: null },
      { from: "app", target: "ghost", kind: "soft", range: null, problem: "target_missing" },
      // `kit`에 구성원 `core`가 없다
      { from: "app/ui", target: "kit/core", kind: "soft", range: null, problem: "member_missing" },
    ],
    dependents: [{ from: "tool", target: "app", kind: "hard", range: null, problem: null }],
  });
});

test("a dependsOn whose installed version is outside the range is range_unmet", () => {
  const card = withInstalledDependencies(cardOf("app", APP), installed("2.0.0"));
  expect(card.dependencies?.dependsOn.map((line) => line.problem)).toEqual([
    "range_unmet",
    "target_missing",
    "member_missing",
  ]);
});

test("with nothing installed every dependsOn is target_missing and nothing depends on the plugin", () => {
  const card = withInstalledDependencies(cardOf("app", APP), []);
  expect(card.dependencies).toEqual({
    dependsOn: [
      { from: "app", target: "kit", kind: "hard", range: "^1.0.0", problem: "target_missing" },
      { from: "app", target: "ghost", kind: "soft", range: null, problem: "target_missing" },
      { from: "app/ui", target: "kit/core", kind: "soft", range: null, problem: "target_missing" },
    ],
    dependents: [],
  });
});

test("the plugin itself is left out of the installed set, so its own lines are not dependents", () => {
  const self = nodeOf("app", "1.0.0", APP);
  const card = withInstalledDependencies(cardOf("app", APP), [self, ...installed("1.2.0")]);
  expect(card.dependencies?.dependents).toEqual([
    { from: "tool", target: "app", kind: "hard", range: null, problem: null },
  ]);
});

test("a card from before the dependency cell existed is returned unchanged", () => {
  const withCell = cardOf("app", APP);
  const { dependencies, ...legacy } = withCell;
  expect(dependencies).toBeDefined();
  expect(withInstalledDependencies(legacy, installed("1.2.0"))).toEqual(legacy);
});
