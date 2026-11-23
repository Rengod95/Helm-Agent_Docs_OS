import { describe, expect, test } from "bun:test";
import { forwardStateOf } from "../../../src/views/workbench/builder-state.ts";
import { builderSentenceOf } from "../../../src/views/workbench/builder-entry.tsx";
import { entry } from "./support.tsx";

// "새로 만들기" 입구: 빌더는 크래프트에서 늘 켜 둔 기본 기능이라 켜기 단추가 없다.
// 관리자 잠금(managed)만 입구의 모양을 바꾸고, 어느 상태에도 문장이 빈 채로 지나가지 않는다.

const AUTHORING = "authoring";

describe("forwardStateOf", () => {
  test("엔진에 연결되어 있지 않으면 어느 상태든 문장만이다", () => {
    expect(forwardStateOf("offline", entry(AUTHORING, { status: "enabled" }))).toEqual({
      kind: "offline",
    });
    expect(forwardStateOf("pending", entry(AUTHORING, { status: "disabled" }))).toEqual({
      kind: "offline",
    });
  });

  test("목록에 플러그인 빌더가 없으면 만들 수 없다", () => {
    expect(forwardStateOf("live", undefined)).toEqual({ kind: "missing" });
  });

  test("켜져 있거나 꺼져 있거나 켜는 중이면 만들기다", () => {
    expect(forwardStateOf("live", entry(AUTHORING, { status: "enabled" }))).toEqual({
      kind: "make",
    });
    expect(forwardStateOf("live", entry(AUTHORING, { status: "disabled" }))).toEqual({
      kind: "make",
    });
    expect(forwardStateOf("live", entry(AUTHORING, { status: "enabling" }))).toEqual({
      kind: "make",
    });
  });

  test("관리자 잠금이면 잠긴 상태이고 잠금 값을 든다", () => {
    expect(
      forwardStateOf("live", entry(AUTHORING, { status: "disabled", enabledSource: "managed" })),
    ).toEqual({ kind: "locked", lock: "managed" });
  });

  test("관리자 잠금이 아닌 다른 잠금(필수 플러그인)은 만들기다", () => {
    expect(
      forwardStateOf("live", entry(AUTHORING, { status: "enabled", enabledSource: "core" })),
    ).toEqual({ kind: "make" });
  });
});

describe("builderSentenceOf", () => {
  test("만들 수 있으면 새 대화를 열라는 문장이다", () => {
    expect(builderSentenceOf(forwardStateOf("live", entry(AUTHORING, { status: "enabled" })))).toBe(
      "플러그인 빌더가 켜져 있어요. 새 대화를 열어 만들 플러그인을 말해 주세요",
    );
  });

  test("관리자가 끈 빌더는 관리자가 껐다고 말한다", () => {
    expect(
      builderSentenceOf(
        forwardStateOf("live", entry(AUTHORING, { status: "disabled", enabledSource: "managed" })),
      ),
    ).toBe("관리자가 플러그인 빌더를 꺼 두었어요.");
  });

  test("목록에 없거나 연결이 없으면 각자 까닭을 말한다", () => {
    expect(builderSentenceOf(forwardStateOf("live", undefined))).toBe(
      "플러그인 목록에 플러그인 빌더가 없어서 켤 수 없어요",
    );
    expect(builderSentenceOf(forwardStateOf("offline", entry(AUTHORING)))).toBe(
      "엔진에 연결되면 만들 수 있어요",
    );
  });
});
