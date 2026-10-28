import { parse, type Logger } from "@xeon/contracts";
import {
  COMMAND_NAME_PATTERN,
  CommandArgSchema,
  type CommandArg,
  type CommandInfo,
  type CommandSource,
} from "@xeon/contracts/capabilities";
import type { CancelScope } from "@xeon/contracts/services";
import { Type } from "typebox";
import type { CommandFiles } from "../ports/command-files.ts";
import {
  loadTemplatesFromDir,
  type CommandDiagnostic,
  type PromptTemplate,
} from "../upstream/pi/prompt-templates.ts";
import { MAX_SHELL_INJECTIONS, shellCommands, splitShell, type TemplateSegment } from "./shell.ts";

// L2.dialog.spec §4.2.1. 명령 파일 하나가 명령 하나다. 읽기는 포트(`xeon.exec`의 파일 시스템)로 한다.
// pi 포크(`upstream/pi/prompt-templates.ts`)를 감싸 이름 규칙, `args` 앞머리, 셸 자리를 더한다.

const NAME_PATTERN = new RegExp(COMMAND_NAME_PATTERN);
const ArgsSchema = Type.Array(CommandArgSchema, { maxItems: 16 });

/** 등록된 명령 하나. 템플릿이면 `segments`, 동작이면 `handler`를 가진다 */
export interface CommandEntry {
  readonly info: CommandInfo;
  readonly segments?: readonly TemplateSegment[];
}

export interface CommandDir {
  readonly dir: string;
  readonly source: CommandSource;
}

interface LoadedCommands {
  readonly entries: readonly CommandEntry[];
  readonly diagnostics: readonly CommandDiagnostic[];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** 템플릿 본문에서 셸 자리를 찾아 한도를 검사한다. 넘으면 undefined다 */
export function templateSegments(content: string): TemplateSegment[] | undefined {
  const segments = splitShell(content);
  return shellCommands(segments).length > MAX_SHELL_INJECTIONS ? undefined : segments;
}

export function isCommandName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

function argsOf(template: PromptTemplate): { args: CommandArg[]; diagnostic?: CommandDiagnostic } {
  if (template.rawArgs === undefined || template.rawArgs === null) return { args: [] };
  const parsed = parse(ArgsSchema, template.rawArgs);
  if (!parsed.ok) {
    return {
      args: [],
      diagnostic: {
        type: "warning",
        message: "the args frontmatter is ignored: it does not match the argument declaration",
        path: template.filePath,
      },
    };
  }
  return { args: parsed.value };
}

function entryOf(
  template: PromptTemplate,
  source: CommandSource,
): { entry?: CommandEntry; diagnostics: CommandDiagnostic[] } {
  const diagnostics: CommandDiagnostic[] = [];
  if (!isCommandName(template.name)) {
    diagnostics.push({
      type: "warning",
      message: `the file name "${template.name}" is not a valid command name`,
      path: template.filePath,
    });
    return { diagnostics };
  }
  const segments = templateSegments(template.content);
  if (segments === undefined) {
    diagnostics.push({
      type: "warning",
      message: `the template has more than ${MAX_SHELL_INJECTIONS} shell injections`,
      path: template.filePath,
    });
    return { diagnostics };
  }
  const { args, diagnostic } = argsOf(template);
  if (diagnostic !== undefined) diagnostics.push(diagnostic);
  return {
    entry: {
      info: {
        name: template.name,
        description: truncate(template.description, 200),
        argumentHint:
          template.argumentHint === undefined ? null : truncate(template.argumentHint, 120),
        args,
        kind: "template",
        source,
        origin: truncate(template.filePath, 512),
        hasShell: shellCommands(segments).length > 0,
      },
      segments,
    },
    diagnostics,
  };
}

/**
 * 명령 디렉터리를 읽는다. 디렉터리마다 파일 이름·크기·수정 시각이 같으면 앞서 해석한 결과를 다시 쓴다.
 * 파일을 읽지 못하거나 앞머리 YAML이 틀린 파일은 건너뛰고 진단만 남긴다(spec §5 6번).
 */
export interface CommandLoader {
  load(dirs: readonly CommandDir[], context: CancelScope): Promise<LoadedCommands>;
}

export function createCommandLoader(files: CommandFiles, logger: Logger): CommandLoader {
  const cache = new Map<string, { signature: string; result: LoadedCommands }>();

  async function loadDir(dir: CommandDir, context: CancelScope): Promise<LoadedCommands> {
    const listing = await files.listDir(dir.dir, context);
    const signature = listing.ok
      ? listing.value
          .filter((entry) => entry.name.endsWith(".md"))
          .map((entry) => `${entry.name}:${entry.size}:${entry.mtimeMs}`)
          .toSorted()
          .join("|")
      : `error:${listing.error.code}`;
    const key = `${dir.source}\0${dir.dir}`;
    const cached = cache.get(key);
    if (cached?.signature === signature) return cached.result;
    const loaded = await loadTemplatesFromDir(files, dir.dir, context);
    const entries: CommandEntry[] = [];
    const diagnostics: CommandDiagnostic[] = [...loaded.diagnostics];
    for (const template of loaded.templates) {
      const made = entryOf(template, dir.source);
      if (made.entry !== undefined) entries.push(made.entry);
      diagnostics.push(...made.diagnostics);
    }
    for (const diagnostic of diagnostics) {
      logger.warn("dialog.command_file_skipped", {
        path: diagnostic.path,
        message: diagnostic.message,
      });
    }
    const result: LoadedCommands = { entries, diagnostics };
    cache.set(key, { signature, result });
    return result;
  }

  return {
    async load(dirs, context) {
      const loaded = await Promise.all(dirs.map((dir) => loadDir(dir, context)));
      return {
        entries: loaded.flatMap((item) => item.entries),
        diagnostics: loaded.flatMap((item) => item.diagnostics),
      };
    },
  };
}
