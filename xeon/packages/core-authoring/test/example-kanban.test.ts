// 저장소 예제 `examples/kanban`이 제작 검사(`validateExtensionDir`, 앱 화면 검사 포함)를 통과하는지 본다.
// 시험 대상이 디스크의 본보기 폴더이므로 이 파일은 읽기만 한다.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { validateExtensionDir } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "examples", "kanban");

test("the kanban example passes the authoring check: no errors, no warnings, and only the fallback hint", async () => {
  const checked = await validateExtensionDir(ROOT);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(checked.value.ok).toBe(true);
  // 대체 화면이 위젯 트리이므로 검사가 선언형 방식을 권하는 안내(info) 하나만 남는다. viewdemo도 같은 안내를 받는다
  expect(checked.value.issues.filter((issue) => issue.severity !== "info")).toEqual([]);
  expect(checked.value.issues.map((issue) => issue.code)).toEqual(["AU-008"]);
});
