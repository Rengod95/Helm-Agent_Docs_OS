import { describe, expect, test } from "bun:test";
import { builderOf, forwardStateOf } from "../../../src/views/compose/compose-code.tsx";
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
