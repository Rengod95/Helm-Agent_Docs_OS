import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KindEntry, ScaffoldInput } from "@fresnel/contracts/services";
import { KIND_CATALOG } from "./catalog.ts";
import { scaffoldExtension } from "./scaffold.ts";
import type { TemplateDirs } from "./templates-dir.ts";
import { validateExtensionDir, type ValidateOptions } from "./validate.ts";

// L3.authoring.spec §4.4 2번 카탈로그 적합성. `stable`·`preview` 항목마다 뼈대를 실제로 만들고 `validate`가 오류 0인지 본다.
// F 훅 표, 매니페스트 스키마가 바뀌어 템플릿이 깨지면 문제 목록에 그 파일 이름이 나온다.
// 재생 규율(AU-012)까지 보려면 `options.scanDrive`를 넘긴다(시험이 `scanDriveSource`를 넘긴다).

/** 항목 하나가 만드는 입력. 종류는 플러그인 하나라 뼈대도 하나다. 목적과 설명은 AU-013을 통과하도록 채운다 */
function inputsOf(entry: KindEntry, dir: string): readonly ScaffoldInput[] {
  return [
    {
      kind: entry.id,
      name: "conf-single",
      dir,
      purpose: "Checks that the catalog scaffold still validates.",
      description: "A scaffold made only to check that the catalog template still validates.",
    },
  ];
}

/** 문제 문장 목록. 비어 있으면 적합하다 */
export async function catalogConformance(
  templates: TemplateDirs,
  catalog: readonly KindEntry[] = KIND_CATALOG,
  options: ValidateOptions = {},
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
        const report = await validateExtensionDir(input.dir, options);
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
