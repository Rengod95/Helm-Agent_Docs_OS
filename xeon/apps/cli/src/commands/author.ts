import { resolve } from "node:path";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { DevkitIssue } from "@fresnel/contracts/services";
import type { AuthorCommand, OutputMode } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { printFailure, withEngine, type CommandContext } from "./context.ts";

// L3.authoring.spec §4.5 `fresnel author <명령>`, L4.cli.spec §3.1. 모델 없이 도는 제작 명령이다.
// 엔진의 wire(`ext.scaffold`, `ext.validate`, `ext.package`, `ext.installPreview`, `ext.install`, `ext.removePreview`, `ext.remove`, `ext.list`)를
// 그대로 부른다: 이 명령은 `@fresnel/plugin-builder`를 직접 읽지 않는다(DR-10). 종료 코드는 검사 실패가 1, 인자와 확인 거부가 2다.

async function writeJson(ctx: CommandContext, body: unknown): Promise<void> {
  await ctx.io.stdout(`${JSON.stringify(body, null, 2)}\n`);
}

/** 검사 결과 줄: `<심각도> <코드> <경로>: <메시지>`. 필드(경로)와 코드가 줄마다 보인다 */
function issueLine(issue: DevkitIssue): string {
  const place =
    issue.file === undefined
      ? ""
      : ` (${issue.file}${issue.line === undefined ? "" : `:${issue.line}`})`;
  return `  ${issue.severity} ${issue.code} ${issue.path === "" ? "/" : issue.path}: ${issue.message}${place}`;
}

async function printIssues(ctx: CommandContext, issues: readonly DevkitIssue[]): Promise<void> {
  if (issues.length === 0) return;
  await ctx.io.stderr(`${issues.map(issueLine).join("\n")}\n`);
}

/** 확인 질문. 답이 y 또는 yes일 때만 참이다(db export와 같다) */
async function asked(ctx: CommandContext, question: string): Promise<boolean> {
  const answer = await ctx.io.readLine(`${question} [y/N] `, new AbortController().signal);
  const text = answer?.trim().toLowerCase() ?? "";
  return text === "y" || text === "yes";
}

/** `--yes`가 없으면 터미널에서 묻고, 터미널이 아니면 2로 거부한다. 통과하면 null, 아니면 종료 코드 */
async function confirmOrRefuse(
  ctx: CommandContext,
  yes: boolean,
  question: string,
  fix: string,
): Promise<ExitCode | null> {
  if (yes) return null;
  if (!ctx.io.terminal.stdinIsTty) {
    await printFailure(ctx.io, { message: t("cli.author.noTerminal.message"), fix });
    return EXIT.usage;
  }
  if (await asked(ctx, question)) return null;
  await ctx.io.stderr(`${t("cli.author.declined")}\n`);
  return EXIT.error;
}

async function runScaffold(
  ctx: CommandContext,
  handle: EngineHandle,
  command: Extract<AuthorCommand, { kind: "author.scaffold" }>,
): Promise<ExitCode> {
  const dir = resolve(ctx.workspace, command.dir);
  const made = await handle.connection.request("ext.scaffold", {
    kind: command.extensionKind,
    name: command.name,
    dir,
  });
  if (command.output === "json") {
    await writeJson(ctx, { name: command.name, kind: command.extensionKind, ...made });
    return EXIT.ok;
  }
  const lines = [
    t("cli.author.scaffold.header", {
      name: command.name,
      dir: made.dir,
      count: made.files.length,
    }),
    ...made.files.map((file) => `  ${file}`),
    t("cli.author.scaffold.next", { dir: made.dir }),
  ];
  await ctx.io.stdout(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

/** 검사 결과를 보이고, 오류가 있으면 1이다. 경고만 있으면 통과다 */
async function runValidate(
  ctx: CommandContext,
  handle: EngineHandle,
  dir: string,
  output: OutputMode,
): Promise<ExitCode> {
  const target = resolve(ctx.workspace, dir);
  const report = await handle.connection.request("ext.validate", { dir: target });
  if (output === "json") {
    await writeJson(ctx, { dir: target, ...report });
    return report.ok ? EXIT.ok : EXIT.error;
  }
  await printIssues(ctx, report.issues);
  if (!report.ok) {
    const errors = report.issues.filter((issue) => issue.severity === "error").length;
    await printFailure(ctx.io, {
      message: t("cli.author.validate.failed", { dir: target, count: errors }),
      fix: t("cli.author.validate.fix"),
    });
    return EXIT.error;
  }
  await ctx.io.stdout(`${t("cli.author.validate.ok", { dir: target })}\n`);
  return EXIT.ok;
}

async function runPack(
  ctx: CommandContext,
  handle: EngineHandle,
  command: Extract<AuthorCommand, { kind: "author.pack" }>,
): Promise<ExitCode> {
  const dir = resolve(ctx.workspace, command.dir);
  // 검사 오류가 있으면 만들지 않는다. 이유를 줄마다 보이려고 먼저 검사한다
  const report = await handle.connection.request("ext.validate", { dir });
  if (!report.ok) {
    if (command.output === "json") await writeJson(ctx, { dir, ...report });
    else await printIssues(ctx, report.issues);
    await printFailure(ctx.io, {
      message: t("cli.author.pack.refused", { dir }),
      fix: t("cli.author.validate.fix"),
    });
    return EXIT.error;
  }
  const out = command.out === null ? undefined : resolve(ctx.workspace, command.out);
  const packed = await handle.connection.request("ext.package", {
    dir,
    ...(out === undefined ? {} : { out }),
  });
  if (command.output === "json") {
    await writeJson(ctx, packed);
    return EXIT.ok;
  }
  const lines = [
    t("cli.author.pack.header", { path: packed.path, count: packed.files.length }),
    ...packed.files.map((file) => `  ${file}`),
    `sha256 ${packed.sha256}`,
    t("cli.author.pack.next", { path: packed.path }),
  ];
  await ctx.io.stdout(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

async function runInstall(
  ctx: CommandContext,
  handle: EngineHandle,
  command: Extract<AuthorCommand, { kind: "author.install" }>,
): Promise<ExitCode> {
  const source = resolve(ctx.workspace, command.dir);
  const preview = await handle.connection.request("ext.installPreview", { source });
  if (command.output === "text") {
    const lines = [
      t("cli.author.install.preview", {
        name: preview.name,
        version: preview.version,
        sha256: preview.sha256,
      }),
      ...(preview.installedVersion === null
        ? []
        : [t("cli.author.install.replaces", { version: preview.installedVersion })]),
      ...(preview.hooks.length === 0
        ? []
        : [t("cli.author.install.hooks", { list: preview.hooks.join(", ") })]),
      ...(preview.network.length === 0
        ? []
        : [t("cli.author.install.network", { list: preview.network.join(", ") })]),
      ...(preview.files.length === 0
        ? []
        : [t("cli.author.install.files", { list: preview.files.join(", ") })]),
      ...(preview.shell.length === 0
        ? []
        : [t("cli.author.install.shell", { list: preview.shell.join(", ") })]),
    ];
    await ctx.io.stderr(`${lines.join("\n")}\n`);
    await printIssues(ctx, preview.warnings);
  }
  const refused = await confirmOrRefuse(
    ctx,
    command.yes,
    t("cli.author.install.confirm", { name: preview.name }),
    t("cli.author.yesFix", { command: `fresnel author install ${command.dir} --yes` }),
  );
  if (refused !== null) return refused;
  const installed = await handle.connection.request("ext.install", {
    source,
    sha256: preview.sha256,
  });
  if (command.output === "json") {
    await writeJson(ctx, { ...installed, sha256: preview.sha256 });
    return EXIT.ok;
  }
  await ctx.io.stdout(
    `${t("cli.author.install.done", {
      name: installed.name,
      version: installed.version,
      location: installed.location,
    })}\n`,
  );
  return EXIT.ok;
}

async function runRemove(
  ctx: CommandContext,
  handle: EngineHandle,
  command: Extract<AuthorCommand, { kind: "author.remove" }>,
): Promise<ExitCode> {
  const preview = await handle.connection.request("ext.removePreview", { name: command.name });
  if (command.output === "text" && command.dropData) {
    const rows = preview.tables.reduce((sum, table) => sum + table.rows, 0);
    await ctx.io.stderr(
      `${t("cli.author.remove.dataWarning", { tables: preview.tables.length, rows })}\n`,
    );
  }
  const refused = await confirmOrRefuse(
    ctx,
    command.yes,
    t("cli.author.remove.confirm", { name: command.name }),
    t("cli.author.yesFix", { command: `fresnel author remove ${command.name} --yes` }),
  );
  if (refused !== null) return refused;
  const removed = await handle.connection.request("ext.remove", {
    name: command.name,
    ...(command.dropData ? { dropData: true } : {}),
  });
  if (command.output === "json") {
    await writeJson(ctx, removed);
    return EXIT.ok;
  }
  await ctx.io.stdout(`${t("cli.author.remove.done", { name: removed.name })}\n`);
  return EXIT.ok;
}

async function runLs(
  ctx: CommandContext,
  handle: EngineHandle,
  output: OutputMode,
): Promise<ExitCode> {
  const listed = await handle.connection.request("ext.list", {});
  // 설치한 확장만: 내장과 관리형은 제작 대상이 아니다
  const installed = listed.extensions.filter((entry) => entry.origin === "user");
  if (output === "json") {
    await writeJson(
      ctx,
      installed.map((entry) => ({
        name: entry.name,
        version: entry.version,
        displayName: entry.displayName,
        location: entry.location,
        status: entry.status,
        isGroup: entry.isGroup,
      })),
    );
    return EXIT.ok;
  }
  if (installed.length === 0) {
    await ctx.io.stdout(`${t("cli.author.ls.empty")}\n`);
    return EXIT.ok;
  }
  const lines = installed.map(
    (entry) => `${entry.name}  ${entry.version}  ${entry.status}  ${entry.location}`,
  );
  await ctx.io.stdout(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

/** `fresnel author <명령>` 본체. 실패는 두 줄 오류로 쓰고 종료 코드를 돌려준다 */
export async function runAuthor(ctx: CommandContext, command: AuthorCommand): Promise<ExitCode> {
  return withEngine(ctx, (handle) => {
    switch (command.kind) {
      case "author.scaffold":
        return runScaffold(ctx, handle, command);
      case "author.validate":
        return runValidate(ctx, handle, command.dir, command.output);
      case "author.pack":
        return runPack(ctx, handle, command);
      case "author.install":
        return runInstall(ctx, handle, command);
      case "author.remove":
        return runRemove(ctx, handle, command);
      case "author.ls":
        return runLs(ctx, handle, command.output);
      default:
        return assertNever(command, "AuthorCommand");
    }
  });
}
