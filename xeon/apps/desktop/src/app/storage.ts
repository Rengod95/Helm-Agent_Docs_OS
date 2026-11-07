import { catalogOf, LOCALES, t } from "@fresnel/client/i18n";
import { err, ok, type JsonParseError, type ParseError, type Result } from "@fresnel/contracts";
import {
  parseBackupReport,
  parsePreviousRemoved,
  parseStorageUsage,
  type BackupReport,
  type DbRestoreReply,
  type DesktopIpc,
  type EngineTarget,
  type IpcError,
  type PreviousRemoved,
  type StorageUsage,
} from "../transport/ipc.ts";
import type { StorageCommands, StorageFailure } from "../views/commands.ts";
import type { EngineSwitch } from "./engine-switch.ts";

// 설정 고급 탭의 저장 공간 명령(백업 만들기, 사용량 보기, 복원 전 사본 지우기)의 결과를 화면이 쓰는 실패로 바꾼다.
// 셸은 `fresnel db export|usage|previous-rm --json`을 엔진 없이 한 번 돌리고 종료 코드와 두 출력을 그대로 돌려준다
// (apps/desktop-shell/src/main/db-tools.ts). 종료 코드 0이면 stdout을 그 명령의 보고서로 읽는다.
// 나머지는 stderr의 첫 줄을 문장으로, 둘째 줄의 `해결:`/`Fix:` 줄을 해결 문장으로 쓴다(CLI 머리말 `fresnel: `은 뗀다).
// 복원(app/restore.ts)과 달리 카탈로그 문장을 맞춰 보지 않는다. 종류는 종료 코드만으로 고른다.

/** CLI 종료 코드(apps/cli/src/exit-codes.ts EXIT). 셸은 CLI가 낸 값을 그대로 돌려준다 */
const EXIT_OK = 0;
const EXIT_DECLINED = 1;
const EXIT_USAGE = 2;

/** 실패 문장의 머리말(apps/cli/src/errors.ts renderFailure) */
const FAILURE_HEAD = "fresnel: ";

/** 해결 줄의 머리말. 모든 로케일의 `cli.errors.fixLabel`이다(CLI는 자기 로케일의 머리말로 찍는다) */
function fixHeads(): readonly string[] {
  return LOCALES.flatMap((locale) => {
    const label = catalogOf(locale)["cli.errors.fixLabel"];
    return label === undefined ? [] : [label];
  });
}

/** 셸 응답의 stdout을 보고서로 읽는 함수 하나(`parseBackupReport` 같은 것) */
type ReportParser<T> = (text: string) => Result<T, JsonParseError | ParseError>;

/** stderr의 첫 줄에서 머리말을 뗀 글. 줄이 없으면 빈 글이다 */
function messageOf(stderr: string): string {
  const line = (stderr.split("\n")[0] ?? "").trim();
  return line.startsWith(FAILURE_HEAD) ? line.slice(FAILURE_HEAD.length).trim() : line;
}

/** 머리 다음 줄들 가운데 해결 줄이 있으면 그 글, 없으면 `null`이다 */
function fixOf(stderr: string): string | null {
  for (const line of stderr.split("\n").slice(1)) {
    const text = line.trim();
    const head = fixHeads().find((candidate) => text.startsWith(candidate));
    if (head === undefined) continue;
    const fix = text.slice(head.length).trim();
    return fix === "" ? null : fix;
  }
  return null;
}

/** 종료 코드 2는 입력 문제, 1은 확인하지 않아 멈춘 것, 그 밖(3 포함)은 환경 문제다 */
function kindOf(exitCode: number): StorageFailure["kind"] {
  if (exitCode === EXIT_USAGE) return "usage";
  if (exitCode === EXIT_DECLINED) return "declined";
  return "environment";
}

/**
 * 종료 코드 0이 아닌 실패. stderr가 비었으면 종료 코드를 보인다(restore.ts `unmatchedRefusal`과 같다).
 * 해결 줄은 문장이 있을 때만 읽는다.
 */
function refusalOf(stderr: string, exitCode: number): StorageFailure {
  const message = messageOf(stderr);
  if (message === "") {
    return {
      kind: kindOf(exitCode),
      message: t("desktop.settings.restore.refused.exit", { code: exitCode }),
      fix: null,
    };
  }
  return { kind: kindOf(exitCode), message, fix: fixOf(stderr) };
}

function badReplyFailure(): StorageFailure {
  return { kind: "bad_reply", message: t("desktop.settings.restore.refused.badReply"), fix: null };
}

/**
 * 셸의 실행 결과를 보고서로 바꾼다. 종료 코드 0이면 stdout을 `read`로 읽고, 읽지 못하면 `bad_reply`다.
 * 그 밖의 종료 코드는 stderr로 실패를 만든다.
 */
function outcomeOf<T>(reply: DbRestoreReply, read: ReportParser<T>): Result<T, StorageFailure> {
  if (reply.exitCode !== EXIT_OK) return err(refusalOf(reply.stderr, reply.exitCode));
  const report = read(reply.stdout);
  return report.ok ? ok(report.value) : err(badReplyFailure());
}

/**
 * 셸이 명령을 거절했을 때(`IpcError`). 응답 모양이 맞지 않으면 `bad_reply`이고, 거절한 코드는 `shell`이다.
 * 셸의 오류 코드는 kebab-case 문자열이다.
 */
function failureOfIpcError(error: IpcError): StorageFailure {
  if (error.kind === "invalid") return badReplyFailure();
  return {
    kind: "shell",
    message: t("desktop.settings.restore.refused.reject", { code: error.code }),
    fix: null,
  };
}

export interface StorageDeps {
  readonly ipc: Pick<DesktopIpc, "dbExport" | "dbUsage" | "dbPreviousRemove" | "openDataDir">;
  readonly engineSwitch: Pick<EngineSwitch, "current">;
}

export function createStorageCommands(deps: StorageDeps): StorageCommands {
  return {
    engineTarget: (): EngineTarget | null => deps.engineSwitch.current(),
    async usage() {
      const reply = await deps.ipc.dbUsage();
      return reply.ok
        ? outcomeOf<StorageUsage>(reply.value, parseStorageUsage)
        : err(failureOfIpcError(reply.error));
    },
    async backup(parentDir) {
      const reply = await deps.ipc.dbExport(parentDir);
      return reply.ok
        ? outcomeOf<BackupReport>(reply.value, parseBackupReport)
        : err(failureOfIpcError(reply.error));
    },
    async removePrevious(name) {
      const reply = await deps.ipc.dbPreviousRemove(name);
      return reply.ok
        ? outcomeOf<PreviousRemoved>(reply.value, parsePreviousRemoved)
        : err(failureOfIpcError(reply.error));
    },
    async openDataDir() {
      const opened = await deps.ipc.openDataDir();
      return opened.ok;
    },
  };
}
