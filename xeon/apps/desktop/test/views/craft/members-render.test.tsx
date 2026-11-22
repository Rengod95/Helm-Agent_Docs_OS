import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { MemberInfo } from "@fresnel/contracts/services";
import { renderToString } from "react-dom/server";
import type { MembersData, MembersLoad } from "../../../src/views/craft/members/members-source.ts";
import { MembersView, type MembersLayout } from "../../../src/views/craft/members/members-view.tsx";
import { CodeBlocks } from "../../../src/views/compose/compose-code.tsx";

// 구성원 탭(m6Mb)의 정적 마크업. 두 배치에서 순서 번호, 손잡이와 메뉴의 낭독 이름, 잠긴 플러그인의 읽기 전용 표시,
// 바뀐 원본의 "리뷰로 보내기" 알림, 가운뎃점이 없는 것을 값으로 본다. 효과는 돌지 않는다.

function info(id: string, over: Partial<MemberInfo> = {}): MemberInfo {
  return {
    id,
    registrationId: `kit/${id}`,
    title: null,
    layer: "L3",
    hooks: [],
    drives: false,
    defaultEnabled: false,
    blockIds: [],
    injects: [],
    tools: [],
    ...over,
  };
}

const FOUR: readonly MemberInfo[] = [
  info("guard", { title: "Test guard", hooks: ["tool.call.before"] }),
  info("tap", { hooks: ["boundary.settle.after"] }),
  info("lead", { drives: true, blockIds: ["plan"] }),
  info("notes"),
];

function ready(over: Partial<Extract<MembersLoad, { status: "ready" }>> = {}): MembersLoad {
  return {
    status: "ready",
    members: FOUR,
    origin: "source",
    access: { kind: "editable", dir: "/src/kit" },
    matchesReviewed: true,
    pending: null,
    ...over,
  };
}

function dataOf(load: MembersLoad): MembersData {
  return {
    load,
    rootLayer: "L3",
    rootName: "kit",
    blockTitles: new Map([["plan", "Plan steps"]]),
    editedSinceSend: false,
    edit: () => Promise.resolve({ ok: true, kept: [] }),
    send: () => Promise.resolve({ ok: true, itemId: "i1" }),
    openReview: () => undefined,
  };
}

function render(load: MembersLoad, layout: MembersLayout = "list"): string {
  return renderToString(<MembersView data={dataOf(load)} layout={layout} />);
}

function attrs(html: string, name: string): readonly string[] {
  return [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1] ?? "");
}

describe("줄 목록(list)", () => {
  const html = render(ready());
  test("구성원마다 줄 하나가 순서대로 서고, 손잡이와 메뉴가 이름을 읽는다", () => {
    expect(attrs(html, "data-member-row")).toEqual(["guard", "tap", "lead", "notes"]);
    expect(attrs(html, "data-member-handle")).toEqual(["guard", "tap", "lead", "notes"]);
    expect(html).toContain(
      `aria-label="${t("desktop.craft.members.handle", { name: "Test guard" })}"`,
    );
    expect(html).toContain(`aria-label="${t("desktop.craft.members.menu", { name: "lead" })}"`);
  });

  test("하는 일과 블록이 보인다", () => {
    expect(html).toContain(t("desktop.craft.detail.moment.tool.call.before"));
    expect(html).toContain(t("desktop.craft.members.does.drive"));
    expect(html).toContain(t("desktop.craft.members.does.none"));
    expect(html).toContain("Plan steps");
    expect(html).toContain(t("desktop.craft.members.add"));
  });

  test("가운뎃점을 쓰지 않는다(DP-226)", () => {
    expect(html.includes("·")).toBe(false);
  });
});

describe("잠긴 플러그인", () => {
  test("읽기 전용이 보이고 손잡이와 더하기가 없다. 까닭은 정보 아이콘 뒤에 있다", () => {
    const html = render(
      ready({ origin: "installed", access: { kind: "locked", reason: "noSource" } }),
    );
    expect(html).toContain(t("desktop.craft.members.readOnly"));
    expect(html).toContain(t("desktop.craft.members.locked.noSource"));
    expect(attrs(html, "data-member-handle")).toEqual([]);
    expect(html.includes(t("desktop.craft.members.add"))).toBe(false);
  });
});

describe("리뷰와의 관계", () => {
  test("원본이 바뀌었으면 승인 전에는 옛 버전이 돈다고 말하고 리뷰로 보내기를 둔다", () => {
    const html = render(ready({ matchesReviewed: false }));
    expect(attrs(html, "data-review-notice")).toEqual(["members-changed"]);
    expect(html).toContain(t("desktop.craft.members.send.changedBody"));
    expect(html).toContain(t("desktop.craft.members.send"));
  });

  test("원본이 승인본과 같으면 알림이 없다", () => {
    expect(attrs(render(ready()), "data-review-notice")).toEqual([]);
  });
});

describe("목록과 자세히(split)", () => {
  test("왼쪽은 이름 줄, 오른쪽은 첫 구성원의 자세히", () => {
    const html = render(ready(), "split");
    expect(attrs(html, "data-members-layout")).toEqual(["split"]);
    expect(attrs(html, "data-member-row")).toEqual(["guard", "tap", "lead", "notes"]);
    expect(attrs(html, "data-member-detail")).toEqual(["guard"]);
    expect(html).toContain(t("desktop.craft.members.fact.orderValue", { index: 1, count: 4 }));
  });
});

describe("상태", () => {
  test("읽는 중, 실패, 끊김", () => {
    expect(render({ status: "loading" })).toContain('aria-busy="true"');
    expect(render({ status: "failed" })).toContain(t("desktop.craft.members.load.failed"));
    expect(render({ status: "offline" })).toContain(t("desktop.craft.members.load.offline"));
  });
});

describe("구성기의 블록 줄에 구성원 이름(m6Mb)", () => {
  test("구성원의 블록은 구성원 제목이, 제목이 없으면 id가, 뿌리 블록은 아무것도 서지 않는다", () => {
    const html = renderToString(
      <CodeBlocks
        composition={{
          blocks: [
            { id: "plan", stage: "plan", op: "post", plugin: "lead" },
            { id: "watch", stage: "plan", op: "post", plugin: "tap" },
            { id: "root-step", stage: "plan", op: "post" },
          ],
        }}
        members={[
          { id: "lead", title: "Plan lead" },
          { id: "tap", title: null },
        ]}
      />,
    );
    expect(attrs(html, "data-block-member")).toEqual(["lead", "tap"]);
    expect(html).toContain(t("desktop.compose.block.member", { name: "Plan lead" }));
    expect(html).toContain(t("desktop.compose.block.member", { name: "tap" }));
  });
});
