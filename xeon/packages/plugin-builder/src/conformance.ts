import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { KindEntry, ScaffoldInput } from "@fresnel/contracts/services";
import { KIND_CATALOG } from "./catalog.ts";
import { scaffoldExtension } from "./scaffold.ts";
import type { TemplateDirs } from "./templates-dir.ts";
import { validateExtensionDir } from "./validate.ts";

// L3.authoring.spec §4.4 2번 카탈로그 적합성. `stable`·`preview` 항목마다 뼈대를 실제로 만들고 `validate`가 오류 0인지 본다.
// F 훅 표, 매니페스트 스키마가 바뀌어 템플릿이 깨지면 문제 목록에 그 파일 이름이 나온다.

const POLICY: CompositionDecl = {
  blocks: [{ id: "guard", stage: "guard", op: "on", hooks: ["tool.call.before"] }],
};
const OBSERVE: CompositionDecl = {
  blocks: [{ id: "count", stage: "observe", op: "on", hooks: ["boundary.settle.after"] }],
};

/** 항목 하나가 만드는 입력들. 그룹은 템플릿 세 종류를 모두 만든다 */
function inputsOf(entry: KindEntry, dir: string): readonly ScaffoldInput[] {
  if (entry.id === "single-plugin") return [{ kind: "single-plugin", name: "conf-single", dir }];
  return [
    { kind: "plugin-group", name: "conf-drive", dir },
    { kind: "plugin-group", name: "conf-policy", dir, group: { composition: POLICY } },
    { kind: "plugin-group", name: "conf-observe", dir, group: { composition: OBSERVE } },
  ];
}

/** 문제 문장 목록. 비어 있으면 적합하다 */
export async function catalogConformance(
  templates: TemplateDirs,
  catalog: readonly KindEntry[] = KIND_CATALOG,
): Promise<readonly string[]> {
  const problems: string[] = [];
  for (const entry of catalog) {
    if (entry.status !== "stable" && entry.status !== "preview") continue;
    for (const [index] of inputsOf(entry, "").entries()) {
      // oxlint-disable-next-line no-await-in-loop -- 임시 폴더를 하나씩 만들고 지운다. 순차가 목적이다 (eng.typescript.guide TY-22)
      const root = await mkdtemp(join(tmpdir(), "fresnel-conf-"));
      try {
        const input = inputsOf(entry, join(root, "out"))[index];
        if (input === undefined) continue;
        // oxlint-disable-next-line no-await-in-loop -- 위 임시 폴더를 쓰는 순차 단계다 (eng.typescript.guide TY-22)
        const made = await scaffoldExtension(input, { templates, catalog });
        if (!made.ok) {
          problems.push(
            `${entry.id}/${input.name}: scaffold ${made.error.kind}: ${made.error.message}`,
          );
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop -- 위 뼈대를 검사하는 순차 단계다 (eng.typescript.guide TY-22)
        const report = await validateExtensionDir(input.dir);
        if (!report.ok) {
          problems.push(
            `${entry.id}/${input.name}: validate ${report.error.kind}: ${report.error.message}`,
          );
          continue;
        }
        for (const issue of report.value.issues)
          if (issue.severity === "error")
            problems.push(
              `${entry.id}/${input.name}: ${issue.code} ${issue.path} ${issue.message}`,
            );
      } finally {
        // oxlint-disable-next-line no-await-in-loop -- 위 임시 폴더를 지운다 (eng.typescript.guide TY-22)
        await rm(root, { recursive: true, force: true });
      }
    }
  }
  return problems;
}
