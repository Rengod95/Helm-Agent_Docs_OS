import { expect, test } from "bun:test";
import { createDesktopRegistry } from "../../src/views/desktop-registry.tsx";
import { NAV_BY_AREA } from "../../src/views/shell/nav.ts";

// 내비 항목마다 등록된 화면이 있어야 한다(없으면 무대에 "이 화면은 아직 없어요"가 뜬다)
test("every chat and workbench nav item opens a registered screen with an icon", () => {
  const registry = createDesktopRegistry();
  const ids = [...NAV_BY_AREA.chat, ...NAV_BY_AREA.workbench].map((item) => item.id);
  expect(ids).toEqual([
    "chat",
    "proposals",
    "schedules",
    "connection",
    "plugins",
    "overview",
    "extensions",
    "tests",
    "metrics",
    "compose",
    "engine",
  ]);
  const missing = ids.filter((id) => registry.screen(id) === undefined);
  expect(missing).toEqual([]);
  const noIcon = ids.filter((id) => registry.screen(id)?.icon === undefined);
  expect(noIcon).toEqual([]);
});
