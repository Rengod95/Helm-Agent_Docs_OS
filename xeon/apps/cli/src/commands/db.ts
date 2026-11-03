import { join, resolve } from "node:path";
import { t } from "@fresnel/client/i18n";
import type { DbCommand } from "../cli/command.ts";
import { failureOfExport, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { printFailure, type CommandContext } from "./context.ts";

// L4.cli.spec §4.13. `fresnel db export <폴더>`는 엔진을 띄우지 않고 저장소 파일을 `exportDatabase`로 내보낸다.
// 원본은 읽기 전용으로만 열므로 엔진이 떠 있어도 된다. 위치는 데이터 디렉터리(OsDirs.data)의 저장소 파일이다.

/**
 * 저장소 파일 이름. 호스트가 같은 이름으로 연다(apps/host/src/assemble.ts의 DB_FILE_NAME).
 * 호스트가 이 이름을 내보내지 않아 여기 한 번 더 적는다 [미결: 호스트 공개 API로 옮기면 이 상수를 지운다]
 */
const DB_FILE_NAME = "fresnel.db";

/** 누락 블롭 경고를 목록으로 보이는 최대 줄 수. 넘으면 나머지는 개수 한 줄로 센다 */
const MISSING_LIST_CAP = 10;

/** 확인 질문. 답이 y 또는 yes일 때만 참이다(sessions rm과 같다) */
async function confirmed(ctx: CommandContext, question: string): Promise<boolean> {
  const answer = await ctx.io.readLine(`${question} [y/N] `, new AbortController().signal);
  const text = answer?.trim().toLowerCase() ?? "";
  return text === "y" || text === "yes";
}

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
  return runExport(ctx, command);
}

async function runExport(ctx: CommandContext, command: DbCommand): Promise<ExitCode> {
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
