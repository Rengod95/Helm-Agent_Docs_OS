import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createDesktopRegistry } from "../../src/views/desktop-registry.tsx";
import { ProposalPendingContext } from "../../src/views/proposal-pending-context.tsx";
import type { ScreenDef } from "../../src/views/shell/registry.ts";

// 사이드바 "제안" 항목의 배지는 대기 제안 수를 `render`로 넘긴다(시험은 문맥의 수가 그대로 간다는 것만 본다).
// 0을 숨기는 일은 내비 줄(`start-panel.tsx`의 NavRow)이 맡는다.

type BadgeComponent = NonNullable<ScreenDef["Badge"]>;

function badgeHtml(Badge: BadgeComponent, count: number): string {
  return renderToString(
    <ProposalPendingContext value={{ count, refresh: () => {} }}>
      <Badge render={(value) => <span>{value === undefined ? "none" : String(value)}</span>} />
    </ProposalPendingContext>,
  );
}

test("the proposals nav item passes the pending proposal count to its badge", () => {
  const Badge = createDesktopRegistry().screen("proposals")?.Badge;
  if (Badge === undefined) throw new Error("the proposals screen has no badge");
  expect(badgeHtml(Badge, 3)).toEqual("<span>3</span>");
  expect(badgeHtml(Badge, 0)).toEqual("<span>0</span>");
});
