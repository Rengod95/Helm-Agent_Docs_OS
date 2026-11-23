import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import {
  checkUiTreeActions,
  validateUiTree,
  type ExtensionManifest,
  type UiTreeIssue,
} from "@fresnel/contracts/extensions";
import type { DevkitIssue } from "@fresnel/contracts/services";
import { io } from "./errors.ts";
import { isSafeRelative } from "./shared.ts";

// 선언형 화면 트리 검사(L3.authoring.spec §3.3, ADR-0021 §3.4.1). 로더(X `checkUiDecl`)가 설치 때 보는 것과 같은 F 함수를
// 제작 단계에서 먼저 돌린다: native 화면 파일과 앱 화면의 대체 파일을 읽어 `validateUiTree`로 모양과 크기를,
// `checkUiTreeActions`로 보드(`Board`)와 순서 목록(`SortableList`)이 부르는 쓰기 메서드를 매니페스트 `methods`와 맞춘다.
// 위젯 이름과 prop의 카탈로그 검사는 L4 렌더러의 일이라 여기서 보지 않는다.

/** 확장 폴더 기준 경로에서 앞의 `./`를 뗀다 */
function relativeOf(path: string): string {
  return path.replace(/^\.\//, "");
}

function treeIssueOf(at: string, file: string, found: UiTreeIssue): DevkitIssue {
  return {
    severity: "error",
    code: found.code === "ui_limit" ? "native_tree_limit" : "native_tree_invalid",
    path: found.path === "" ? at : `${at}#${found.path}`,
    message: `${file}: ${found.message}`,
    file,
  };
}

/** 화면 트리 파일 하나. 경로가 안전하지 않은 것은 F `validateUi`가 `ui_path_invalid`로 이미 알렸으므로 건너뛴다 */
async function treeFileIssues(
  dir: string,
  declared: string,
  at: string,
  manifest: ExtensionManifest,
): Promise<readonly DevkitIssue[]> {
  const file = relativeOf(declared);
  if (!isSafeRelative(file)) return [];
  const text = await io(file, () => readFile(join(dir, file), "utf8"));
  if (!text.ok)
    return [
      {
        severity: "error",
        code: "native_file_missing",
        path: at,
        message: `${declared} cannot be read from the extension folder: create the view tree JSON there, or fix the path`,
        file,
      },
    ];
  const json = parseJson(text.value.startsWith("﻿") ? text.value.slice(1) : text.value);
  if (!json.ok)
    return [
      {
        severity: "error",
        code: "native_tree_invalid",
        path: at,
        message: `${declared} is not valid JSON: write one view tree object ({ "type": ..., "children": [...] })`,
        file,
      },
    ];
  const checked = validateUiTree(json.value);
  if (!checked.ok) return checked.issues.map((found) => treeIssueOf(at, file, found));
  const methods = (manifest.methods ?? []).map((method) => ({
    verb: method.verb,
    readOnly: method.readOnly,
  }));
  return checkUiTreeActions(checked.tree, methods).map((found) => treeIssueOf(at, file, found));
}

/** 매니페스트의 native 화면 파일(`file`)과 앱 화면의 대체 파일(`fallback`)을 모두 본다 */
export async function nativeViewIssues(
  dir: string,
  manifest: ExtensionManifest,
): Promise<readonly DevkitIssue[]> {
  const items = manifest.ui?.items ?? [];
  const perItem = await Promise.all(
    items.map(async (item, index) => {
      const found: DevkitIssue[] = [];
      if (item.file !== undefined)
        found.push(...(await treeFileIssues(dir, item.file, `/ui/items/${index}/file`, manifest)));
      if (item.fallback !== undefined)
        found.push(
          ...(await treeFileIssues(dir, item.fallback, `/ui/items/${index}/fallback`, manifest)),
        );
      return found;
    }),
  );
  return perItem.flat();
}
