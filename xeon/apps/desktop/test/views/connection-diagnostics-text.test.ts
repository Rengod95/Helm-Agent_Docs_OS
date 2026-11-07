import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";

test("the connection screen names its diagnostics button as the mock does", () => {
  expect(t("desktop.connection.status.copyDiagnostics")).toBe("진단 복사");
  expect(t("desktop.connection.status.copied")).toBe("복사했어요");
});
