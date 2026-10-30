import { pathToFileURL } from "node:url";
import { Bug } from "@xeon/contracts";
import type { GroupModule } from "../../src/index.ts";

/**
 * 생성 시험이 만든 그룹 소스의 default export를 읽는다. 동적 import는 모양을 모르는 값을 돌려주므로 여기서 한 번만 좁힌다.
 * 생성 결과는 defineGroup을 거쳐 검증된 GroupModule이어야 하고, 아니면 생성기 또는 템플릿의 버그다.
 */
export async function loadGeneratedGroup(file: string): Promise<GroupModule> {
  const loaded: unknown = await import(pathToFileURL(file).href);
  if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
    throw new Bug(`generated group ${file} has no default export`);
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A6 시험의 부분 대역: 생성된 그룹의 default export를 GroupModule로 붙인다. 템플릿은 defineGroup을 거치므로 시험이 그 모양을 확인한다 (eng.typescript.guide TY-06)
  return loaded.default as GroupModule;
}
