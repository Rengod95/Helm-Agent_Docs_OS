import { join, resolve } from "node:path";
import { t } from "@xeon/client/i18n";
import { err, ok, parseJson, type Result } from "@xeon/contracts";
import { validateManifest } from "@xeon/contracts/extensions";
import type { GroupNewCommand } from "../cli/command.ts";
import {
  DEFAULT_GROUP_VERSION,
  fillPlaceholders,
  isSafeRelativePath,
  parseTemplateIndex,
  targetPathOf,
  type PlaceholderValues,
} from "../group/rules.ts";
import type { Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { GroupIoError, GroupTemplatesPort } from "../io.ts";
import { printFailure, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 `xeon group new`, §3.8. L3.slots.spec §3.3.6 요구 R1~R6.
// 순서: 색인 읽기 → 설치된 이름과 겹침 검사(R2) → 대상 폴더 검사(R3) → 템플릿 읽기와 치환(메모리) → 쓰기 →
// 매니페스트 검사(R4, 실패하면 쓴 것을 지운다) → 안내(R5). 템플릿 코드는 실행하지 않는다(R5).

/** 외부 그룹의 매니페스트 위치(L3.slots.spec §3.3.2) */
const MANIFEST_PATH = ".xeon-plugin/plugin.json";

interface PlannedFile {
  /** 대상 폴더 기준 상대 경로(치환 끝난 값) */
  readonly path: string;
  readonly text: string;
}

interface CreatedGroup {
  readonly target: string;
  readonly files: readonly string[];
}

function environmentFailure(error: GroupIoError): Failure {
  return {
    message: t("cli.errors.group.io.message", { path: error.path, message: error.message }),
    fix: t("cli.errors.group.io.fix"),
    code: EXIT.environment,
  };
}

function brokenTemplates(detail: string): Failure {
  return {
    message: t("cli.errors.group.brokenTemplates.message", { detail }),
    fix: t("cli.errors.group.brokenTemplates.fix"),
    code: EXIT.environment,
  };
}

/** 템플릿 파일들을 메모리에 읽고 치환해 계획을 만든다. 쓰기는 하지 않는다 */
async function planFiles(
  port: GroupTemplatesPort,
  rels: readonly string[],
  values: PlaceholderValues,
): Promise<Result<readonly PlannedFile[], Failure>> {
  const unsafe = rels.find((rel) => !isSafeRelativePath(rel));
  if (unsafe !== undefined)
    return err(brokenTemplates(t("cli.group.detail.unsafePath", { path: unsafe })));
  const reads = await Promise.all(rels.map((rel) => port.readTemplateFile(rel)));
  const planned: PlannedFile[] = [];
  for (const [index, read] of reads.entries()) {
    if (!read.ok) return err(environmentFailure(read.error));
    const rel = rels[index] ?? "";
    const target = targetPathOf(rel);
    if (target === null) return err(brokenTemplates(t("cli.group.detail.nameOnly", { path: rel })));
    planned.push({
      path: fillPlaceholders(target, values),
      text: fillPlaceholders(new TextDecoder().decode(read.value), values),
    });
  }
  return ok(planned);
}

/** 매니페스트 검사(F validateManifest). 문제가 없으면 null, 있으면 첫 오류 한 줄이다 */
function manifestProblemOf(text: string): string | null {
  const json = parseJson(text);
  if (!json.ok) return t("cli.state.discarded.notJson");
  const checked = validateManifest(json.value);
  const first = checked.issues.find((issue) => issue.severity === "error");
  return first === undefined ? null : `${first.path} ${first.message}`;
}

/** 쓰다가 실패하거나 검사에 걸리면 만든 것을 지운다. 지우지 못하면 실패 안내에 남은 경로를 붙인다 */
async function rollback(
  port: GroupTemplatesPort,
  target: string,
  keepRoot: boolean,
  failure: Failure,
): Promise<Failure> {
  const removed = await port.removeDir(target, { keepRoot });
  return removed.ok
    ? failure
    : { ...failure, fix: t("cli.errors.group.leftover.fix", { fix: failure.fix, target }) };
}

async function createGroup(
  ctx: CommandContext,
  command: GroupNewCommand,
): Promise<Result<CreatedGroup, Failure>> {
  const port = ctx.deps.groupTemplates;
  const indexText = await port.readIndex();
  if (!indexText.ok) return err(environmentFailure(indexText.error));
  const index = parseTemplateIndex(indexText.value);
  if (!index.ok) return err(brokenTemplates(t("cli.group.detail.index", { reason: index.error })));

  const installed = await port.installedExtensionNames(ctx.workspace);
  if (!installed.ok) return err(environmentFailure(installed.error));
  if (installed.value.includes(command.name)) {
    return err({
      message: t("cli.errors.group.nameTaken.message", { name: command.name }),
      fix: t("cli.errors.group.nameTaken.fix"),
      code: EXIT.usage,
    });
  }

  const target = resolve(ctx.workspace, command.dir ?? command.name);
  const state = await port.targetState(target);
  if (!state.ok) return err(environmentFailure(state.error));
  if (state.value === "occupied") {
    return err({
      message: t("cli.errors.group.targetOccupied.message", { target }),
      fix: t("cli.errors.group.targetOccupied.fix"),
      code: EXIT.usage,
    });
  }
  // 처음부터 있던 빈 폴더는 실패해도 지우지 않는다
  const keepRoot = state.value === "empty";

  const values: PlaceholderValues = {
    id: command.name,
    title: command.name,
    version: DEFAULT_GROUP_VERSION,
  };
  const entry = index.value.templates[command.template];
  const planned = await planFiles(port, entry.files, values);
  if (!planned.ok) return err(planned.error);
  const manifest = planned.value.find((file) => file.path === MANIFEST_PATH);
  if (manifest === undefined)
    return err(brokenTemplates(t("cli.group.detail.noManifest", { path: MANIFEST_PATH })));

  const made = await port.makeDir(target);
  if (!made.ok) return err(await rollback(port, target, keepRoot, environmentFailure(made.error)));
  const written = await Promise.all(
    planned.value.map((file) =>
      port.writeFile(join(target, file.path), new TextEncoder().encode(file.text)),
    ),
  );
  const [firstFailure] = written.flatMap((result) => (result.ok ? [] : [result.error]));
  if (firstFailure !== undefined) {
    return err(await rollback(port, target, keepRoot, environmentFailure(firstFailure)));
  }

  const problem = manifestProblemOf(manifest.text);
  if (problem !== null) {
    return err(
      await rollback(port, target, keepRoot, {
        message: t("cli.errors.group.manifestCheck.message", { path: MANIFEST_PATH, problem }),
        fix: t("cli.errors.group.manifestCheck.fix"),
        code: EXIT.usage,
      }),
    );
  }
  return ok({ target, files: planned.value.map((file) => file.path) });
}

async function printCreated(
  ctx: CommandContext,
  command: GroupNewCommand,
  created: CreatedGroup,
): Promise<void> {
  if (command.output === "json") {
    const body = {
      name: command.name,
      template: command.template,
      dir: created.target,
      files: created.files,
    };
    await ctx.io.stdout(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }
  const lines = [
    t("cli.group.created.header", {
      name: command.name,
      target: created.target,
      template: command.template,
      count: created.files.length,
    }),
    ...created.files.map((file) => `  ${file}`),
    t("cli.group.created.nextSteps"),
    `  cd ${created.target}`,
    t("cli.group.created.installHint"),
    t("cli.group.created.testHint"),
  ];
  await ctx.io.stdout(`${lines.join("\n")}\n`);
}

/** `xeon group new` 본체. 실패는 두 줄 오류로 쓰고 종료 코드를 돌려준다 */
export async function runGroup(ctx: CommandContext, command: GroupNewCommand): Promise<ExitCode> {
  const created = await createGroup(ctx, command);
  if (!created.ok) {
    await printFailure(ctx.io, created.error);
    return created.error.code;
  }
  await printCreated(ctx, command, created.value);
  return EXIT.ok;
}
