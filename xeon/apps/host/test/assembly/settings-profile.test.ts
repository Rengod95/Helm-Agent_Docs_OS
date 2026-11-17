import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import type { SessionSettingsStore } from "@fresnel/contracts/records";
import { resolveSetting, type ScopeStack } from "@fresnel/contracts/settings";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine, type SettingsEngine } from "../../src/assembly/settings-engine.ts";

// M5c §3.3, §4.1.7 시험: `profile` 범위 층의 우선순위. 값은 `l1.tools.permissionMode`(허용 범위에 user, project, local, launch, profile이 모두 있다)로 본다.
// 프로필 층은 엔진에 `bindProfiles`로 연결된 값이고, 대화가 없는 조회에는 없다.

const KEY = "l1.tools.permissionMode";
const WORKSPACE = "/work/project";

function engineOver(): SettingsEngine {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  return createSettingsEngine(built.catalog);
}

const THREAD = fixedIdFactory().next("thr");

function sessionWith(values: ReadonlyMap<string, unknown>): SessionSettingsStore {
  return {
    layer: () => ({ scope: "launch", values }),
    set: () => {
      throw new Bug("not used");
    },
    reset: () => {
      throw new Bug("not used");
    },
  };
}

test("the profile value beats the user, project and local values of the thread's folder", async () => {
  const settings = engineOver();
  settings.replaceUserValues(new Map([[KEY, "acceptEdits"]]));
  settings.setWorkspaceFiles(WORKSPACE, {
    project: new Map([[KEY, "default"]]),
    projectPath: `${WORKSPACE}/.fresnel/settings.json`,
    local: new Map([[KEY, "default"]]),
    localPath: `${WORKSPACE}/.fresnel/settings.local.json`,
  });
  settings.bindWorkspaces((threadId) => (threadId === THREAD ? WORKSPACE : undefined));
  settings.bindProfiles((threadId) =>
    threadId === THREAD ? new Map([[KEY, "bypass"]]) : undefined,
  );
  expect(settings.value(KEY, THREAD)).toBe("bypass");
  expect(settings.layers(THREAD).map((layer) => layer.scope)).toEqual([
    "user",
    "project",
    "local",
    "profile",
  ]);
  // 대화 밖 조회(기본 값)는 프로필을 보지 않는다: 사용자 파일 값이다
  expect(settings.value(KEY)).toBe("acceptEdits");
});

test("the launch (session) value still beats the profile, and the profile beats the user file alone", () => {
  const settings = engineOver();
  settings.replaceUserValues(new Map([[KEY, "acceptEdits"]]));
  settings.bindProfiles(() => new Map([[KEY, "bypass"]]));
  expect(settings.value(KEY, THREAD)).toBe("bypass");
  settings.bindSession(sessionWith(new Map([[KEY, "default"]])));
  expect(settings.value(KEY, THREAD)).toBe("default");
  expect(settings.layers(THREAD).map((layer) => layer.scope)).toEqual([
    "user",
    "profile",
    "launch",
  ]);
});

test("a profile that does not set the key falls back to the lower layers, and a thread with no profile does too", () => {
  const settings = engineOver();
  settings.replaceUserValues(new Map([[KEY, "acceptEdits"]]));
  settings.bindProfiles((threadId) => (threadId === THREAD ? new Map() : undefined));
  expect(settings.value(KEY, THREAD)).toBe("acceptEdits");
  const other = fixedIdFactory(7).next("thr");
  expect(settings.value(KEY, other)).toBe("acceptEdits");
  expect(settings.layers(other).map((layer) => layer.scope)).toEqual(["user"]);
});

test("the managed lock wins over the profile: the precedence order puts managed above profile", () => {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const def = built.catalog.get(KEY);
  if (def === undefined) throw new Error("the permission mode key must be in the catalog");
  const stack: ScopeStack = [
    { scope: "profile", values: new Map([[KEY, "bypass"]]) },
    { scope: "managed", values: new Map([[KEY, "default"]]) },
  ];
  const { setting } = resolveSetting(def, stack);
  expect(setting.value).toBe("default");
  expect(setting.source.scope).toBe("managed");
  expect(setting.locked).toBe(true);
});
