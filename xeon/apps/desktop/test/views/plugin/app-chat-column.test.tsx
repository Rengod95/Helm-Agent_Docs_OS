import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { AppChatColumn, recentThreadOf } from "../../../src/views/plugin/app-chat-column.tsx";
import { inContexts, liveEngine, screenStore } from "../workbench/support.tsx";

// 앱 옆 대화 열: 처음 열 대화를 고르는 순수 판정과, 머리 줄 단추의 이름(서버 렌더)을 값으로 본다.

describe("recentThreadOf: 처음 열 대화", () => {
  test("열린 대화가 있으면 아무것도 고르지 않는다", () => {
    expect(recentThreadOf("thr-open", [{ id: "thr-recent" }])).toEqual(undefined);
  });

  test("열린 대화가 없고 목록이 있으면 첫 대화(최근 활동 먼저)를 고른다", () => {
    expect(recentThreadOf(null, [{ id: "thr-recent" }, { id: "thr-older" }])).toEqual("thr-recent");
  });

  test("열린 대화도 목록도 없으면 아무것도 고르지 않는다", () => {
    expect(recentThreadOf(null, [])).toEqual(undefined);
  });
});

describe("AppChatColumn: 머리 줄 단추 이름(대화가 없을 때)", () => {
  const html = renderToStaticMarkup(
    inContexts(<AppChatColumn onClose={() => {}} />, screenStore(), liveEngine()),
  );

  test("열 자체와 바꾸기, 크게 보기, 닫기 단추의 이름을 그린다", () => {
    const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1] ?? "");
    expect(labels).toEqual([
      t("desktop.apps.chat.toggle"),
      t("desktop.apps.chat.switch"),
      t("desktop.apps.chat.expand"),
      t("desktop.apps.chat.close"),
    ]);
  });

  test("대화가 없으면 빈 상태 글을 보이고 제목 칸은 '새 대화'다", () => {
    expect(html).toContain(t("desktop.apps.chat.none"));
    expect(html).toContain(t("desktop.apps.chat.untitled"));
  });
});
