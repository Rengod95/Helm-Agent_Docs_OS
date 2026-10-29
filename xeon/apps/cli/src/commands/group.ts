import { join, resolve } from "node:path";
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
    message: `${error.path}을 읽거나 쓰지 못했다: ${error.message}`,
    fix: "설치 위치와 권한을 확인한다. 템플릿은 XEON_GROUP_TEMPLATES_DIR로 고칠 수 있다",
    code: EXIT.environment,
  };
}

function brokenTemplates(detail: string): Failure {
  return {
    message: `그룹 템플릿이 잘못됐다: ${detail}`,
    fix: "xeon을 다시 설치하거나 XEON_GROUP_TEMPLATES_DIR가 templates 폴더를 가리키는지 확인한다",
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
    return err(brokenTemplates(`색인 경로가 템플릿 밖을 가리킨다: ${unsafe}`));
  const reads = await Promise.all(rels.map((rel) => port.readTemplateFile(rel)));
  const planned: PlannedFile[] = [];
  for (const [index, read] of reads.entries()) {
    if (!read.ok) return err(environmentFailure(read.error));
    const rel = rels[index] ?? "";
    const target = targetPathOf(rel);
    if (target === null) return err(brokenTemplates(`색인 경로에 묶음 이름만 있다: ${rel}`));
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
  if (!json.ok) return "JSON이 아니다";
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
    : { ...failure, fix: `${failure.fix}. 남은 파일을 직접 지운다: ${target}` };
}

async function createGroup(
  ctx: CommandContext,
  command: GroupNewCommand,
): Promise<Result<CreatedGroup, Failure>> {
  const port = ctx.deps.groupTemplates;
  const indexText = await port.readIndex();
  if (!indexText.ok) return err(environmentFailure(indexText.error));
  const index = parseTemplateIndex(indexText.value);
  if (!index.ok) return err(brokenTemplates(`색인 ${index.error}`));

  const installed = await port.installedExtensionNames(ctx.workspace);
  if (!installed.ok) return err(environmentFailure(installed.error));
  if (installed.value.includes(command.name)) {
    return err({
      message: `"${command.name}"은 설치된 확장 이름과 겹친다`,
      fix: "다른 이름을 고른다",
      code: EXIT.usage,
    });
  }

  const target = resolve(ctx.workspace, command.dir ?? command.name);
  const state = await port.targetState(target);
  if (!state.ok) return err(environmentFailure(state.error));
  if (state.value === "occupied") {
    return err({
      message: `대상 폴더가 비어 있지 않다: ${target}`,
      fix: "빈 폴더를 주거나 --dir로 다른 폴더를 고른다",
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
  if (manifest === undefined) return err(brokenTemplates(`템플릿에 ${MANIFEST_PATH}가 없다`));

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
        message: `생성한 ${MANIFEST_PATH}이 검사를 통과하지 못했다: ${problem}`,
        fix: "생성 결과는 지웠다. 템플릿의 매니페스트를 고친다",
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
    `그룹 ${command.name}을 만들었다: ${created.target} (${command.template}, 파일 ${String(created.files.length)}개)`,
    ...created.files.map((file) => `  ${file}`),
    "다음 단계",
    `  cd ${created.target}`,
    "  bun install   의존을 설치한다. 생성 명령은 의존을 적거나 설치하지 않는다",
    "  bun test      생성된 시험을 돌린다",
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
