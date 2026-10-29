import { join, resolve } from "node:path";
import type { DbCommand } from "../cli/command.ts";
import { failureOfExport, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { printFailure, type CommandContext } from "./context.ts";

// L4.cli.spec §4.13. `xeon db export <폴더>`는 엔진을 띄우지 않고 저장소 파일을 `exportDatabase`로 내보낸다.
// 원본은 읽기 전용으로만 열므로 엔진이 떠 있어도 된다. 위치는 데이터 디렉터리(OsDirs.data)의 저장소 파일이다.

/**
 * 저장소 파일 이름. 호스트가 같은 이름으로 연다(apps/host/src/assemble.ts의 DB_FILE_NAME).
 * 호스트가 이 이름을 내보내지 않아 여기 한 번 더 적는다 [미결: 호스트 공개 API로 옮기면 이 상수를 지운다]
 */
const DB_FILE_NAME = "xeon.db";

/** 누락 블롭 경고를 목록으로 보이는 최대 줄 수. 넘으면 나머지는 개수 한 줄로 센다 */
const MISSING_LIST_CAP = 10;

const DATA_DIR_FAILURE: Failure = {
  message: "데이터 디렉터리 위치를 정하지 못했다",
  fix: "HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다",
  code: EXIT.environment,
};

/** `db` 명령군. 지금은 `export` 하나뿐이라 분기하지 않는다. 하위 명령을 더하면 여기서 나눈다 */
export async function runDb(ctx: CommandContext, command: DbCommand): Promise<ExitCode> {
  return runExport(ctx, command);
}

async function runExport(ctx: CommandContext, command: DbCommand): Promise<ExitCode> {
  const dataDir = ctx.deps.resolveDataDir();
  if (dataDir === null) {
    await printFailure(ctx.io, DATA_DIR_FAILURE);
    return DATA_DIR_FAILURE.code;
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
  const lines = shown.map((sha256) => `경고: 블롭 파일이 없어 빠졌다: ${sha256}\n`);
  if (rest > 0) {
    lines.push(
      `경고: 나머지 ${String(rest)}개도 빠졌다 (전체 ${String(report.missingBlobs.length)}개, manifest.json의 missingBlobs)\n`,
    );
  }
  if (lines.length > 0) await ctx.io.stderr(lines.join(""));
  return EXIT.ok;
}
