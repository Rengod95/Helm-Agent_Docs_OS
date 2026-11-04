import { catalogOf, LOCALES, t, type MessageId } from "@fresnel/client/i18n";
import { err, ok, type Result } from "@fresnel/contracts";
import {
  parseRestoreReport,
  type DbRestoreReply,
  type DesktopIpc,
  type EngineTarget,
  type IpcError,
  type RestoreReport,
} from "../transport/ipc.ts";
import type { RestoreCommands, RestoreRefusal, RestoreRefusalKind } from "../views/commands.ts";
import type { EngineSwitch } from "./engine-switch.ts";

// 데이터 복원(`db_restore`)의 결과를 화면이 쓰는 거절 종류로 바꾼다. 셸은 `fresnel db restore --json`을 엔진 없이 실행하고
// 종료 코드와 두 출력을 그대로 돌려준다(apps/cli/src/commands/db.ts runRestore, errors.ts failureOfRestore).
// 데스크톱과 CLI는 같은 카탈로그를 쓰므로, 종료 코드 3의 stderr 첫 줄을 카탈로그 문장 템플릿과 맞춰 종류를 고르고
// 문장은 화면 로케일로 다시 만든다. 맞는 문장이 없으면 종류는 `io`이고 문장은 stderr의 첫 줄이다.

/** CLI 종료 코드(apps/cli/src/exit-codes.ts EXIT). 셸은 CLI가 낸 값을 그대로 돌려준다 */
const EXIT_OK = 0;
const EXIT_NOT_A_BACKUP = 2;
const EXIT_ENVIRONMENT = 3;

/** 실패 문장의 머리말(apps/cli/src/errors.ts renderFailure) */
const FAILURE_HEAD = "fresnel: ";

/** 종료 코드 3 문장 하나: 이 카탈로그 문장이면 이 종류이고 해결 문장은 이것이다 */
interface EnvironmentText {
  readonly kind: RestoreRefusalKind;
  readonly message: MessageId;
  readonly fix: MessageId;
}

/** 종료 코드 3으로 끝나는 복원 실패의 문장(errors.ts failureOfRestore의 환경 분기). 좁은 것을 먼저 둔다 */
const ENVIRONMENT_TEXTS: readonly EnvironmentText[] = [
  {
    kind: "invalid",
    message: "cli.errors.restore.backupInvalid.manifest",
    fix: "cli.errors.restore.backupInvalid.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.backupInvalid.format",
    fix: "cli.errors.restore.backupInvalid.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.backupInvalid.integrity",
    fix: "cli.errors.restore.backupInvalid.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.backupInvalid.schema",
    fix: "cli.errors.restore.backupInvalid.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.backupInvalid.blobMissing",
    fix: "cli.errors.restore.backupInvalid.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.backupInvalid.blobHash",
    fix: "cli.errors.restore.backupInvalid.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.foreign.message",
    fix: "cli.errors.restore.foreign.fix",
  },
  {
    kind: "invalid",
    message: "cli.errors.restore.notDatabase.message",
    fix: "cli.errors.restore.notDatabase.fix",
  },
  {
    kind: "future_version",
    message: "cli.errors.restore.futureVersion.message",
    fix: "cli.errors.restore.futureVersion.fix",
  },
  {
    kind: "engine_running",
    message: "cli.errors.restore.engineRunning.message",
    fix: "cli.errors.restore.engineRunning.fix",
  },
  {
    kind: "io",
    message: "cli.errors.common.storageFull.message",
    fix: "cli.errors.common.storageFull.fix",
  },
  { kind: "io", message: "cli.errors.restore.io.message", fix: "cli.errors.restore.io.fix" },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 템플릿의 `{이름}` 자리에 줄의 글을 맞춘다. 맞으면 자리 이름마다 받은 글을, 아니면 `null`을 돌려준다.
 * 템플릿에는 단순 자리만 있다(복수형과 선택형은 이 문장들에 없다).
 */
function paramsOf(template: string, line: string): Readonly<Record<string, string>> | null {
  // 괄호가 있는 split은 홀수 자리에 자리 이름을 넣는다
  const pieces = template.split(/\{(\w+)\}/u);
  const names: string[] = [];
  let pattern = "^";
  for (const [index, piece] of pieces.entries()) {
    if (index % 2 === 1) {
      names.push(piece);
      pattern += "(.*?)";
    } else {
      pattern += escapeRegExp(piece);
    }
  }
  const matched = new RegExp(`${pattern}$`, "u").exec(line);
  if (matched === null) return null;
  const params: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    params[name] = matched[index + 1] ?? "";
  }
  return params;
}

/** stderr의 첫 줄에서 머리말을 뗀 글. stderr가 비었으면 빈 글이다 */
function firstLineOf(stderr: string): string {
  const line = (stderr.split("\n")[0] ?? "").trim();
  return line.startsWith(FAILURE_HEAD) ? line.slice(FAILURE_HEAD.length) : line;
}

/** 알 수 없는 실패: stderr의 첫 줄을 그대로 보이고, 줄이 없으면 종료 코드를 쓴다 */
function unmatchedRefusal(stderr: string, exitCode: number): RestoreRefusal {
  const line = firstLineOf(stderr);
  return {
    kind: "io",
    message: line === "" ? t("desktop.settings.restore.refused.exit", { code: exitCode }) : line,
    fix: null,
  };
}

/** 종료 코드 3: 카탈로그 문장(어느 로케일이든)과 맞으면 그 종류와 화면 로케일의 문장을 쓴다 */
function environmentRefusal(stderr: string, exitCode: number): RestoreRefusal {
  const line = firstLineOf(stderr);
  for (const candidate of ENVIRONMENT_TEXTS) {
    for (const locale of LOCALES) {
      const template = catalogOf(locale)[candidate.message];
      if (template === undefined) continue;
      const params = paramsOf(template, line);
      if (params !== null) {
        return {
          kind: candidate.kind,
          message: t(candidate.message, params),
          fix: t(candidate.fix),
        };
      }
    }
  }
  return unmatchedRefusal(stderr, exitCode);
}

function badReplyRefusal(): RestoreRefusal {
  return { kind: "io", message: t("desktop.settings.restore.refused.badReply"), fix: null };
}

/**
 * 셸의 실행 결과를 복원 결과로 바꾼다. 종료 코드 0이면 stdout의 보고서를 읽고, 2는 백업 폴더가 아니다,
 * 3은 환경 문제다(문장으로 종류를 고른다), 그 밖은 `io`다. 종료 코드 0인데 보고서를 읽지 못하면 `io`다.
 */
export function restoreOutcomeOf(reply: DbRestoreReply): Result<RestoreReport, RestoreRefusal> {
  if (reply.exitCode === EXIT_OK) {
    const report = parseRestoreReport(reply.stdout);
    return report.ok ? ok(report.value) : err(badReplyRefusal());
  }
  if (reply.exitCode === EXIT_NOT_A_BACKUP) {
    return err({
      kind: "not_a_backup",
      message: t("cli.errors.restore.notFound.message"),
      fix: t("cli.errors.restore.notFound.fix"),
    });
  }
  if (reply.exitCode === EXIT_ENVIRONMENT) {
    return err(environmentRefusal(reply.stderr, reply.exitCode));
  }
  return err(unmatchedRefusal(reply.stderr, reply.exitCode));
}

/** 셸이 명령을 거절했을 때(`IpcError`). 셸의 오류 코드는 kebab-case 문자열이다 */
export function refusalOfIpcError(error: IpcError): RestoreRefusal {
  if (error.kind === "invalid") return badReplyRefusal();
  if (error.code === "remote-target") {
    return {
      kind: "remote",
      message: t("desktop.settings.restore.refused.remote.message"),
      fix: t("desktop.settings.restore.refused.remote.fix"),
    };
  }
  if (error.code === "busy") {
    return {
      kind: "busy",
      message: t("desktop.settings.restore.refused.busy.message"),
      fix: t("desktop.settings.restore.refused.busy.fix"),
    };
  }
  if (error.code === "engine-stopping") {
    return {
      kind: "engine_running",
      message: t("desktop.settings.restore.refused.engineStopping.message"),
      fix: t("desktop.settings.restore.refused.engineStopping.fix"),
    };
  }
  return {
    kind: "io",
    message: t("desktop.settings.restore.refused.reject", { code: error.code }),
    fix: null,
  };
}

export interface RestoreDeps {
  readonly ipc: Pick<DesktopIpc, "dbRestore">;
  readonly engineSwitch: Pick<EngineSwitch, "current">;
}

export function createRestoreCommands(deps: RestoreDeps): RestoreCommands {
  return {
    engineTarget: (): EngineTarget | null => deps.engineSwitch.current(),
    async run(backupDir) {
      const reply = await deps.ipc.dbRestore(backupDir);
      return reply.ok ? restoreOutcomeOf(reply.value) : err(refusalOfIpcError(reply.error));
    },
  };
}
