import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { attempt } from "@fresnel/contracts";
import { shouldSuggestSafeMode } from "@fresnel/ext-host";

// X.operations.spec §4.6.4, M4 X-21. 연속 시작 실패 수를 상태 디렉터리의 작은 파일에 둔다. DB 밖이다: DB를 여는 단계에서 실패할 수 있기 때문이다.
// 시작할 때 "진행 중" 표시를 남기고, 첫 입력을 받을 준비가 되면 지운다. 시작 도중 프로세스가 죽거나 조립이 던지면 표시가 남아 다음 시작에서 1이 는다.
// 조립 루트 코드(DR-14 예외 2)라 동기 파일 접근을 쓴다. 읽거나 쓸 수 없으면 기록 없이(0) 돌아간다: 이 기록이 시작을 막아서는 안 된다.

/** 연속 시작 실패 기록 포트. 인터페이스와 구현은 호스트가 가진다(X.operations.spec §3.6) */
export interface StartupHealthStore {
  /** 이번 시작을 "진행 중"으로 표시하고 직전까지의 연속 실패 수를 돌려준다 */
  beginStartup(): number;
  /** 첫 사용자 입력을 받을 준비가 되면 부른다. 연속 실패 수를 0으로 */
  markStarted(): void;
}

interface StartupRecord {
  readonly failures: number;
  readonly starting: boolean;
}

const EMPTY_RECORD: StartupRecord = { failures: 0, starting: false };

/** 시작 상태 파일의 이름. 상태 디렉터리 바로 아래에 둔다 */
export const STARTUP_HEALTH_FILE = "startup-health.json";

function parseRecord(text: string): StartupRecord {
  const parsed = attempt((): unknown => JSON.parse(text));
  if (!parsed.ok) return EMPTY_RECORD;
  const value = parsed.value;
  if (typeof value !== "object" || value === null) return EMPTY_RECORD;
  const failures = "failures" in value ? value.failures : undefined;
  const starting = "starting" in value ? value.starting : undefined;
  return {
    failures:
      typeof failures === "number" && Number.isInteger(failures) && failures > 0 ? failures : 0,
    starting: starting === true,
  };
}

function readRecord(file: string): StartupRecord {
  const text = attempt(() => readFileSync(file, "utf8"));
  return text.ok ? parseRecord(text.value) : EMPTY_RECORD;
}

/** 기록을 못 써도 시작은 계속한다 */
function writeRecord(file: string, record: StartupRecord): void {
  attempt(() => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  });
}

/** 상태 디렉터리 아래 파일에 쓰는 구현 */
export function createFileStartupHealth(stateDir: string): StartupHealthStore {
  const file = join(stateDir, STARTUP_HEALTH_FILE);
  return {
    beginStartup() {
      const previous = readRecord(file);
      const failures = previous.starting ? previous.failures + 1 : previous.failures;
      writeRecord(file, { failures, starting: true });
      return failures;
    },
    markStarted() {
      writeRecord(file, EMPTY_RECORD);
    },
  };
}

/** `host.status`가 싣는 시작 건강 값 */
export interface StartupHealth {
  /** 직전까지의 연속 시작 실패 수 */
  readonly failures: number;
  /** `x.operations.safeMode.suggestAfter` 이상이고 안전 모드가 아니면 참 */
  readonly suggestSafeMode: boolean;
}

/** 순수 함수. 이미 안전 모드로 떠 있으면 제안하지 않는다 */
export function startupHealthOf(
  failures: number,
  threshold: number,
  safeMode: boolean,
): StartupHealth {
  return { failures, suggestSafeMode: !safeMode && shouldSuggestSafeMode(failures, threshold) };
}
