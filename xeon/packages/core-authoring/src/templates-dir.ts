import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// 템플릿 폴더 위치. 그룹 템플릿은 group-sdk가, 플러그인 골격 세 방식(훅, 지침, 구동)은 이 패키지가 가진다.

export interface TemplateDirs {
  /** group-sdk의 templates/ (index.json이 있는 폴더) */
  readonly group: string;
  /** 이 패키지의 templates/single-plugin. 훅 방식이고 기본값이다 */
  readonly single: string;
  /** 이 패키지의 templates/inject-plugin. 지침 방식(`components.instructions`) */
  readonly inject: string;
  /** 이 패키지의 templates/drive-plugin. 구동 방식(그룹 구성원, `drives: true`) */
  readonly drive: string;
}

/** 이 패키지 폴더(소스 실행 기준) */
const PACKAGE_DIR = join(import.meta.dir, "..");

/**
 * 템플릿 폴더를 찾는다. 환경 변수 `FRESNEL_GROUP_TEMPLATES_DIR`(그룹), 릴리즈 자원 폴더, 없으면 소스 저장소의
 * `packages/group-sdk/templates`다. 못 찾으면 null이다
 */
export function locateTemplateDirs(
  env: Readonly<Record<string, string | undefined>>,
  resourceDir?: string,
): TemplateDirs | null {
  const override = env["FRESNEL_GROUP_TEMPLATES_DIR"];
  const candidates: string[] = [];
  if (override !== undefined && override !== "") candidates.push(override);
  if (resourceDir !== undefined) candidates.push(join(resourceDir, "group-sdk", "templates"));
  let dir = PACKAGE_DIR;
  for (;;) {
    candidates.push(join(dir, "packages", "group-sdk", "templates"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const group = candidates.find((candidate) => existsSync(join(candidate, "index.json")));
  const single = join(PACKAGE_DIR, "templates", "single-plugin");
  const inject = join(PACKAGE_DIR, "templates", "inject-plugin");
  const drive = join(PACKAGE_DIR, "templates", "drive-plugin");
  const present = [single, inject, drive].every((path) => existsSync(path));
  if (group === undefined || !present) return null;
  return { group, single, inject, drive };
}
