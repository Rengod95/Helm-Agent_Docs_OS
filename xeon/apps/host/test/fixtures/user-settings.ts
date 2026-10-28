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

/** 모델 테이프 provider를 기본 모델로 쓰는 설정. 테이프 provider는 키가 필요 없다 */
export const TAPE_SETTINGS: Readonly<Record<string, unknown>> = {
  "l1.models.default": "tape/tape-1",
  "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
};
