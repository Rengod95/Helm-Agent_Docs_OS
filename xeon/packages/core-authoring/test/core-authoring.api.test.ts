import { expect, test } from "bun:test";
import { KIND_CATALOG_VERSION } from "@fresnel/contracts/services";
import { KIND_CATALOG, kindEntryOf, locateTemplateDirs, scaffoldExtension } from "../src/index.ts";

// 제작 코어(L1)의 공개 모양. 코어는 플러그인(group-sdk)을 import하지 않고, 이름 규칙은 contracts의 정본을 쓴다.

test("종류 카탈로그는 contracts의 카탈로그 버전을 쓰고 항목을 하나 낸다", () => {
  expect(KIND_CATALOG.map((entry) => entry.id)).toEqual(["single-plugin"]);
  expect(kindEntryOf("single-plugin")?.since).toBe(KIND_CATALOG_VERSION);
  expect(kindEntryOf("none")).toBeUndefined();
});

test("예약된 이름과 형식에 맞지 않는 이름은 뼈대를 만들기 전에 거절한다", async () => {
  const templates = locateTemplateDirs({}, undefined);
  expect(templates).not.toBeNull();
  if (templates === null) return;
  const made = await Promise.all(
    ["core", "Bad_Name"].map((name) =>
      scaffoldExtension(
        { kind: "single-plugin", name, dir: "/nonexistent-core-authoring-test", mode: "drive" },
        { templates },
      ),
    ),
  );
  expect(made.map((result) => result.ok)).toEqual([false, false]);
});
