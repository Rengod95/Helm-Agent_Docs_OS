import { describe, expect, test } from "bun:test";
import { builderOf, forwardStateOf } from "../../../src/views/workbench/builder-state.ts";
import { builderSentenceOf } from "../../../src/views/workbench/builder-entry.tsx";
import { entry } from "./support.tsx";

// "새로 만들기" 입구: 플러그인 빌더 상태마다 문장이 다르고, 어느 상태에도 문장이 빈 채로 지나가지 않는다.

const AUTHORING = "authoring";
const sentence = (status: "enabled" | "disabled" | null, link: "live" | "offline") =>
  builderSentenceOf(
    forwardStateOf(link, status === null ? null : builderOf(entry(AUTHORING, { status }))),
  );

describe("builderSentenceOf", () => {
  test("꺼져 있으면 꺼져 있다는 문장, 켜져 있으면 대화를 열라는 문장", () => {
    expect(sentence("disabled", "live")).toBe(
      "플러그인 빌더가 꺼져 있어요. 켜면 새 대화에서 플러그인을 만들 수 있어요",
    );
    expect(sentence("enabled", "live")).toBe(
      "플러그인 빌더가 켜져 있어요. 새 대화를 열어 만들 플러그인을 말해 주세요",
    );
  });

  test("목록에 없거나 연결이 없으면 각자 까닭을 말한다", () => {
    expect(sentence(null, "live")).toBe("확장 목록에 플러그인 빌더가 없어서 켤 수 없어요");
    expect(sentence("disabled", "offline")).toBe("엔진에 연결되면 만들 수 있어요");
  });
});

// 옛 구성 화면 코드 보기의 시험에서 옮김(AGE-69): 플러그인 빌더 상태마다 입구의 모양
const BUILDER_ON = { status: "enabled", lock: null } as const;
const BUILDER_OFF = { status: "disabled", lock: null } as const;

describe("forwardStateOf", () => {
  test("엔진에 연결되어 있지 않으면 어느 상태든 문장만이다", () => {
    expect(forwardStateOf("offline", BUILDER_ON)).toEqual({ kind: "offline" });
    expect(forwardStateOf("pending", BUILDER_OFF)).toEqual({ kind: "offline" });
  });

  test("연결되어 있고 플러그인 빌더가 켜져 있으면 만들기다", () => {
    expect(forwardStateOf("live", BUILDER_ON)).toEqual({ kind: "make" });
  });

  test("잠겨 있어도 이미 켜져 있으면 만들기다(만들기는 켜기·끄기를 바꾸지 않는다)", () => {
    expect(forwardStateOf("live", { status: "enabled", lock: "safe_mode" })).toEqual({
      kind: "make",
    });
  });

  test("꺼져 있거나 켜는 중이면 켜기다", () => {
    expect(forwardStateOf("live", BUILDER_OFF)).toEqual({ kind: "enable" });
    expect(forwardStateOf("live", { status: "enabling", lock: null })).toEqual({ kind: "enable" });
  });

  test("목록에 플러그인 빌더가 없으면 켤 수 없다", () => {
    expect(forwardStateOf("live", null)).toEqual({ kind: "missing" });
  });

  test("꺼져 있는데 잠겨 있으면 잠긴 까닭을 든 상태다", () => {
    expect(forwardStateOf("live", { status: "disabled", lock: "safe_mode" })).toEqual({
      kind: "locked",
      lock: "safe_mode",
    });
  });
});
