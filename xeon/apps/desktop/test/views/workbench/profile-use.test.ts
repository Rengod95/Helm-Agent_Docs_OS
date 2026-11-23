import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { Profile } from "@fresnel/contracts/wire";
import {
  inProfile,
  profileSetOf,
  profileUseOf,
  profileUseText,
  withPlugin,
} from "../../../src/views/workbench/profile-use.ts";

// "쓰는 곳"과 "프로필에 넣기"의 순수 모델(AGE-74, AGE-76 plugMin). 켜고 끔은 프로필에 넣고 빼는 것뿐이다.

function profile(id: string, plugins: readonly string[], over: Partial<Profile> = {}): Profile {
  return {
    id,
    title: id,
    builtin: false,
    plugins: plugins.map((name) => ({ name })),
    settings: [],
    startDrive: null,
    updatedAt: "2026-11-23T00:00:00.000Z",
    rev: 3,
    ...over,
  };
}

const SET = profileSetOf({
  profiles: [
    profile("default", ["helm", "web"]),
    profile("writing", ["web"]),
    profile("system", ["web"], { hidden: true }),
  ],
  common: {
    plugins: [{ name: "guard" }],
    settings: [],
    updatedAt: "2026-11-23T00:00:00.000Z",
    rev: 1,
  },
  rev: 9,
});

describe("profileSetOf", () => {
  test("숨은 프로필은 빼고, 공통 묶음은 이름만 남긴다", () => {
    expect(SET.profiles.map((p) => p.id)).toEqual(["default", "writing"]);
    expect(SET.common).toEqual(["guard"]);
  });
});

describe("쓰는 곳", () => {
  test("넣은 프로필 수를 세고, 없으면 어느 프로필에도 없음이다", () => {
    expect(profileUseOf("web", false, SET)).toEqual({ kind: "profiles", count: 2 });
    expect(profileUseOf("helm", false, SET)).toEqual({ kind: "profiles", count: 1 });
    expect(profileUseOf("notes", false, SET)).toEqual({ kind: "none" });
  });

  test("앱 핵심과 공통 묶음의 플러그인은 모든 대화다", () => {
    expect(profileUseOf("core-loop", true, SET)).toEqual({ kind: "all" });
    expect(profileUseOf("guard", false, SET)).toEqual({ kind: "all" });
  });

  test("글은 카탈로그 문장이다", () => {
    expect(profileUseText({ kind: "profiles", count: 2 })).toBe("프로필 2개");
    expect(profileUseText({ kind: "none" })).toBe(t("desktop.workbench.use.none"));
    expect(profileUseText({ kind: "all" })).toBe("모든 대화");
  });
});

describe("프로필에 넣기의 저장 값", () => {
  test("끝에 넣고 이름, 설정, 시작 Drive는 그대로 둔다", () => {
    const writing = profile("writing", ["web"], {
      title: "글쓰기",
      settings: [{ key: "ext.web.model", value: "fast" }],
      startDrive: "web",
    });
    expect(withPlugin(writing, "helm")).toEqual({
      id: "writing",
      title: "글쓰기",
      plugins: [{ name: "web" }, { name: "helm" }],
      settings: [{ key: "ext.web.model", value: "fast" }],
      startDrive: "web",
    });
  });

  test("이미 있으면 목록을 바꾸지 않는다", () => {
    const base = profile("default", ["helm", "web"]);
    expect(withPlugin(base, "web").plugins).toEqual([{ name: "helm" }, { name: "web" }]);
    expect(inProfile(base, "web")).toBe(true);
    expect(inProfile(base, "notes")).toBe(false);
  });
});
