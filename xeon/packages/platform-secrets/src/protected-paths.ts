import { join, resolve } from "node:path";
import { DEFAULT_AGE_KEY_SUBPATH, SECRETS_SUBDIR, type SecretsSopsFile } from "./config.ts";

// L0.secrets.spec §3.6 protectedPaths, §4.7 5번. 샌드박스 읽기·쓰기 거부 대상인 비밀 파일의 절대 경로.
// 값도 파일 내용도 싣지 않는다. 감사 파일(마일스톤 M2)은 `<config>/secrets/` 아래라 그 항목이 덮는다.

export interface ProtectedPathsInput {
  readonly files: readonly SecretsSopsFile[];
  readonly configDir: string;
  /** l0.secrets.ageKey.filePath. null이면 기본 경로 */
  readonly ageKeyFilePath: string | null;
}

export function defaultAgeKeyPath(configDir: string): string {
  return join(configDir, ...DEFAULT_AGE_KEY_SUBPATH);
}

export function computeProtectedPaths(input: ProtectedPathsInput): readonly string[] {
  const paths = [
    ...input.files.map((f) => resolve(f.path)),
    join(input.configDir, SECRETS_SUBDIR),
    resolve(input.ageKeyFilePath ?? defaultAgeKeyPath(input.configDir)),
  ];
  return [...new Set(paths)];
}
