import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";

test("the live connection popover body is the mock sentence", () => {
  expect(t("desktop.status.cell.link.live")).toBe("엔진과 실시간으로 연결되어 있어요.");
});
