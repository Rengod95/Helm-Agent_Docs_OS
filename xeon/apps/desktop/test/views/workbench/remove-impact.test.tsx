import { describe, expect, test } from "bun:test";
import type { Placement } from "@fresnel/contracts/extensions";
import { renderToString } from "react-dom/server";
import { pluginViewsOf, profilesUsingOf } from "../../../src/views/workbench/remove-model.ts";
import {
  RemoveDialogBody,
  type ProfilesView,
  type RemoveImpact,
} from "../../../src/views/workbench/remove-dialog.tsx";

// 지우기 확인의 영향 묶음(B-04): 이 확장을 쓰는 프로필과 플러그인 뷰. 판단은 순수 함수로, 그림은 상자 본문의 서버 렌더로 본다.

const PROFILES: readonly {
  readonly title: string;
  readonly enable: readonly string[];
  readonly disable?: readonly string[];
}[] = [
  { title: "조사용", enable: ["taskflow", "exa"] },
  { title: "기본", enable: ["exa"] },
  { title: "끄기만", enable: [], disable: ["taskflow"] },
];

const ENTRIES: readonly {
  readonly extension: string;
  readonly id: string;
  readonly title: string;
  readonly placement: Placement;
}[] = [
  { extension: "taskflow", id: "board", title: "작업 흐름판", placement: "page" },
  { extension: "taskflow", id: "well", title: "흐름판", placement: "panel" },
  { extension: "exa", id: "search", title: "검색", placement: "card" },
  { extension: "taskflow", id: "blank", title: "  ‮ ", placement: "command" },
];

describe("지우기 영향 판단", () => {
  test("쓰는 프로필은 enable에 이름이 있는 것만이고, disable에만 있으면 세지 않는다", () => {
    expect(profilesUsingOf(PROFILES, "taskflow")).toEqual(["조사용"]);
    expect(profilesUsingOf(PROFILES, "exa")).toEqual(["조사용", "기본"]);
    expect(profilesUsingOf(PROFILES, "none")).toEqual([]);
  });

  test("플러그인 뷰는 이 확장의 항목만 항목 순서대로, 제목이 비면 화면 id를 쓴다", () => {
    expect(pluginViewsOf(ENTRIES, "taskflow")).toEqual([
      { id: "board", title: "작업 흐름판", placement: "page" },
      { id: "well", title: "흐름판", placement: "panel" },
      { id: "blank", title: "blank", placement: "command" },
    ]);
    expect(pluginViewsOf(ENTRIES, "none")).toEqual([]);
  });
});

function bodyHtml(impact: RemoveImpact): string {
  return renderToString(
    <RemoveDialogBody
      preview={{ kind: "ready", tables: [] }}
      impact={impact}
      checked={false}
      busy={false}
      dataFailed={false}
      onChecked={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

const READY: ProfilesView = { kind: "ready", titles: ["조사용", "기본"] };

describe("지우기 상자 영향 묶음", () => {
  test("두 줄의 이름을 보이고, 프로필 제목과 뷰 제목·자리를 값으로 보인다", () => {
    const out = bodyHtml({
      profiles: READY,
      views: [
        { id: "board", title: "작업 흐름판", placement: "page" },
        { id: "well", title: "흐름판", placement: "panel" },
      ],
    });
    expect(out).toContain("이 확장을 쓰는 프로필");
    expect(out).toContain("플러그인 뷰");
    expect(out).toContain("조사용, 기본");
    expect(out).toContain("작업 흐름판");
    expect(out).toContain("· 전체 화면");
    expect(out).toContain("흐름판");
    expect(out).toContain("· 옆 패널");
  });

  test("쓰는 프로필과 뷰가 없으면 두 줄 모두 없어요라고 말한다", () => {
    const out = bodyHtml({ profiles: { kind: "ready", titles: [] }, views: [] });
    expect(out).toContain("이 확장을 쓰는 프로필");
    expect(out).toContain("없어요");
    expect(out).not.toContain("조사용");
  });

  test("프로필 목록을 읽는 중이면 불러오는 줄을, 못 읽었으면 실패 한 줄을 보인다", () => {
    const loading = bodyHtml({ profiles: { kind: "loading" }, views: [] });
    expect(loading).toContain("불러오는 중이에요");
    expect(loading).toContain('role="status"');
    const failed = bodyHtml({ profiles: { kind: "failed" }, views: [] });
    expect(failed).toContain("프로필을 읽지 못했어요");
    expect(failed).not.toContain("불러오는 중이에요");
  });

  test("화면 항목을 아직 확인하지 못했으면 뷰 줄은 확인하지 못했어요이고 없어요라고 하지 않는다", () => {
    const out = bodyHtml({ profiles: READY, views: null });
    expect(out).toContain("확인하지 못했어요");
    expect(out).toContain("플러그인 뷰");
    expect(out).toContain("조사용, 기본");
    const none = bodyHtml({ profiles: READY, views: [] });
    expect(none).not.toContain("확인하지 못했어요");
  });
});
