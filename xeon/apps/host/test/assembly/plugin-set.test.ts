import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { HOOK_UNIT_NAME_PREFIX } from "@fresnel/contracts/extensions";
import type { CommonSet, Profile, ProfileSetting } from "@fresnel/contracts/wire";
import type {
  FailureStats,
  OperationsNotifier,
  RegistrationToggleSourceOf,
} from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { ProfileTestRunPort } from "../../src/handlers/m4/profile-test-run.ts";
import {
  createPluginSet,
  observeStops,
  type PluginLifecycle,
  type PluginSetDeps,
  type PluginSetHandle,
} from "../../src/assembly/m4/plugin-set.ts";
import type { ProfilesWritten } from "../../src/assembly/m4/profile-store.ts";

// M5c §4.1 시험. E(T)의 구성, 출처, 정지, 설정 층, 참조 세기를 값으로 비교한다.
// 프로필 목록은 시험 저장소가 쥐고, 쓰기는 `write`가 `onProfilesWritten` 구독자에게 알린다.

const THREAD = fixedIdFactory().next("thr");
const OTHER = fixedIdFactory(40).next("thr");
const NO_SETTINGS: readonly ProfileSetting[] = [];

function profileOf(
  id: string,
  plugins: readonly string[],
  settings: readonly ProfileSetting[] = NO_SETTINGS,
  rev = 1,
): Profile {
  return {
    id,
    title: id,
    builtin: id === "default",
    plugins: plugins.map((name) => ({ name })),
    settings: [...settings],
    startDrive: null,
    updatedAt: "2026-11-18T00:00:00.000Z",
    rev,
  };
}

function commonOf(
  plugins: readonly string[],
  settings: readonly ProfileSetting[] = NO_SETTINGS,
  rev = 1,
): CommonSet {
  return {
    plugins: plugins.map((name) => ({ name })),
    settings: [...settings],
    updatedAt: "2026-11-18T00:00:00.000Z",
    rev,
  };
}

/** 프로필 저장소 대역. `write`는 저장한 뒤 구독자에게 알린다(실제 저장소의 순서와 같다). `failRead`면 읽기가 실패한다 */
function fakeProfiles(initial: { profiles: readonly Profile[]; common: CommonSet }) {
  let stored: { profiles: readonly Profile[]; common: CommonSet } = initial;
  let listeners: ((written: ProfilesWritten) => void)[] = [];
  const state = { failRead: false };
  const port: Pick<ProfileTestRunPort, "list" | "onProfilesWritten"> = {
    list: () =>
      Promise.resolve(
        state.failRead
          ? err({ kind: "io" as const, path: "profiles.json", code: "EIO" })
          : ok({ profiles: stored.profiles, common: stored.common, rev: 1 }),
      ),
    onProfilesWritten(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
  };
  return {
    port,
    write(next: { profiles: readonly Profile[]; common: CommonSet }): void {
      stored = next;
      for (const listener of listeners) listener(next);
    },
    listenerCount: () => listeners.length,
    state,
  };
}

/** 쓰인 비동기 호출(`detach`의 실패 처리)이 끝날 때까지 한 매크로태스크 기다린다 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Harness {
  readonly set: PluginSetHandle;
  readonly profiles: ReturnType<typeof fakeProfiles>;
  readonly requested: ThreadId[];
  readonly settingsEvents: { keys: readonly string[]; threadId: ThreadId }[];
  readonly reports: string[];
  readonly loads: string[];
  readonly unloads: string[];
  readonly open: ThreadId[];
  readonly stopped: Set<string>;
  readonly managed: Set<string>;
  readonly threadProfile: Map<ThreadId, string>;
  forced: string[];
  defaults: string[];
  failLoad: boolean;
  readonly profileReadFails: { value: boolean };
}

function harness(
  options: {
    profiles?: readonly Profile[];
    common?: CommonSet;
    lifecycle?: boolean;
  } = {},
): Harness {
  const profiles = fakeProfiles({
    profiles: options.profiles ?? [],
    common: options.common ?? commonOf([]),
  });
  const requested: ThreadId[] = [];
  const settingsEvents: { keys: readonly string[]; threadId: ThreadId }[] = [];
  const reports: string[] = [];
  const loads: string[] = [];
  const unloads: string[] = [];
  const open: ThreadId[] = [THREAD];
  const stopped = new Set<string>();
  const managed = new Set<string>();
  const threadProfile = new Map<ThreadId, string>();
  const state: { forced: string[]; defaults: string[]; failLoad: boolean } = {
    forced: [],
    defaults: ["helm"],
    failLoad: false,
  };
  const toggles: RegistrationToggleSourceOf = {
    scopes: () => [],
    request: () => undefined,
    requestApply: (threadId) => {
      requested.push(threadId);
    },
    applyNow: () => Promise.resolve(),
  };
  const lifecycle: PluginLifecycle | undefined = options.lifecycle
    ? {
        ensureLoaded: (name) => {
          loads.push(name);
          return state.failLoad
            ? Promise.reject(new Error(`cannot load ${name}`))
            : Promise.resolve();
        },
        unload: (name) => {
          unloads.push(name);
          return Promise.resolve();
        },
      }
    : undefined;
  const deps: PluginSetDeps = {
    profiles: profiles.port,
    threadProfileId: (threadId) => threadProfile.get(threadId) ?? null,
    openThreadIds: () => [...open],
    managedOff: (name) => managed.has(name),
    stopped: (name) => stopped.has(name),
    registrations: () => [],
    loadedHash: () => undefined,
    forcedPlugins: () => state.forced,
    defaultPlugins: () => state.defaults,
    toggles,
    driveFramePlugins: () => [],
    driveFramesChanged: () => () => undefined,
    whenIdle: (_id, fn) => fn(),
    settingsChanged: (change) => {
      settingsEvents.push({ keys: change.keys, threadId: change.threadId });
    },
    ...(lifecycle === undefined ? {} : { lifecycle }),
    report: (message) => {
      reports.push(message);
    },
  };
  return {
    set: createPluginSet(deps),
    profiles,
    requested,
    settingsEvents,
    reports,
    loads,
    unloads,
    open,
    stopped,
    managed,
    threadProfile,
    get forced() {
      return state.forced;
    },
    set forced(value: string[]) {
      state.forced = value;
    },
    get defaults() {
      return state.defaults;
    },
    set defaults(value: string[]) {
      state.defaults = value;
    },
    get failLoad() {
      return state.failLoad;
    },
    set failLoad(value: boolean) {
      state.failLoad = value;
    },
    profileReadFails: {
      get value() {
        return profiles.state.failRead;
      },
      set value(next: boolean) {
        profiles.state.failRead = next;
      },
    },
  };
}

test("E(T) is forced plus common and profile, first kept, minus the managed lock and hook units", async () => {
  const hook = `${HOOK_UNIT_NAME_PREFIX}tool.before`;
  const h = harness({
    profiles: [profileOf("work", ["beta", "gamma", "locked", hook])],
    common: commonOf(["alpha", "beta"]),
  });
  h.forced = ["cap-workspace"];
  h.managed.add("locked");
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["cap-workspace", "alpha", "beta", "gamma"]);
  expect(h.set.port.resolve(THREAD)).toMatchObject({
    profileId: "work",
    profileRev: 1,
    commonRev: 1,
  });
});

test("a stopped plugin leaves every thread's E(T) and comes back only when the stop clears", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha", "beta"])] });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["alpha", "beta"]);

  // 정지되면 대화를 다시 열어도(같은 프로필로 다시 계산해도) 빠진 채다
  h.stopped.add("alpha");
  h.set.recomputeAll();
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["beta"]);
  expect(h.set.sourceOf(THREAD, "alpha")).toBe("none");
  h.open.push(OTHER);
  h.threadProfile.set(OTHER, "work");
  expect(h.set.port.resolve(OTHER).plugins).toEqual(["beta"]);

  // 프로필을 고쳐도 정지는 풀리지 않는다
  h.profiles.write({
    profiles: [profileOf("work", ["alpha", "beta"], NO_SETTINGS, 2)],
    common: commonOf([]),
  });
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["beta"]);

  // 정지가 풀리면(자동 끄기 장부가 비워지면) 다음 맞춤에 다시 든다
  h.stopped.delete("alpha");
  h.set.recomputeAll();
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["alpha", "beta"]);
  expect(h.set.sourceOf(THREAD, "alpha")).toBe("profile");
});

test("sourceOf reports the lock first, then the stop, then core, common, profile and none", async () => {
  const h = harness({
    profiles: [profileOf("work", ["profile-only", "both"])],
    common: commonOf(["common-only", "both"]),
  });
  h.forced = ["core-one"];
  h.managed.add("core-one");
  h.stopped.add("stopped-one");
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  const sources = ["core-one", "common-only", "both", "profile-only", "stopped-one", "absent"].map(
    (name) => [name, h.set.sourceOf(THREAD, name)],
  );
  expect(sources).toEqual([
    ["core-one", "managed"],
    ["common-only", "common"],
    ["both", "common"],
    ["profile-only", "profile"],
    ["stopped-one", "none"],
    ["absent", "none"],
  ]);
  h.managed.clear();
  expect(h.set.sourceOf(THREAD, "core-one")).toBe("core");
});

test("a missing profile reads the default view and says which id was missing", async () => {
  const h = harness({ profiles: [profileOf("default", ["helm"], NO_SETTINGS, 3)] });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "gone");
  expect(h.set.port.resolve(THREAD)).toEqual({
    pluginHashes: [],
    plugins: ["helm"],
    profileId: "default",
    profileRev: 3,
    commonRev: 1,
    missingProfileId: "gone",
  });
});

test("the factory default (not stored) lists the default plugins at the time of the read", async () => {
  const h = harness();
  await h.set.refresh();
  expect(h.set.defaultView()).toEqual({
    pluginHashes: [],
    plugins: ["helm"],
    profileId: "default",
    profileRev: 0,
    commonRev: 1,
  });
  // 확장을 더 찾은 뒤에 읽으면 새 기본 플러그인이 든다(복사하지 않고 묻는다)
  h.defaults = ["helm", "late"];
  expect(h.set.defaultView().plugins).toEqual(["helm", "late"]);
});

test("nothing is requested before the copy loads, and every open thread is asked after it", async () => {
  const h = harness();
  h.open.push(OTHER);
  h.set.recompute(THREAD);
  expect(h.requested).toEqual([]);
  await h.set.refresh();
  expect(h.requested).toEqual([THREAD, OTHER]);
});

test("the plugin set is not readable until the profile copy loads (before that E(T) is every registered extension, drafts included)", async () => {
  const h = harness({ profiles: [profileOf("work", ["beta"])] });
  expect(h.set.readable()).toBe(false);
  await h.set.refresh();
  expect(h.set.readable()).toBe(true);
});

test("a profile write asks every open thread again, and reports only the changed profile setting keys", async () => {
  const h = harness({
    profiles: [profileOf("work", ["alpha"], [{ key: "l1.loop.maxSteps", value: 3 }])],
  });
  h.open.push(OTHER);
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  h.threadProfile.set(OTHER, "other");
  h.requested.length = 0;
  h.profiles.write({
    profiles: [profileOf("work", ["alpha", "beta"], [{ key: "l1.loop.maxSteps", value: 9 }], 2)],
    common: commonOf([]),
  });
  expect(h.requested).toEqual([THREAD, OTHER]);
  expect(h.settingsEvents).toEqual([{ keys: ["l1.loop.maxSteps"], threadId: THREAD }]);
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["alpha", "beta"]);

  // 같은 값으로 다시 쓰면 설정 알림은 없다
  h.settingsEvents.length = 0;
  h.profiles.write({
    profiles: [profileOf("work", ["alpha", "beta"], [{ key: "l1.loop.maxSteps", value: 9 }], 3)],
    common: commonOf([]),
  });
  expect(h.settingsEvents).toEqual([]);
});

test("the profile layer is the common settings under the profile settings, and the last of a repeated key wins", async () => {
  const h = harness({
    profiles: [
      profileOf(
        "work",
        [],
        [
          { key: "l1.loop.maxSteps", value: 1 },
          { key: "l1.loop.maxSteps", value: 5 },
          { key: "l1.tools.permissionMode", value: "default" },
        ],
      ),
    ],
    common: commonOf(
      [],
      [
        { key: "l1.loop.maxSteps", value: 99 },
        { key: "l1.models.default", value: "m" },
      ],
    ),
  });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  expect([...h.set.settingsOf(THREAD)]).toEqual([
    ["l1.loop.maxSteps", 5],
    ["l1.models.default", "m"],
    ["l1.tools.permissionMode", "default"],
  ]);
  // 프로필을 고르지 않은 대화는 기본을 쓰고, 저장하지 않은 기본은 공통 묶음 값만 싣는다(공장 값의 권한 모드는 사용자 파일을 가리지 않는다)
  expect([...h.set.settingsOf(OTHER)]).toEqual([
    ["l1.loop.maxSteps", 99],
    ["l1.models.default", "m"],
  ]);
});

test("a thread with no stored profile uses the default profile's settings", async () => {
  const h = harness({
    profiles: [profileOf("default", [], [{ key: "l1.tools.permissionMode", value: "plan" }], 2)],
  });
  await h.set.refresh();
  expect([...h.set.settingsOf(THREAD)]).toEqual([["l1.tools.permissionMode", "plan"]]);
});

// M5c §4.1.1, §7.6: 옛 대화(`thread.started.profileId`가 없는 것)는 기본 프로필을 참조한다. 이벤트는 다시 쓰지 않는다
test("an old thread with no stored profile id resolves to the default profile and the view names it", async () => {
  const h = harness({ profiles: [profileOf("default", ["helm"], NO_SETTINGS, 3)] });
  await h.set.refresh();
  expect(h.set.port.resolve(THREAD)).toEqual({
    pluginHashes: [],
    plugins: ["helm"],
    profileId: "default",
    profileRev: 3,
    commonRev: 1,
  });
});

test("the lifecycle loads a plugin when its first thread uses it and unloads it when the last one lets go", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha"])], lifecycle: true });
  h.open.push(OTHER);
  h.threadProfile.set(THREAD, "work");
  h.threadProfile.set(OTHER, "work");
  await h.set.refresh();
  // 두 대화가 같은 플러그인을 써도 적재는 한 번이다
  expect(h.loads).toEqual(["alpha"]);
  h.set.forget(THREAD);
  await settle();
  expect(h.unloads).toEqual([]);
  h.set.forget(OTHER);
  await settle();
  expect(h.unloads).toEqual(["alpha"]);
});

test("opening a thread waits for the plugins it uses to load, then asks the engine to apply its set", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha"])], lifecycle: true });
  h.threadProfile.set(THREAD, "work");
  await h.set.refresh();
  h.requested.length = 0;
  h.loads.length = 0;
  await h.set.opened(THREAD);
  // 적재가 끝난 뒤에 적용을 요청한다. 이미 실린 것이면 다시 싣지 않는다
  expect(h.loads).toEqual([]);
  expect(h.requested).toEqual([THREAD]);
  h.set.forget(THREAD);
  await settle();
  expect(h.unloads).toEqual(["alpha"]);
});

test("the startup default set stays loaded when the last thread lets go, other plugins unload", async () => {
  const h = harness({ profiles: [profileOf("work", ["helm", "alpha"])], lifecycle: true });
  h.threadProfile.set(THREAD, "work");
  await h.set.refresh();
  expect(h.loads).toEqual(["helm", "alpha"]);
  h.set.forget(THREAD);
  await settle();
  // helm은 기본 프로필의 플러그인이라 시작 때 실려 있다(시험 기본 집합 ["helm"])
  expect(h.unloads).toEqual(["alpha"]);
});

test("the lifecycle does not count core plugins, and a failed load is reported, not thrown", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha"])], lifecycle: true });
  h.forced = ["core-one"];
  h.failLoad = true;
  h.threadProfile.set(THREAD, "work");
  await h.set.refresh();
  await settle();
  expect(h.loads).toEqual(["alpha"]);
  expect(h.reports).toEqual(["plugin_set.load_failed"]);
});

test("a stop releases the thread's reference, so the last thread to let go unloads the plugin", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha", "beta"])], lifecycle: true });
  h.threadProfile.set(THREAD, "work");
  await h.set.refresh();
  expect(h.loads).toEqual(["alpha", "beta"]);
  h.stopped.add("alpha");
  h.set.recompute(THREAD);
  await settle();
  expect(h.unloads).toEqual(["alpha"]);
});

test("observeStops calls the stop hook when the engine stops an extension, and forwards every call", () => {
  const calls: string[] = [];
  const inner: OperationsNotifier = {
    handlerFailed: () => {
      calls.push("handlerFailed");
    },
    disableUnasked: () => {
      calls.push("disableUnasked");
    },
    autoDisabled: () => {
      calls.push("autoDisabled");
    },
    projectionFailed: (_key, _cause, disabled) => {
      calls.push(`projectionFailed:${String(disabled)}`);
    },
  };
  const notifier = observeStops(inner, () => {
    calls.push("stop");
  });
  const stats: FailureStats = {
    consecutive: 3,
    windowCalls: 3,
    windowFailures: 3,
    totalCalls: 3,
    totalFailures: 3,
  };
  const verdict = { disable: true, rule: "consecutive", stats } as const;
  notifier.autoDisabled("ext:alpha", verdict);
  notifier.projectionFailed("ext:alpha", "projection_failed", false);
  notifier.projectionFailed("ext:alpha", "projection_failed", true);
  notifier.projectionFailed("hook:x", "projection_failed", true);
  notifier.disableUnasked("ext:alpha", verdict);
  // 훅 단위(`hook:`)의 정지는 확장 E(T)와 무관하므로 알리지 않고, 호출은 그대로 넘긴다
  expect(calls).toEqual([
    "autoDisabled",
    "stop",
    "projectionFailed:false",
    "projectionFailed:true",
    "stop",
    "projectionFailed:true",
    "disableUnasked",
  ]);
});

test("dispose unsubscribes from profile writes, so a later write changes nothing", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha"])] });
  await h.set.refresh();
  expect(h.profiles.listenerCount()).toBe(1);
  h.set.dispose();
  expect(h.profiles.listenerCount()).toBe(0);
  h.requested.length = 0;
  h.profiles.write({
    profiles: [profileOf("work", ["beta"], NO_SETTINGS, 2)],
    common: commonOf([]),
  });
  expect(h.requested).toEqual([]);
});

test("a failed profile read keeps the copy loaded before and reports the failure", async () => {
  const h = harness({ profiles: [profileOf("work", ["alpha"])] });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  h.profileReadFails.value = true;
  h.open.length = 0;
  h.open.push(THREAD);
  await h.set.refresh();
  expect(h.reports).toEqual(["plugin_set.profiles_unreadable"]);
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["alpha"]);
});

// M5c §4.8.5: 숨은 `craft` 프로필. 저장 목록에 없어도 해소되고, 공통 묶음과 그 설정을 받지 않는다. 권한 모드는 `default`다.
test("the hidden craft profile resolves to the builder alone, with no common bundle and permission mode default", async () => {
  const h = harness({
    profiles: [profileOf("work", ["beta"], [{ key: "l1.tools.permissionMode", value: "bypass" }])],
    common: commonOf(["alpha"], [{ key: "l1.tools.permissionMode", value: "acceptEdits" }]),
  });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "craft");
  expect(h.set.port.resolve(THREAD)).toMatchObject({
    profileId: "craft",
    profileRev: 0,
    commonRev: 1,
    plugins: ["authoring"],
  });
  expect(h.set.sourceOf(THREAD, "alpha")).toBe("none");
  expect(h.set.settingsOf(THREAD).get("l1.tools.permissionMode")).toBe("default");
  // 공통 묶음을 바꿔도 craft 대화의 집합은 그대로다
  h.profiles.write({
    profiles: [profileOf("work", ["beta"], [{ key: "l1.tools.permissionMode", value: "bypass" }])],
    common: commonOf(["alpha", "gamma"]),
  });
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["authoring"]);
  // 같은 공통 묶음을 받는 일반 대화는 공통 묶음을 본다
  h.threadProfile.set(OTHER, "work");
  h.open.push(OTHER);
  expect(h.set.port.resolve(OTHER).plugins).toEqual(["alpha", "gamma", "beta"]);
});

test("a stored profile named craft is never read: the craft profile stays the builder with its own mode", async () => {
  const h = harness({ profiles: [], common: commonOf(["alpha"]) });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "craft");
  expect(h.set.port.resolve(THREAD).profileId).toBe("craft");
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["authoring"]);
  expect(h.set.sourceOf(THREAD, "alpha")).toBe("none");
  expect(h.set.sourceOf(THREAD, "authoring")).toBe("profile");
});

// AGE-60: 일반 대화에서는 빌더 플러그인도 프로필이 정한다. 프로필에서 빼면 그 대화에 빌더가 없다.
test("a profile without the builder gives a regular conversation no builder, and a profile with it gives one", async () => {
  const h = harness({
    profiles: [profileOf("work", ["beta"]), profileOf("maker", ["authoring", "beta"])],
    common: commonOf([]),
  });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "work");
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["beta"]);
  expect(h.set.sourceOf(THREAD, "authoring")).toBe("none");
  h.threadProfile.set(OTHER, "maker");
  h.open.push(OTHER);
  expect(h.set.port.resolve(OTHER).plugins).toEqual(["authoring", "beta"]);
});

// AGE-60 [결정: 2026-11-19]: 관리 잠금은 테스트 챗에서도 빌더를 뺀다. 이유는 `sourceOf`가 `managed`로 읽힌다.
test("a managed lock removes the builder from a test chat, which opens empty and reads managed", async () => {
  const h = harness({ profiles: [profileOf("work", ["beta"])], common: commonOf(["alpha"]) });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "craft");
  h.managed.add("authoring");
  const view = h.set.port.resolve(THREAD);
  expect(view.plugins).toEqual([]);
  expect(view.pluginHashes).toEqual([]);
  expect(h.set.sourceOf(THREAD, "authoring")).toBe("managed");
  // 잠금이 풀리면 빌더가 돌아온다
  h.managed.clear();
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["authoring"]);
  expect(h.set.sourceOf(THREAD, "authoring")).toBe("profile");
});

// 오류 정지는 테스트 챗의 빌더를 빼지 못한다(다시 싣는다)
test("an error stop keeps the builder in a test chat", async () => {
  const h = harness({ profiles: [profileOf("work", ["beta"])], common: commonOf(["alpha"]) });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "craft");
  h.stopped.add("authoring");
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["authoring"]);
});

// 드래프트·고정 초안은 빌더의 이름을 쓰거나 대신하지 못한다
test("a draft that replaces or takes the builder's name cannot enter a test chat", async () => {
  const h = harness({ profiles: [profileOf("work", ["beta"])], common: commonOf(["alpha"]) });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "craft");
  await h.set.setTestRunDrafts(THREAD, [
    {
      plugin: "ddrf1-authoring",
      draftId: "drf-1",
      contentHash: `sha256:${"a".repeat(64)}`,
      replaces: "authoring",
    },
    {
      plugin: "authoring",
      draftId: "drf-2",
      contentHash: `sha256:${"b".repeat(64)}`,
      replaces: "authoring",
    },
  ]);
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["authoring"]);
  expect(h.set.sourceOf(THREAD, "ddrf1-authoring")).toBe("none");
});

test("a managed lock still removes the builder from a regular conversation", async () => {
  const h = harness({
    profiles: [profileOf("maker", ["authoring", "beta"])],
    common: commonOf([]),
  });
  await h.set.refresh();
  h.threadProfile.set(THREAD, "maker");
  h.managed.add("authoring");
  expect(h.set.port.resolve(THREAD).plugins).toEqual(["beta"]);
});
