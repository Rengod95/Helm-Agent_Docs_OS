import { describe, expect, test } from "bun:test";
import { appRowsOf } from "../../../src/views/craft/review/review-app-rows.ts";

// 리뷰 상세 "앱" 줄의 값. 전체 화면(page)과 대화 옆 패널(panel)만 받은 순서대로 남긴다.

describe("app rows of a review item", () => {
  test("a page app keeps its reason and bridge capabilities", () => {
    expect(
      appRowsOf([
        {
          id: "notes",
          placement: "page",
          mode: "app",
          reason: "지도를 자체 코드로 그린다",
          capabilities: ["files", "notify"],
        },
      ]),
    ).toEqual([
      {
        id: "notes",
        where: "page",
        mode: "app",
        reason: "지도를 자체 코드로 그린다",
        capabilities: ["files", "notify"],
      },
    ]);
  });

  test("a native panel drops its reason and capabilities", () => {
    expect(
      appRowsOf([
        {
          id: "side",
          placement: "panel",
          mode: "native",
          reason: "무시되는 까닭",
          capabilities: ["secrets"],
        },
      ]),
    ).toEqual([{ id: "side", where: "panel", mode: "native", reason: null, capabilities: [] }]);
  });

  test("card and status screens are left out and the rest keep their order", () => {
    expect(
      appRowsOf([
        { id: "kind", placement: "card", mode: "native", reason: null, capabilities: [] },
        { id: "later", placement: "page", mode: "native", reason: null, capabilities: [] },
        { id: "badge", placement: "status", mode: "native", reason: null, capabilities: [] },
        {
          id: "first",
          placement: "panel",
          mode: "app",
          reason: "자체 패널",
          capabilities: [],
        },
      ]),
    ).toEqual([
      { id: "later", where: "page", mode: "native", reason: null, capabilities: [] },
      { id: "first", where: "panel", mode: "app", reason: "자체 패널", capabilities: [] },
    ]);
  });

  test("a blank reason becomes null", () => {
    expect(
      appRowsOf([{ id: "blank", placement: "page", mode: "app", reason: "   ", capabilities: [] }]),
    ).toEqual([{ id: "blank", where: "page", mode: "app", reason: null, capabilities: [] }]);
  });

  test("an old card without a mode keeps mode null and no reason", () => {
    expect(
      appRowsOf([{ id: "old", placement: "page", mode: null, reason: null, capabilities: [] }]),
    ).toEqual([{ id: "old", where: "page", mode: null, reason: null, capabilities: [] }]);
  });
});
