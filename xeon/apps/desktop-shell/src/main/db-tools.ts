// 설정 > 고급의 백업 만들기·저장 공간 보기·복원 전 사본 지우기·데이터 폴더 열기(fxDL).
// 모두 사이드카 CLI(`fresnel db export|usage|previous-rm`)를 한 번 돌려 종료 코드와 두 출력을 그대로 돌려준다. 엔진은 건드리지 않는다.
// 렌더러가 경로를 마음대로 열거나 지우게 하지 않는다: 열 폴더는 CLI가 알려 준 데이터 폴더 하나뿐이고, 지울 사본은 이름 형식을 셸이 먼저 본다.
import path from "node:path";
import { attemptAsync, parseJson } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellContext, ShellModule } from "./context.ts";
import type { Launcher, OnceOutput } from "./engine/launcher.ts";
import { fail } from "./engine/state.ts";
import { validateBackupDir } from "./engine/relay.ts";
import { ownField } from "./lib/narrow.ts";

/** 폴더를 OS로 연다. 실패하면 오류 글이 오고 성공하면 빈 글이다(electron `shell.openPath`와 같다) */
type OpenPath = (target: string) => Promise<string>;

export interface DbToolsDeps {
  /** 이 ctx에서 한 번 돌리는 수단. 운영은 `pipedLauncher`, 시험은 가짜다 */
  readonly launcherOf: (ctx: ShellContext) => Launcher;
  readonly open: OpenPath;
  readonly now: () => Date;
}

/** `restore-previous/` 아래 폴더 이름(`db restore`가 만드는 UTC 시각). CLI도 같은 형식만 받는다 */
const PREVIOUS_NAME = /^\d{8}T\d{9}Z$/u;

/** 백업을 만들 새 폴더 이름. 고른 폴더 안에 UTC 시각으로 만든다(없는 폴더라 `db export`가 비어 있음 검사를 통과한다) */
export function backupFolderName(now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "")
    .replace("T", "-");
  return `fresnel-backup-${stamp}`;
}

async function runOnce(launcher: Launcher, args: readonly string[]): Promise<OnceOutput> {
  const ran = await launcher.runOnce(args);
  if (!ran.ok) fail("storage-failed");
  return ran.value;
}

function replyOf(output: OnceOutput): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode: output.exitCode, stdout: output.stdout, stderr: output.stderr };
}

export function createDbToolsModule(deps: DbToolsDeps): ShellModule {
  return {
    name: "db-tools",
    register(ctx) {
      const launcher = deps.launcherOf(ctx);

      ctx.handle("db_export", async (_caller, args) => {
        const parent = ownField(args, "parent");
        if (typeof parent !== "string") fail("bad-request");
        if (validateBackupDir(parent) !== null || !path.isAbsolute(parent)) fail("bad-request");
        const dest = path.join(parent, backupFolderName(deps.now()));
        return replyOf(await runOnce(launcher, ["db", "export", dest, "--json", "--yes"]));
      });

      ctx.handle("db_usage", async () =>
        replyOf(await runOnce(launcher, ["db", "usage", "--json"])),
      );

      ctx.handle("db_previous_remove", async (_caller, args) => {
        const name = ownField(args, "name");
        if (typeof name !== "string" || !PREVIOUS_NAME.test(name)) fail("bad-request");
        return replyOf(await runOnce(launcher, ["db", "previous-rm", name, "--yes", "--json"]));
      });

      ctx.handle("open_data_dir", async () => {
        const output = await runOnce(launcher, ["db", "usage", "--json"]);
        if (output.exitCode !== 0) throw new ShellError("open_failed");
        const parsed = parseJson(output.stdout);
        const dataDir = parsed.ok ? ownField(parsed.value, "dataDir") : undefined;
        if (typeof dataDir !== "string" || !path.isAbsolute(dataDir))
          throw new ShellError("open_failed");
        const opened = await attemptAsync(() => deps.open(dataDir));
        if (!opened.ok || opened.value !== "") throw new ShellError("open_failed");
        return null;
      });
    },
  };
}
