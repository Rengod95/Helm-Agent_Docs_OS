import { describe, expect, test } from "bun:test";
import type { ExtListEntry, Profile } from "@fresnel/contracts/wire";
import { pendingCountShownOf, pendingReadsOf } from "../../src/views/proposal-pending.ts";
import {
  screenShownOf,
  suggestInProfilesOf,
  suggestStateOf,
  tabRowsShownOf,
  SUGGEST_PLUGIN_NAME,
} from "../../src/views/proposal-suggest.ts";
import type { ProfilesRead } from "../../src/views/convo/profile-listing.ts";
import { bannerSourcesOf } from "../../src/views/pages/proposals/proposals-text.ts";

// 제안은 `suggest` 플러그인이 켜져 있을 때만 있다. 켜짐은 두 원천을 합친다: 확장 목록의 등록 상태와, 어느 프로필(전역 공통 묶음 포함)에든 들었는가.
// 켜짐 판정, 내비와 팔레트의 화면 거르기, 꺼진 때 대기 수 읽기 멈춤, 학습 띠 없음을 본다.

type Row = Pick<ExtListEntry, "name" | "status" | "safeModeExcluded">;

/** `ext.list` 행 모양의 일부(판정이 쓰는 필드만). 값을 그대로 적는다 */
function row(
  name: string,
  status: Row["status"],
  safeModeExcluded: Row["safeModeExcluded"] = null,
): Row {
  return { name, status, safeModeExcluded };
}

/** 프로필 한 개의 대역. 판정이 읽는 플러그인 목록만 실제 값으로 채운다 */
function profileWith(id: string, plugins: readonly string[]): Profile {
  return {
    id,
    title: id,
    builtin: id === "default",
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-24T00:00:00.000Z",
    rev: 1,
  };
}

/** 읽기가 끝난 프로필 목록. 공통 묶음의 플러그인을 따로 준다 */
function readyOf(profiles: readonly Profile[], common: readonly string[] = []): ProfilesRead {
  return {
    kind: "ready",
    profiles,
    common: {
      plugins: common.map((name) => ({ name })),
      settings: [],
      updatedAt: "2026-11-24T00:00:00.000Z",
      rev: 1,
    },
  };
}

describe("suggest plugin state (ext.list and profile.list)", () => {
  test("the plugin is named suggest", () => {
    expect(SUGGEST_PLUGIN_NAME).toEqual("suggest");
  });

  test("before the first ext.list read, or without a link, the state is unknown", () => {
    expect(suggestStateOf(undefined, true)).toEqual("unknown");
    expect(suggestStateOf(undefined, false)).toEqual("unknown");
    expect(suggestStateOf(undefined, undefined)).toEqual("unknown");
  });

  test("an enabled suggest held by a profile is on, and an enabling one is still off like the host reads it", () => {
    expect(suggestStateOf([row("suggest", "enabled")], true)).toEqual("on");
    expect(suggestStateOf([row("suggest", "enabling")], true)).toEqual("off");
  });

  test("an enabled suggest that no profile holds is off (taken out of the profile)", () => {
    expect(suggestStateOf([row("suggest", "enabled")], false)).toEqual("off");
  });

  test("an enabled suggest is unknown until the profile list is read", () => {
    expect(suggestStateOf([row("suggest", "enabled")], undefined)).toEqual("unknown");
  });

  test("a disabled or disabling suggest is off, whether or not a profile holds it", () => {
    expect(suggestStateOf([row("suggest", "disabled")], true)).toEqual("off");
    expect(suggestStateOf([row("suggest", "disabling")], false)).toEqual("off");
    expect(suggestStateOf([row("suggest", "disabled")], undefined)).toEqual("off");
  });

  test("a suggest with no row (not installed) is off, whatever the profiles say", () => {
    expect(suggestStateOf([], true)).toEqual("off");
    expect(suggestStateOf([], undefined)).toEqual("off");
    expect(suggestStateOf([row("plugin-other", "enabled")], true)).toEqual("off");
  });

  test("an enabled suggest excluded by safe mode is off", () => {
    expect(suggestStateOf([row("suggest", "enabled", "safe mode")], true)).toEqual("off");
  });

  test("the other plugins do not decide the state", () => {
    expect(
      suggestStateOf([row("plugin-other", "enabled"), row("suggest", "disabled")], true),
    ).toEqual("off");
  });
});

describe("suggest held by a profile (profile.list)", () => {
  test("a profile holding suggest counts, not only the default", () => {
    const read = readyOf([profileWith("default", ["helm"]), profileWith("quiet", ["suggest"])]);
    expect(suggestInProfilesOf(read)).toEqual(true);
  });

  test("the common set holding suggest counts for every profile", () => {
    expect(suggestInProfilesOf(readyOf([profileWith("default", ["helm"])], ["suggest"]))).toEqual(
      true,
    );
  });

  test("no profile and no common set holding suggest is false", () => {
    expect(suggestInProfilesOf(readyOf([profileWith("default", ["helm"])]))).toEqual(false);
    expect(suggestInProfilesOf(readyOf([]))).toEqual(false);
  });

  test("before the profile list is read, or when it could not be read, the answer is unknown", () => {
    expect(suggestInProfilesOf({ kind: "loading" })).toBeUndefined();
    expect(suggestInProfilesOf({ kind: "failed" })).toBeUndefined();
    expect(suggestInProfilesOf({ kind: "offline" })).toBeUndefined();
  });

  test("the table: on needs both the registration and a profile; the unread profile list is unknown", () => {
    const held = suggestInProfilesOf(readyOf([profileWith("default", ["suggest"])]));
    const absent = suggestInProfilesOf(readyOf([profileWith("default", ["helm"])]));
    const unread = suggestInProfilesOf({ kind: "loading" });
    expect(suggestStateOf([row("suggest", "enabled")], held)).toEqual("on");
    expect(suggestStateOf([row("suggest", "enabled")], absent)).toEqual("off");
    expect(suggestStateOf([row("suggest", "disabled")], held)).toEqual("off");
    expect(suggestStateOf([row("suggest", "enabled")], unread)).toEqual("unknown");
  });
});

describe("screen shown by suggest state", () => {
  test("the proposals screen shows only while suggest is on", () => {
    expect(screenShownOf("proposals", "on")).toEqual(true);
    expect(screenShownOf("proposals", "off")).toEqual(false);
    expect(screenShownOf("proposals", "unknown")).toEqual(false);
  });

  test("other screens do not follow suggest", () => {
    expect(screenShownOf("schedules", "off")).toEqual(true);
    expect(screenShownOf("chat", "unknown")).toEqual(true);
  });
});

describe("pending count follows suggest state", () => {
  test("reads happen only while suggest is on", () => {
    expect(pendingReadsOf("on")).toEqual(true);
    expect(pendingReadsOf("off")).toEqual(false);
    expect(pendingReadsOf("unknown")).toEqual(false);
  });

  test("with suggest off the shown count is zero, even with a sample floor", () => {
    expect(pendingCountShownOf("off", 3, 2)).toEqual(0);
  });

  test("with suggest on the shown count is the read count, not below the floor", () => {
    expect(pendingCountShownOf("on", 3, 0)).toEqual(3);
    expect(pendingCountShownOf("on", 1, 4)).toEqual(4);
  });

  test("with the link gone (unknown) the last count stays", () => {
    expect(pendingCountShownOf("unknown", 3, 0)).toEqual(3);
  });
});

describe("learning band", () => {
  test("the learning source has no unavailable band", () => {
    expect(bannerSourcesOf(["learning"])).toEqual([]);
  });

  test("the knowledge source keeps its band, also next to learning", () => {
    expect(bannerSourcesOf(["learning", "knowledge"])).toEqual(["knowledge"]);
    expect(bannerSourcesOf(["knowledge"])).toEqual(["knowledge"]);
  });

  test("nothing unavailable means no band", () => {
    expect(bannerSourcesOf([])).toEqual([]);
  });
});

describe("tabRowsShownOf", () => {
  const rows = [{ name: "suggest" }, { name: "helm" }];
  test("the suggest tab is kept only when the plugin is on", () => {
    expect(tabRowsShownOf(rows, "on")).toEqual(rows);
    expect(tabRowsShownOf(rows, "off")).toEqual([{ name: "helm" }]);
    expect(tabRowsShownOf(rows, "unknown")).toEqual([{ name: "helm" }]);
  });
});
