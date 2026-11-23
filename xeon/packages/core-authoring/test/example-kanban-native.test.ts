// 저장소 예제 `examples/kanban-native`(같은 칸반을 native 방식으로)가 제작 검사를 통과하는지 본다.
// 선언형 화면 검사(native-check)가 보드와 순서 목록의 메서드를 매니페스트와 맞춰 보므로, 통과는 트리가 선언한 쓰기 메서드만 부른다는 뜻이다.
// 시험 대상이 디스크의 본보기 폴더이므로 이 파일은 읽기만 한다.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isOrchestrationExtension, validateManifest } from "@fresnel/contracts/extensions";
import { validateExtensionDir } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "examples", "kanban-native");

test("the native kanban example passes the authoring check with no issue at all", async () => {
  const checked = await validateExtensionDir(ROOT);
  expect(checked.ok).toBe(true);
  if (!checked.ok) return;
  expect(checked.value.issues).toEqual([]);
  expect(checked.value.ok).toBe(true);
});

test("the native kanban example is a plain plugin with three native views and ownDataOnly write methods", () => {
  const raw: unknown = JSON.parse(
    readFileSync(join(ROOT, ".fresnel-plugin", "plugin.json"), "utf8"),
  );
  const { manifest } = validateManifest(raw);
  expect(manifest).toBeDefined();
  if (manifest === undefined) return;
  expect(isOrchestrationExtension(manifest)).toBe(false);
  expect(
    (manifest.methods ?? []).map((method) => [
      method.verb,
      method.readOnly,
      method.ownDataOnly ?? false,
    ]),
  ).toEqual([
    ["board", true, false],
    ["move", false, true],
    ["add", false, true],
    ["reorder", false, true],
  ]);
  expect(
    (manifest.ui?.items ?? []).map((item) => [item.id, item.placement, item.mode, item.file]),
  ).toEqual([
    ["board", "page", "native", "./ui/native/board.view.json"],
    ["order", "page", "native", "./ui/native/order.view.json"],
    ["side", "panel", "native", "./ui/native/board.view.json"],
  ]);
});
