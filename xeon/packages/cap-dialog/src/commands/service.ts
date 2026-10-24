import { eachAsync } from "@xeon/contracts";
import {
  DialogCommands,
  type CallOptions,
  type CapabilityApi,
  type CommandActionRegistry,
  type CommandArg,
  type CommandInfo,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { CancelScope } from "@xeon/contracts/services";
import type { DialogDeps } from "../deps.ts";
import { DialogFailure, guarded, toCapabilityError } from "../errors.ts";
import { PROJECT_COMMANDS_DIR } from "../ports/command-files.ts";
import { parseCommandArgs, parseCommandLine } from "../upstream/pi/prompt-templates.ts";
import { checkActionArgs } from "./action-args.ts";
import { createCommandLoader, isCommandName, templateSegments, type CommandDir } from "./loader.ts";
import { actionInfo, createCommandRegistry, type Candidate } from "./registry.ts";
import {
  renderPending,
  renderWithOutputs,
  shellCommands,
  substituteSegments,
  type TemplateSegment,
} from "./shell.ts";

// L2.dialog.spec §3.2, §4.2. 슬래시 명령: 템플릿 명령(pi 프롬프트 템플릿 형식)과 동작 명령. 모델은 명령을 호출하지 않는다.

type CommandsApi = CapabilityApi<typeof DialogCommands>;
type RunOutput = Awaited<ReturnType<CommandsApi["run"]>>;
type ExpandOutput = Awaited<ReturnType<CommandsApi["expand"]>>;

const CAPABILITY = DialogCommands.id;
const MAX_ADVERTISED = 50;

/** `dialog.commands` 능력 API에 TS 메서드를 더한 모양(spec §3.2). 클라이언트 고유 명령 선언도 같은 객체에 둔다 */
export interface CommandsServiceApi extends CommandsApi, CommandActionRegistry {
  /** 클라이언트(L4)가 `builtin` 출처 명령을 선언한다. 실행은 클라이언트가 한다. 반환 함수로 해제한다 */
  declareBuiltin(commands: readonly BuiltinCommandDecl[]): () => void;
}

export interface BuiltinCommandDecl {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly args?: readonly CommandArg[];
  readonly origin: string;
}

export interface CommandsService {
  readonly api: CommandsServiceApi;
  /** `input` 지점: `/`로 시작하는 입력 중 셸 주입이 없는 템플릿 명령만 치환한다. 그 밖은 undefined다 */
  transformInput(
    text: string,
    threadId: ThreadId,
    signal: AbortSignal,
  ): Promise<string | undefined>;
  /** `before_agent_start` 지점에 붙일 시스템 프롬프트 조각. 광고를 끄면 undefined다 */
  readonly advertisement: (threadId: ThreadId, signal: AbortSignal) => Promise<string | undefined>;
}

function threadOf(options: CallOptions | undefined, what: string): ThreadId {
  const threadId = options?.context?.threadId;
  if (threadId === undefined) {
    throw new DialogFailure(
      "invalid_input",
      `${what} needs a thread: the call context has no threadId.`,
    );
  }
  return threadId;
}

function requestIdOf(options: CallOptions | undefined, what: string): string {
  const requestId = options?.requestId;
  if (requestId === undefined) {
    throw new DialogFailure(
      "invalid_input",
      `${what} needs a requestId so that a retry does not run it twice.`,
    );
  }
  return requestId;
}

function expandTemplate(candidate: Candidate, args: string[]): TemplateSegment[] {
  return substituteSegments(candidate.segments ?? [], args);
}

export function createCommandsService(deps: DialogDeps): CommandsService {
  const registry = createCommandRegistry();
  const loader = createCommandLoader(deps.commandFiles, deps.logger);

  /** 설정 디렉터리 하나를 절대 경로로 푼다. `~/`는 홈, 상대 경로는 프로젝트 폴더 기준이다 */
  function resolveDir(raw: string, project: string | null): string | undefined {
    if (raw.startsWith("~/")) return `${deps.commandRoots.home}/${raw.slice(2)}`;
    if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) return raw;
    return project === null ? undefined : `${project}/${raw}`;
  }

  function dirsFor(threadId: ThreadId | undefined): CommandDir[] {
    const roots = deps.commandRoots;
    const project = roots.projectRoot(threadId);
    const dirs: CommandDir[] = [];
    if (project !== null)
      dirs.push({ dir: `${project}/${PROJECT_COMMANDS_DIR}`, source: "project" });
    dirs.push({ dir: roots.userDir, source: "user" });
    for (const raw of deps.settings(threadId).commands.dirs) {
      const dir = resolveDir(raw, project);
      if (dir !== undefined) dirs.push({ dir, source: "user" });
    }
    return dirs;
  }

  async function catalog(
    threadId: ThreadId | undefined,
    context: CancelScope,
  ): Promise<ReadonlyMap<string, readonly Candidate[]>> {
    const loaded = await loader.load(dirsFor(threadId), context);
    return registry.catalog(loaded.entries);
  }

  /** 이름의 첫 후보가 이긴 후보다. builtin이 이기면 클라이언트가 실행하므로 여기서는 명령으로 보지 않는다 */
  async function resolve(
    text: string,
    threadId: ThreadId | undefined,
    context: CancelScope,
  ): Promise<{ readonly candidate: Candidate; readonly args: string[] } | undefined> {
    const line = parseCommandLine(text);
    if (line === undefined) return undefined;
    const table = await catalog(threadId, context);
    const candidate = table.get(line.name)?.[0];
    if (candidate === undefined || candidate.info.source === "builtin") return undefined;
    return { candidate, args: parseCommandArgs(line.argsString) };
  }

  async function transformInput(
    text: string,
    threadId: ThreadId,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const found = await resolve(text, threadId, { abortSignal: signal });
    if (found === undefined || found.candidate.info.kind !== "template") return undefined;
    const segments = expandTemplate(found.candidate, found.args);
    // 셸 주입은 확인 없이 실행하지 않는다. 이 경로는 치환만 하고 효과를 내지 않는다(spec §4.2.4)
    return shellCommands(segments).length > 0 ? undefined : renderPending(segments);
  }

  async function runShell(
    commands: readonly string[],
    threadId: ThreadId,
    requestId: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const shell = deps.shell;
    if (shell === undefined) {
      throw new DialogFailure("unavailable", "The user shell is not available.", {
        detail: { by: "tools", reason: "shell_missing" },
      });
    }
    const outputs: string[] = [];
    // 앞 명령이 끝나야 다음을 시작한다
    await eachAsync(commands.entries(), async ([index, command]) => {
      const ran = await shell.run(command, {
        threadId,
        requestId: `${requestId}:sh${index}`,
        signal,
      });
      if (ran.ok) {
        outputs.push(ran.value.output.replace(/\n+$/, ""));
      } else if (ran.error.kind === "denied") {
        throw new DialogFailure("denied", `The shell command was denied: ${ran.error.message}`, {
          detail: { by: "tools", index, command },
        });
      } else {
        outputs.push(`[셸 오류: ${ran.error.code}]`);
      }
      return undefined;
    });
    return outputs;
  }

  const api: CommandsServiceApi = {
    register: (input) =>
      guarded(CAPABILITY, "register", () => {
        if (!isCommandName(input.name)) {
          return Promise.reject(
            new DialogFailure("invalid_input", `${input.name} is not a valid command name.`),
          );
        }
        const segments = templateSegments(input.template);
        if (segments === undefined) {
          return Promise.reject(
            new DialogFailure("invalid_input", "The template has too many shell injections."),
          );
        }
        const info: CommandInfo = {
          name: input.name,
          description: input.description.slice(0, 200),
          argumentHint: input.argumentHint === undefined ? null : input.argumentHint.slice(0, 120),
          args: [...(input.args ?? [])],
          kind: "template",
          source: "capability",
          origin: input.origin.slice(0, 512),
          hasShell: shellCommands(segments).length > 0,
        };
        registry.addTemplate(info, segments);
        return Promise.resolve({ command: info });
      }),
    list: (input, options) =>
      guarded(CAPABILITY, "list", async () => {
        const table = await catalog(options?.context?.threadId, { abortSignal: options?.signal });
        const prefix = input.prefix ?? "";
        const commands: CommandInfo[] = [];
        for (const name of [...table.keys()].toSorted()) {
          if (!name.startsWith(prefix)) continue;
          const candidates = table.get(name) ?? [];
          const shown = input.includeHidden === true ? candidates : candidates.slice(0, 1);
          commands.push(...shown.map((candidate) => candidate.info));
        }
        return { commands };
      }),
    expand: (input, options) =>
      guarded(CAPABILITY, "expand", async (): Promise<ExpandOutput> => {
        const found = await resolve(input.text, options?.context?.threadId, {
          abortSignal: options?.signal,
        });
        if (found === undefined) return { matched: false };
        const { info } = found.candidate;
        if (info.kind === "action") {
          return { matched: true, name: info.name, kind: "action", args: found.args };
        }
        const segments = expandTemplate(found.candidate, found.args);
        return {
          matched: true,
          name: info.name,
          kind: "template",
          args: found.args,
          text: renderPending(segments),
          shell: shellCommands(segments).map((command, index) => ({ index, command })),
        };
      }),
    run: (input, options) =>
      guarded(CAPABILITY, "run", async (): Promise<RunOutput> => {
        const signal = options?.signal ?? new AbortController().signal;
        const found = await resolve(input.text, options?.context?.threadId, {
          abortSignal: signal,
        });
        if (found === undefined) return { status: "not_command" };
        const { candidate, args } = found;
        const { info } = candidate;

        if (info.kind === "action") {
          const handler = candidate.handler;
          if (handler === undefined) return { status: "not_command" };
          const issue = checkActionArgs(info.args, args);
          if (issue !== undefined) {
            throw new DialogFailure("command_args_invalid", issue, { detail: { message: issue } });
          }
          const result = await handler(args, {
            threadId: threadOf(options, "An action command"),
            requestId: requestIdOf(options, "An action command"),
            signal,
          });
          return {
            status: "done",
            name: info.name,
            message: result.message,
            result: result.result ?? null,
          };
        }

        const segments = expandTemplate(candidate, args);
        const commands = shellCommands(segments);
        if (commands.length === 0) {
          return { status: "expanded", name: info.name, text: renderPending(segments) };
        }
        if (deps.settings(options?.context?.threadId).commands.shellInjection === "off") {
          throw new DialogFailure(
            "command_shell_disabled",
            "Shell injection in command templates is turned off.",
          );
        }
        if (input.confirmShell !== true) {
          return {
            status: "needs_confirmation",
            name: info.name,
            shell: commands.map((command, index) => ({ index, command })),
          };
        }
        const outputs = await runShell(
          commands,
          threadOf(options, "A shell command"),
          requestIdOf(options, "A shell command"),
          signal,
        );
        return { status: "expanded", name: info.name, text: renderWithOutputs(segments, outputs) };
      }),
    registerAction: (decl, handler) => {
      if (!isCommandName(decl.name)) {
        throw toCapabilityError(
          CAPABILITY,
          "registerAction",
          new DialogFailure("invalid_input", `${decl.name} is not a valid command name.`),
        );
      }
      try {
        return registry.addAction(actionInfo(decl), handler);
      } catch (caught) {
        throw toCapabilityError(CAPABILITY, "registerAction", caught);
      }
    },
    declareBuiltin: (commands) =>
      registry.declareBuiltin(
        commands.map((decl): CommandInfo => ({
          name: decl.name,
          description: decl.description.slice(0, 200),
          argumentHint: decl.argumentHint === undefined ? null : decl.argumentHint.slice(0, 120),
          args: [...(decl.args ?? [])],
          kind: "action",
          source: "builtin",
          origin: decl.origin.slice(0, 512),
          hasShell: false,
        })),
      ),
  };

  async function advertisement(
    threadId: ThreadId,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    if (!deps.settings(threadId).commands.advertise) return undefined;
    const table = await catalog(threadId, { abortSignal: signal });
    const lines = [...table.keys()]
      .toSorted()
      .slice(0, MAX_ADVERTISED)
      .flatMap((name) => {
        const first = table.get(name)?.[0];
        return first === undefined ? [] : [`- /${name}: ${first.info.description}`];
      });
    if (lines.length === 0) return undefined;
    return [
      "사용자가 입력창에서 쓸 수 있는 슬래시 명령이다. 모델은 명령을 실행하지 않는다. 필요하면 사용자에게 권할 수 있다.",
      ...lines,
    ].join("\n");
  }

  return { api, transformInput, advertisement };
}
