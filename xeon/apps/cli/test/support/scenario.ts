import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock, Scheduler } from "@fresnel/contracts";
import { systemClock, systemScheduler } from "@fresnel/platform-os";

// L4.cli.plan §5.2 scenario의 공용 도구. 임시 엔진 홈(FRESNEL_HOME) 하나와 작업 폴더 하나를 만들고, 자식 프로세스 진입과
// 같은 프로세스 안 테스트가 같은 설정(테이프 provider가 기본 모델)을 쓰게 한다.

export const TAPES_DIR: string = join(import.meta.dir, "..", "fixtures", "tapes");
export const SCENARIO_MAIN: string = join(import.meta.dir, "..", "fixtures", "scenario-main.ts");
export const NOTES_TEXT: string = "hello from notes\n";

/**
 * 모델 테이프가 바로 읽는 설정. 테이프 provider는 키가 필요 없다.
 * 엔진 기본 모드는 bypass(2026-11-13 사용자 결정)지만 승인 카드를 보는 시험이 많아 default로 둔다
 */
const TAPE_SETTINGS = {
  "l1.tools.permissionMode": "default",
  "l1.models.default": "tape/tape-1",
  "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
};

/**
 * 대화의 실행 방식은 프로필이 정한다(2026-11-23, AGE-71 질문 3): 사용자 파일의 `l1.tools.permissionMode`로는 바뀌지 않는다.
 * 자식 프로세스로 도는 진입(scenario-main, scenario-host)은 연결 뒤에 프로필을 쓸 자리가 없으므로, 승인 카드를 보는 시험이
 * 저장된 기본 프로필(`profiles.json` v2)에 `default`(실행마다 묻기)를 미리 둔다. 플러그인 목록은 비어 있으니 확장을 싣는 시험에는 쓰지 않는다
 */
const ASK_PROFILES = {
  schemaVersion: 2,
  common: { plugins: [], settings: [], updatedAt: new Date(0).toISOString(), rev: 0 },
  profiles: [
    {
      id: "default",
      title: "default",
      builtin: true,
      plugins: [],
      settings: [{ key: "l1.tools.permissionMode", value: "default" }],
      startDrive: null,
      updatedAt: new Date(0).toISOString(),
      rev: 1,
    },
  ],
};

export interface ScenarioHome {
  /** FRESNEL_HOME. 권한이 0700이어야 엔진이 선다(L0.os) */
  readonly root: string;
  /** 작업 폴더. notes.txt가 들어 있다 */
  readonly work: string;
  readonly stateFile: string;
  dispose(): void;
}

/** 승인 카드를 보는 시험의 홈에 묻는 기본 프로필을 둔다(엔진을 띄우기 전에 부른다) */
export function seedAskProfile(home: ScenarioHome): void {
  writeFileSync(join(home.root, "config", "profiles.json"), JSON.stringify(ASK_PROFILES), {
    mode: 0o600,
  });
}

export function createScenarioHome(): ScenarioHome {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xcli-scn-")));
  chmodSync(root, 0o700);
  const config = join(root, "config");
  mkdirSync(config, { mode: 0o700 });
  const settings = join(config, "settings.json");
  writeFileSync(settings, JSON.stringify(TAPE_SETTINGS), { mode: 0o600 });
  const work = join(root, "work");
  mkdirSync(work);
  writeFileSync(join(work, "notes.txt"), NOTES_TEXT);
  return {
    root,
    work,
    stateFile: join(root, "cli-state.json"),
    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** 실제 시간으로 도는 테이프 재생기용 시계. stall 응답이 abort를 기다릴 때 쓴다 */
export function realTapeClock(): Clock & Scheduler {
  const clock = systemClock();
  const scheduler = systemScheduler();
  return {
    now: () => clock.now(),
    setTimeout: (fn, ms) => scheduler.setTimeout(fn, ms),
    clearTimeout: (handle) => {
      scheduler.clearTimeout(handle);
    },
  };
}
