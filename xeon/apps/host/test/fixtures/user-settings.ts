import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineHome } from "./engine-home.ts";

/** 사용자 설정 파일(<XEON_HOME>/config/settings.json)을 쓴다. 평평한 객체이고 키는 전체 설정 키다 */
export function writeUserSettings(
  home: EngineHome,
  values: Readonly<Record<string, unknown>>,
): void {
  const dir = join(home.root, "config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "settings.json"), JSON.stringify(values));
}
