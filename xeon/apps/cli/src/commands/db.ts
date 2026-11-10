import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertNever, attemptAsync } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { DbCommand } from "../cli/command.ts";
import { failureOfExport, failureOfRestore, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { confirmed, printFailure, type CommandContext } from "./context.ts";
import {
  codeOf,
  collectUsage,
  DB_FILE_NAME,
  findCopy,
  formatSize,
  treeBytes,
  type UsageIoError,
} from "./db-usage.ts";

// L4.cli.spec §4.13, §4.13.2. `fresnel db export <폴더>`는 엔진을 띄우지 않고 저장소 파일을 `exportDatabase`로 내보낸다.
// 원본은 읽기 전용으로만 열므로 엔진이 떠 있어도 된다. 위치는 데이터 디렉터리(OsDirs.data)의 저장소 파일이다.
// `db usage`는 저장 공간을 세고, `db previous-rm <이름>`은 복원 전 사본 하나를 지운다. 둘 다 엔진을 띄우지 않는다.

/** 누락 블롭 경고를 목록으로 보이는 최대 줄 수. 넘으면 나머지는 개수 한 줄로 센다 */
const MISSING_LIST_CAP = 10;

/** 데이터 디렉터리 위치를 정하지 못했을 때의 실패. 문장은 쓸 때 현재 로케일로 만든다 */
function dataDirFailure(): Failure {
  return {
    message: t("cli.db.dataDirUnknown.message"),
    fix: t("cli.errors.engineStart.stateDirUnknown.fix"),
    code: EXIT.environment,
  };
}

/** `db` 명령군. 지금은 `export` 하나뿐이라 분기하지 않는다. 하위 명령을 더하면 여기서 나눈다 */
export async function runDb(ctx: CommandContext, command: DbCommand): Promise<ExitCode> {
  switch (command.kind) {
    case "db.export":
      return runExport(ctx, command);
    case "db.restore":
      return runRestore(ctx, command);
    case "db.usage":
      return runUsage(ctx, command);
    case "db.previous-rm":
      return runPreviousRm(ctx, command);
    default:
      return assertNever(command, "DbCommand");
  }
}

type ExportCommand = Extract<DbCommand, { readonly kind: "db.export" }>;
type RestoreCommand = Extract<DbCommand, { readonly kind: "db.restore" }>;
type UsageSubcommand = Extract<DbCommand, { readonly kind: "db.usage" }>;
type PreviousRmCommand = Extract<DbCommand, { readonly kind: "db.previous-rm" }>;

/** 실패를 두 줄로 알리고 종료 코드를 돌려준다 */
async function reportFailure(ctx: CommandContext, failure: Failure): Promise<ExitCode> {
  await printFailure(ctx.io, failure);
  return failure.code;
}

/** 저장 공간 집계가 입출력 오류를 냈다. 환경 문제(3)다 */
function usageIoFailure(error: UsageIoError): Failure {
  return {
    message: t("cli.db.usage.io.message", { path: error.path, code: error.code }),
    fix: t("cli.db.usage.io.fix"),
    code: EXIT.environment,
  };
}

/** 사본을 지우다 입출력 오류가 났다. 일부만 지워졌을 수 있다(환경 문제, 3) */
function removeFailure(error: UsageIoError): Failure {
  return {
    message: t("cli.db.previousRm.io.message", { path: error.path, code: error.code }),
    fix: t("cli.db.previousRm.io.fix"),
    code: EXIT.environment,
  };
}

/** 이름에 맞는 사본이 없다(사용법 오류, 2). 이름은 형식 검사를 통과했다 */
function noSuchCopyFailure(name: string): Failure {
  return {
    message: t("cli.db.previousRm.missing.message", { name }),
    fix: t("cli.db.previousRm.missing.fix"),
    code: EXIT.usage,
  };
}

/**
 * `fresnel db usage [--json]`: 데이터 디렉터리와 상태 디렉터리의 저장 공간을 센다(L4.cli.spec §4.13.2).
 * 엔진을 띄우지 않고 아무것도 쓰지 않는다. 상태 디렉터리를 정하지 못하면 로그는 0이다.
 */
async function runUsage(ctx: CommandContext, command: UsageSubcommand): Promise<ExitCode> {
  const dataDir = ctx.deps.resolveDataDir();
  if (dataDir === null) return reportFailure(ctx, dataDirFailure());
  const measured = await collectUsage(dataDir, ctx.deps.resolveStateDir());
  if (!measured.ok) return reportFailure(ctx, usageIoFailure(measured.error));
  const report = measured.value;
  if (command.output === "json") {
    await ctx.io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT.ok;
  }
  const lines = [
    t("cli.db.usage.dataDir", { dir: report.dataDir }),
    t("cli.db.usage.conversations", { size: formatSize(report.conversations) }),
    t("cli.db.usage.attachments", { size: formatSize(report.attachments) }),
    t("cli.db.usage.measurements", { size: formatSize(report.measurements) }),
    t("cli.db.usage.logs", { size: formatSize(report.logs) }),
    t("cli.db.usage.restorePrevious", { size: formatSize(report.restorePrevious) }),
    ...report.previous.map((copy) =>
      t("cli.db.usage.previousItem", { name: copy.name, size: formatSize(copy.bytes) }),
    ),
  ];
  await ctx.io.stdout(lines.join(""));
  return EXIT.ok;
}

/**
 * `fresnel db previous-rm <이름> [--yes] [--json]`: 복원 전 사본 하나를 재귀로 지운다(L4.cli.spec §4.13.2).
 * 이름은 파서가 형식을 검사했다. 여기서는 그 폴더가 restore-previous 바로 아래 실제 폴더인지 본다.
 * 확인 규칙은 `db export`와 같다: --yes가 없으면 터미널에서 묻고, 터미널이 아니면 종료 코드 2로 거부한다.
 */
async function runPreviousRm(ctx: CommandContext, command: PreviousRmCommand): Promise<ExitCode> {
  const dataDir = ctx.deps.resolveDataDir();
  if (dataDir === null) return reportFailure(ctx, dataDirFailure());
  const found = await findCopy(dataDir, command.name);
  if (!found.ok) return reportFailure(ctx, usageIoFailure(found.error));
  const path = found.value;
  if (path === null) return reportFailure(ctx, noSuchCopyFailure(command.name));
  const measured = await treeBytes(path);
  if (!measured.ok) return reportFailure(ctx, usageIoFailure(measured.error));
  const bytes = measured.value;
  if (!command.yes) {
    if (!ctx.io.terminal.stdinIsTty) {
      return reportFailure(ctx, {
        message: t("cli.db.previousRm.noTerminal.message"),
        fix: `fresnel db previous-rm ${command.name} --yes`,
        code: EXIT.usage,
      });
    }
    const question = t("cli.db.previousRm.confirm", { path, size: formatSize(bytes) });
    if (!(await confirmed(ctx, question))) {
      await ctx.io.stderr(`${t("cli.db.previousRm.kept")}\n`);
      return EXIT.error;
    }
  }
  const removed = await attemptAsync(() => rm(path, { recursive: true, force: false }));
  if (!removed.ok) {
    return reportFailure(ctx, removeFailure({ path, code: codeOf(removed.error.cause) }));
  }
  if (command.output === "json") {
    await ctx.io.stdout(
      `${JSON.stringify({ removed: command.name, freedBytes: bytes }, null, 2)}\n`,
    );
    return EXIT.ok;
  }
  await ctx.io.stdout(
    `${t("cli.db.previousRm.done", { name: command.name, size: formatSize(bytes) })}\n`,
  );
  return EXIT.ok;
}

/**
 * `fresnel db restore <폴더>`. 엔진을 띄우지 않는다. 엔진이 떠 있으면 거절한다(L0.store.spec §4.10.1).
 * 비밀 값은 읽지도 쓰지도 않는다. age 키와 설정 파일은 사본에 없으므로 따로 필요하다는 안내만 stderr에 쓴다.
 */
async function runRestore(ctx: CommandContext, command: RestoreCommand): Promise<ExitCode> {
  const dataDir = ctx.deps.resolveDataDir();
  if (dataDir === null) {
    const failure = dataDirFailure();
    await printFailure(ctx.io, failure);
    return failure.code;
  }
  const backupDir = resolve(ctx.workspace, command.backupDir);
  const restored = await ctx.deps.restoreDatabase({
    dbPath: join(dataDir, DB_FILE_NAME),
    backupDir,
    clock: ctx.deps.clock,
    ...(command.check ? { verifyOnly: true } : {}),
  });
  if (!restored.ok) {
    const failure = failureOfRestore(restored.error);
    await printFailure(ctx.io, failure);
    return failure.code;
  }
  const report = restored.value;
  // --check는 사본이 쓸 만한지만 알린다. 되돌리지 않았으므로 되돌렸다는 문장과 안내는 쓰지 않는다
  if (command.check) {
    if (command.output === "json") await ctx.io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    else await ctx.io.stdout(t("cli.db.restore.checked", { backupDir: report.backupDir }));
    return EXIT.ok;
  }
  if (command.output === "json") {
    await ctx.io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT.ok;
  }
  await ctx.io.stdout(
    t("cli.db.restore.done", {
      backupDir: report.backupDir,
      blobsAdded: String(report.blobsAdded),
    }),
  );
  if (report.previousDir !== null) {
    await ctx.io.stdout(t("cli.db.restore.previous", { previousDir: report.previousDir }));
  }
  const lines: string[] = [];
  if (report.recovered !== null) {
    lines.push(t("cli.db.restore.recovered", { direction: report.recovered }));
  }
  for (const sha256 of report.missingBlobs.slice(0, MISSING_LIST_CAP)) {
    lines.push(t("cli.db.export.missingBlob", { sha256 }));
  }
  const rest = report.missingBlobs.length - MISSING_LIST_CAP;
  if (rest > 0) {
    lines.push(
      t("cli.db.export.missingRest", {
        rest: String(rest),
        total: String(report.missingBlobs.length),
      }),
    );
  }
  lines.push(t("cli.db.restore.secretsNotice"));
  await ctx.io.stderr(lines.join(""));
  return EXIT.ok;
}

async function runExport(ctx: CommandContext, command: ExportCommand): Promise<ExitCode> {
  const dataDir = ctx.deps.resolveDataDir();
  if (dataDir === null) {
    const failure = dataDirFailure();
    await printFailure(ctx.io, failure);
    return failure.code;
  }
  // 사본의 저장소 파일에는 시크릿 값이 그대로 있을 수 있다. 화면 가림은 파일에 적용되지 않는다(L0.secrets.spec §3.5.1).
  // 확인 규칙은 `sessions rm`, `secret rm`과 같다: --yes가 없으면 터미널에서 묻고, 터미널이 아니면 종료 코드 2로 거부한다
  if (!command.yes) {
    if (!ctx.io.terminal.stdinIsTty) {
      await printFailure(ctx.io, {
        message: t("cli.db.export.noTerminal.message"),
        fix: t("cli.db.export.yesFix"),
      });
      return EXIT.usage;
    }
    await ctx.io.stderr(`${t("cli.db.export.warning")}\n`);
    if (!(await confirmed(ctx, t("cli.db.export.confirm")))) {
      await ctx.io.stderr(`${t("cli.db.export.kept")}\n`);
      return EXIT.error;
    }
  } else if (command.output === "text") {
    // --json이면 stdout만 쓴다(누락 블롭 경고와 같은 규칙)
    await ctx.io.stderr(`${t("cli.db.export.warning")}\n`);
  }
  // 대상 폴더는 작업 폴더(-C, 없으면 현재 폴더) 기준이다
  const destDir = resolve(ctx.workspace, command.destDir);
  const exported = await ctx.deps.exportDatabase({
    dbPath: join(dataDir, DB_FILE_NAME),
    destDir,
    clock: ctx.deps.clock,
  });
  if (!exported.ok) {
    const failure = failureOfExport(exported.error);
    await printFailure(ctx.io, failure);
    return failure.code;
  }
  const report = exported.value;
  if (command.output === "json") {
    await ctx.io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    return EXIT.ok;
  }
  await ctx.io.stdout(`exported ${String(report.blobCount)} blobs to ${report.destDir}\n`);
  // 누락 블롭은 내보내기를 실패로 만들지 않는다. 경고로 알리고 종료 코드는 0이다
  const shown = report.missingBlobs.slice(0, MISSING_LIST_CAP);
  const rest = report.missingBlobs.length - shown.length;
  const lines = shown.map((sha256) => t("cli.db.export.missingBlob", { sha256 }));
  if (rest > 0) {
    lines.push(
      t("cli.db.export.missingRest", {
        rest: String(rest),
        total: String(report.missingBlobs.length),
      }),
    );
  }
  if (lines.length > 0) await ctx.io.stderr(lines.join(""));
  return EXIT.ok;
}
