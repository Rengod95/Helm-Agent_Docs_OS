import { afterEach, describe, expect, test } from "bun:test";
import { setActiveLocale, t } from "@fresnel/client/i18n";
import { doesLeadOf } from "../src/views/workbench/overview-model.ts";

// "하는 일" 첫 줄(AGE-77 S-09 나): 리뷰가 도구 이름으로 채운 기본 목적은 이름을 빼고, 설명이나 도구 수 글로 바꾼다.

const TWO = ["reading_board_add_item", "reading_board_move_item"];

afterEach(() => {
  setActiveLocale("ko");
});

describe("doesLeadOf", () => {
  test("no purpose means no lead line", () => {
    expect(doesLeadOf({ purpose: null, description: "설명", toolNames: TWO })).toBeNull();
  });

  test("a purpose a person wrote stays as it is", () => {
    expect(
      doesLeadOf({ purpose: "보드 항목을 관리해요", description: null, toolNames: TWO }),
    ).toEqual({ text: "보드 항목을 관리해요", fromDescription: false });
  });

  test("the drafted tool-name purpose becomes a count, never the tool names", () => {
    const drafted = t("desktop.craft.review.purpose.toolMany", {
      count: 2,
      names: TWO.join(", "),
    });
    const lead = doesLeadOf({ purpose: drafted, description: null, toolNames: TWO });
    expect(lead).toEqual({ text: "도구 2개를 모델에 줘요.", fromDescription: false });
    expect(lead?.text.includes("reading_board")).toBe(false);
  });

  test("with a description, the description is the lead line and is not shown again below", () => {
    const drafted = t("desktop.craft.review.purpose.toolMany", {
      count: 2,
      names: TWO.join(", "),
    });
    expect(
      doesLeadOf({
        purpose: drafted,
        description: "리딩 보드 항목을 더하고 옮겨요.",
        toolNames: TWO,
      }),
    ).toEqual({ text: "리딩 보드 항목을 더하고 옮겨요.", fromDescription: true });
  });

  test("a single drafted tool gives the count 1 wording", () => {
    const drafted = t("desktop.craft.review.purpose.toolOne", { name: "reading_board_add_item" });
    expect(
      doesLeadOf({ purpose: drafted, description: null, toolNames: ["reading_board_add_item"] }),
    ).toEqual({ text: "도구 1개를 모델에 줘요.", fromDescription: false });
  });

  test("the English wording counts in the English locale", () => {
    setActiveLocale("en");
    const drafted = t("desktop.craft.review.purpose.toolMany", {
      count: 2,
      names: TWO.join(", "),
    });
    expect(doesLeadOf({ purpose: drafted, description: null, toolNames: TWO })).toEqual({
      text: "Gives the model 2 tools.",
      fromDescription: false,
    });
  });
});
