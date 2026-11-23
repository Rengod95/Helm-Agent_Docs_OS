import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConnection } from "@fresnel/contracts/wire";
import type { EngineHome } from "./engine-home.ts";

/** 사용자 설정 파일(<FRESNEL_HOME>/config/settings.json)을 쓴다. 평평한 객체이고 키는 전체 설정 키다 */
export function writeUserSettings(
  home: EngineHome,
  values: Readonly<Record<string, unknown>>,
): void {
  const dir = join(home.root, "config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "settings.json"), JSON.stringify(values));
}

/**
 * 모델 테이프 provider를 기본 모델로 쓰는 설정. 테이프 provider는 키가 필요 없다.
 * `l1.tools.permissionMode` 키는 이제 대화의 프로필이 정하므로 이 사용자 파일의 값으로는 대화의 모드가 바뀌지 않는다.
 * 승인 경로("묻는" 경로)를 보아야 하는 시험은 `askOnDefaultProfile`로 기본 프로필을 `default`로 저장한다. 키 자체는 그대로 둔다
 */
export const TAPE_SETTINGS: Readonly<Record<string, unknown>> = {
  "l1.tools.permissionMode": "default",
  "l1.models.default": "tape/tape-1",
  "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
};

/**
 * 승인 시험이 "묻는" 경로를 보게 기본 프로필의 실행 방식을 `default`(실행마다 묻기)로 저장한다. 실행 방식은 프로필이 정하므로
 * [결정: 2026-11-23 사용자, AGE-71 질문 3] 사용자 파일의 값(`TAPE_SETTINGS`)으로는 대화의 모드가 바뀌지 않는다. `host.hello` 뒤, 대화를 만들기 전에 부른다
 */
export async function askOnDefaultProfile(connection: HostConnection): Promise<void> {
  const { profile } = await connection.request("profile.get", { id: "default" });
  await connection.request("profile.put", {
    profile: {
      id: profile.id,
      title: profile.title,
      plugins: profile.plugins,
      settings: [
        ...profile.settings.filter((setting) => setting.key !== "l1.tools.permissionMode"),
        { key: "l1.tools.permissionMode", value: "default" },
      ],
      startDrive: profile.startDrive,
    },
    baseRev: profile.rev,
  });
}
