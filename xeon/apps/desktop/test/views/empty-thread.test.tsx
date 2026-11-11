import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { recentWorkspacesOf } from "../../src/views/new-thread-model.ts";

test("the new-thread screen asks where to work and drops the old prompt and suggestions", () => {
  expect(t("desktop.emptyThread.where.question")).toBe("어디서 작업할까요?");
  expect(t("desktop.emptyThread.where.open")).toBe("폴더 열기…");
  expect(t("desktop.emptyThread.where.none")).toBe("폴더 없이 시작");
  expect(t("desktop.emptyThread.where.hostSsh", { name: "빌드 서버" })).toBe(
    "SSH 빌드 서버에서 실행돼요",
  );
  expect(recentWorkspacesOf([])).toEqual([]);
});
