import { describe, expect, test } from "bun:test";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { pendingCountShownOf, pendingReadsOf } from "../../src/views/proposal-pending.ts";
import {
  screenShownOf,
  suggestStateOf,
  SUGGEST_PLUGIN_NAME,
} from "../../src/views/proposal-suggest.ts";
import { bannerSourcesOf } from "../../src/views/pages/proposals/proposals-text.ts";

// 제안은 `suggest` 플러그인이 켜져 있을 때만 있다. 켜짐 판정, 내비와 팔레트의 화면 거르기, 꺼진 때 대기 수 읽기 멈춤, 학습 띠 없음을 본다.

type Row = Pick<ExtListEntry, "name" | "status" | "safeModeExcluded">;

/** `ext.list` 행 모양의 일부(판정이 쓰는 필드만). 값을 그대로 적는다 */
function row(
  name: string,
  status: Row["status"],
  safeModeExcluded: Row["safeModeExcluded"] = null,
): Row {
  return { name, status, safeModeExcluded };
}

describe("suggest plugin state (ext.list)", () => {
  test("the plugin is named suggest", () => {
    expect(SUGGEST_PLUGIN_NAME).toEqual("suggest");
  });

  test("before the first read, or without a link, the state is unknown", () => {
    expect(suggestStateOf(undefined)).toEqual("unknown");
  });

  test("an enabled or enabling suggest is on", () => {
    expect(suggestStateOf([row("suggest", "enabled")])).toEqual("on");
    expect(suggestStateOf([row("suggest", "enabling")])).toEqual("on");
  });

  test("a disabled or disabling suggest is off", () => {
    expect(suggestStateOf([row("suggest", "disabled")])).toEqual("off");
    expect(suggestStateOf([row("suggest", "disabling")])).toEqual("off");
  });

  test("a suggest left out of the profile or not installed (no row) is off", () => {
    expect(suggestStateOf([])).toEqual("off");
    expect(suggestStateOf([row("plugin-other", "enabled")])).toEqual("off");
  });

  test("an enabled suggest excluded by safe mode is off", () => {
    expect(suggestStateOf([row("suggest", "enabled", "safe mode")])).toEqual("off");
  });

  test("the other plugins do not decide the state", () => {
    expect(suggestStateOf([row("plugin-other", "enabled"), row("suggest", "disabled")])).toEqual(
      "off",
    );
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
