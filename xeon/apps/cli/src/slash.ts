import { assertNever, parse, type Result } from "@xeon/contracts";
import { ThreadIdSchema, type ThreadId } from "@xeon/contracts/conversation";
import { SETTING_KEY_PATTERN, type EffectiveSetting } from "@xeon/contracts/settings";
import type { HostConnection, ThreadSummary } from "@xeon/contracts/wire";
import { failureOfCaught, renderFailure, type Failure } from "./errors.ts";
import type { CliIo } from "./io.ts";
import { interpretRaw, showValue } from "./settings-input.ts";

// L4.cli.spec §4.12. 슬래시 명령은 설정 정의에서 만든다. 별칭 표는 이 파일의 상수 하나에 둔다.
// 키 이름이 없는 별칭은 등록하지 않는다.

export interface SlashAlias {
  /** 슬래시 이름(앞의 / 제외) */
  readonly name: string;
  /** 별칭이 가리키는 설정 키 */
  readonly key: string;
}

/** /model은 모델 선택 키의 별칭이다. 키 이름은 L1.models.spec이 소유한다 */
export const SLASH_ALIASES: readonly SlashAlias[] = [{ name: "model", key: "l1.models.default" }];

export type SlashCommand =
  | { readonly kind: "help" }
  | { readonly kind: "quit" }
  | { readonly kind: "set"; readonly key: string; readonly raw: string }
  | { readonly kind: "alias"; readonly alias: SlashAlias; readonly raw: string | null }
  | { readonly kind: "resume"; readonly target: string | null }
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "unknown"; readonly name: string };

const KEY_PATTERN = new RegExp(SETTING_KEY_PATTERN);

/** 슬래시로 시작하는 한 줄을 명령으로 읽는다. 순수 함수 */
export function parseSlash(line: string): SlashCommand {
  const text = line.trim();
  const space = text.search(/\s/);
  const name = (space < 0 ? text : text.slice(0, space)).slice(1);
  const rest = space < 0 ? "" : text.slice(space).trim();
  switch (name) {
    case "help":
      return { kind: "help" };
    case "quit":
    case "exit":
      return { kind: "quit" };
    case "set": {
      const split = rest.search(/\s/);
      const key = split < 0 ? rest : rest.slice(0, split);
      const raw = split < 0 ? "" : rest.slice(split).trim();
      if (key.length === 0 || raw.length === 0) {
        return { kind: "usage", message: "사용법: /set <키> <값>" };
      }
      if (!KEY_PATTERN.test(key)) {
        return { kind: "usage", message: `설정 키 형식이 아니다: ${key}` };
      }
      return { kind: "set", key, raw };
    }
    case "resume":
      return { kind: "resume", target: rest.length === 0 ? null : rest };
    // xeon-disable-next-line xeon/switch-default-never -- 슬래시 이름은 닫히지 않은 문자열이다. 별칭이 아니면 모르는 명령 값으로 돌려준다 (eng.typescript.guide TY-14)
    default: {
      const alias = SLASH_ALIASES.find((candidate) => candidate.name === name);
      if (alias !== undefined)
        return { kind: "alias", alias, raw: rest.length === 0 ? null : rest };
      return { kind: "unknown", name };
    }
  }
}

function slashHelp(): string {
  const aliases = SLASH_ALIASES.map(
    (alias) => `  /${alias.name} [<값>]   ${alias.key}를 보거나 이 세션에만 바꾼다`,
  );
  return [
    "슬래시 명령",
    "  /help   이 도움말",
    "  /quit   끝낸다 (Ctrl+D도 같다)",
    "  /set <키> <값>   이 세션에만 설정을 바꾼다 (Tab으로 키를 고른다)",
    ...aliases,
    "  /resume [<번호|id>]   세션 목록에서 골라 바꾼다",
    "",
  ].join("\n");
}

/**
 * Tab 완성 후보. `/set <접두>`는 session 범위를 허용하는 키만 넣는다. 슬래시 이름은 첫 단어에서 완성한다.
 * 순수 함수
 */
export function completionsOf(line: string, sessionKeys: readonly string[]): readonly string[] {
  const set = /^\/set\s+(\S*)$/.exec(line);
  if (set !== null) {
    const prefix = set[1] ?? "";
    return sessionKeys.filter((key) => key.startsWith(prefix)).map((key) => `/set ${key}`);
  }
  for (const alias of SLASH_ALIASES) {
    if (line.startsWith(`/${alias.name} `)) return [];
  }
  if (/^\/\S*$/.test(line)) {
    const names = ["help", "quit", "set", "resume", ...SLASH_ALIASES.map((alias) => alias.name)];
    return names.map((name) => `/${name}`).filter((candidate) => candidate.startsWith(line));
  }
  return [];
}

export interface SlashContext {
  readonly io: Pick<CliIo, "stdout" | "stderr" | "readLine">;
  readonly connection: HostConnection;
  readonly workspace: string;
  readonly threadId: () => ThreadId;
  readonly signal: AbortSignal;
  /** 다른 세션으로 바꾼다(/resume) */
  readonly switchTo: (threadId: ThreadId) => Promise<Result<void, Failure>>;
}

export type SlashOutcome = "continue" | "quit";

function parseThreadId(text: string): ThreadId | undefined {
  const parsed = parse(ThreadIdSchema, text);
  return parsed.ok ? parsed.value : undefined;
}

function describeSetting(setting: EffectiveSetting): string {
  return `${setting.key} = ${showValue(setting.value)}  (${setting.source.scope})`;
}

async function failWith(ctx: SlashContext, caught: unknown): Promise<SlashOutcome> {
  const failure = failureOfCaught(caught);
  if (failure === undefined) throw caught;
  await ctx.io.stderr(renderFailure(failure));
  return "continue";
}

async function setSession(ctx: SlashContext, key: string, raw: string): Promise<SlashOutcome> {
  try {
    const result = await ctx.connection.request("settings.set", {
      key,
      value: interpretRaw(raw),
      scope: "session",
      threadId: ctx.threadId(),
    });
    await ctx.io.stdout(`${describeSetting(result.setting)}\n`);
    return "continue";
  } catch (caught) {
    return failWith(ctx, caught);
  }
}

async function showAlias(ctx: SlashContext, alias: SlashAlias): Promise<SlashOutcome> {
  try {
    const current = await ctx.connection.request("settings.get", {
      keys: [alias.key],
      threadId: ctx.threadId(),
    });
    const setting = current.settings[0];
    if (setting !== undefined) await ctx.io.stdout(`${describeSetting(setting)}\n`);
    const defs = await ctx.connection.request("settings.list", { prefix: alias.key });
    const def = defs.defs.find((candidate) => candidate.key === alias.key);
    const values = def?.range?.enum;
    if (values !== undefined) await ctx.io.stdout(`선택지: ${values.join(", ")}\n`);
    return "continue";
  } catch (caught) {
    return failWith(ctx, caught);
  }
}

function summaryLine(index: number, thread: ThreadSummary): string {
  const title = thread.title ?? "(제목 없음)";
  return `  ${String(index + 1)}) ${thread.threadId}  ${thread.updatedAt}  ${title}`;
}

async function resume(ctx: SlashContext, target: string | null): Promise<SlashOutcome> {
  try {
    const listed = await ctx.connection.request("thread.list", {
      workspace: ctx.workspace,
      limit: 20,
    });
    let chosen: string | null = target;
    if (chosen === null) {
      if (listed.threads.length === 0) {
        await ctx.io.stdout("이어 열 세션이 없다\n");
        return "continue";
      }
      await ctx.io.stdout(`${listed.threads.map((t, i) => summaryLine(i, t)).join("\n")}\n`);
      chosen = (await ctx.io.readLine("번호나 id (엔터는 취소) > ", ctx.signal))?.trim() ?? "";
      if (chosen.length === 0) return "continue";
    }
    const index = /^\d+$/.test(chosen) ? Number(chosen) - 1 : -1;
    const byNumber = listed.threads[index];
    const id = byNumber === undefined ? parseThreadId(chosen) : byNumber.threadId;
    if (id === undefined) {
      await ctx.io.stderr(
        renderFailure({
          message: `세션을 고를 수 없다: ${chosen}`,
          fix: "/resume으로 목록의 번호나 세션 id를 입력한다",
        }),
      );
      return "continue";
    }
    const switched = await ctx.switchTo(id);
    if (!switched.ok) await ctx.io.stderr(renderFailure(switched.error));
    return "continue";
  } catch (caught) {
    return failWith(ctx, caught);
  }
}

/** 슬래시 명령 하나를 실행한다. 실패는 두 줄 오류로 알리고 입력을 이어 받는다 */
export async function runSlash(command: SlashCommand, ctx: SlashContext): Promise<SlashOutcome> {
  switch (command.kind) {
    case "help":
      await ctx.io.stdout(slashHelp());
      return "continue";
    case "quit":
      return "quit";
    case "set":
      return setSession(ctx, command.key, command.raw);
    case "alias":
      return command.raw === null
        ? showAlias(ctx, command.alias)
        : setSession(ctx, command.alias.key, command.raw);
    case "resume":
      return resume(ctx, command.target);
    case "usage":
      await ctx.io.stderr(`${command.message}\n`);
      return "continue";
    case "unknown":
      await ctx.io.stderr(`모르는 슬래시 명령: /${command.name}\n${slashHelp()}`);
      return "continue";
    default:
      return assertNever(command, "SlashCommand");
  }
}
