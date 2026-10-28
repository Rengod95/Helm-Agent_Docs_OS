import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock, Scheduler } from "@xeon/contracts";
import { systemClock, systemScheduler } from "@xeon/platform-os";

// L4.cli.plan §5.2 scenario의 공용 도구. 임시 엔진 홈(XEON_HOME) 하나와 작업 폴더 하나를 만들고, 자식 프로세스 진입과
// 같은 프로세스 안 테스트가 같은 설정(테이프 provider가 기본 모델)을 쓰게 한다.

export const TAPES_DIR: string = join(import.meta.dir, "..", "fixtures", "tapes");
export const SCENARIO_MAIN: string = join(import.meta.dir, "..", "fixtures", "scenario-main.ts");
export const NOTES_TEXT: string = "hello from notes\n";

/** 모델 테이프가 바로 읽는 설정. 테이프 provider는 키가 필요 없다 */
const TAPE_SETTINGS = {
  "l1.models.default": "tape/tape-1",
  "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
};

export interface ScenarioHome {
  /** XEON_HOME. 권한이 0700이어야 엔진이 선다(L0.os) */
  readonly root: string;
  /** 작업 폴더. notes.txt가 들어 있다 */
  readonly work: string;
  readonly stateFile: string;
  dispose(): void;
}

export function createScenarioHome(): ScenarioHome {
  const root = mkdtempSync(join(tmpdir(), "xcli-scn-"));
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
