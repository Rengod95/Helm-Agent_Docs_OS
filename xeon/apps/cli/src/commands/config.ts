import { assertNever } from "@xeon/contracts";
import type { EffectiveSetting, SettingDefWire, SettingSource } from "@xeon/contracts/settings";
import type { HostConnection } from "@xeon/contracts/wire";
import type { CommandIo, HostCommand } from "@xeon/host";
import type { ConfigCommand } from "../cli/command.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { interpretRaw } from "../settings-input.ts";
import { cliSettings } from "../settings.ts";
import { withEngine, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 config, §4.8. get·schema는 M1, set·reset·list는 M2(settings.set/reset/list)다.

function sourceText(source: SettingSource): string {
  return source.path === undefined ? source.scope : `${source.scope} (${source.path})`;
}

/** `config get` 텍스트 출력(§4.8). source는 settings.get 결과를 그대로 옮긴다(F wire §4.7 5번) */
export function formatSettings(settings: readonly EffectiveSetting[]): string {
  const lines: string[] = [];
  for (const setting of settings) {
    const tags: string[] = [];
    if (setting.locked) tags.push(`locked: ${setting.source.scope}`);
    if (setting.deprecated) tags.push("deprecated");
    const tagText = tags.length === 0 ? "" : `  [${tags.join(", ")}]`;
    lines.push(`${setting.key} = ${JSON.stringify(setting.value)}${tagText}`);
    lines.push(`  source: ${sourceText(setting.source)}`);
    for (const shadowed of setting.shadowed) lines.push(`  shadowed: ${sourceText(shadowed)}`);
    if (setting.pendingUntil !== null) lines.push(`  pending: ${setting.pendingUntil}`);
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

async function runConfigGet(
  ctx: CommandContext,
  command: Extract<ConfigCommand, { kind: "config.get" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const result = await handle.connection.request(
      "settings.get",
      command.keys.length === 0 ? {} : { keys: [...command.keys] },
    );
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify(result.settings, null, 2)}\n`);
    } else {
      await ctx.io.stdout(formatSettings(result.settings));
    }
    return EXIT.ok;
  });
}

/** `config set`: 값은 JSON으로 읽고 안 되면 문자열이다(§4.8). 범위·잠금·값 검사는 host의 settings.set이 한다 */
async function runConfigSet(
  ctx: CommandContext,
  command: Extract<ConfigCommand, { kind: "config.set" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const result = await handle.connection.request("settings.set", {
      key: command.key,
      value: interpretRaw(command.raw),
      scope: command.scope,
    });
    await ctx.io.stdout(formatSettings([result.setting]));
    return EXIT.ok;
  });
}

/** `config reset`: 그 범위의 값을 지운다. 결과는 지운 뒤의 유효 값이다 */
async function runConfigReset(
  ctx: CommandContext,
  command: Extract<ConfigCommand, { kind: "config.reset" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const result = await handle.connection.request("settings.reset", {
      key: command.key,
      scope: command.scope,
    });
    await ctx.io.stdout(formatSettings([result.setting]));
    return EXIT.ok;
  });
}

/** settings.get의 keys 상한(F wire 256) */
const GET_CHUNK = 256;

async function effectiveValues(
  connection: HostConnection,
  keys: readonly string[],
): Promise<ReadonlyMap<string, EffectiveSetting>> {
  const found = new Map<string, EffectiveSetting>();
  for (let at = 0; at < keys.length; at += GET_CHUNK) {
    // oxlint-disable-next-line no-await-in-loop -- 요청 크기 상한을 지키려고 쪽으로 나눠 차례로 읽는다 (L4.cli.spec §3.1)
    const chunk = await connection.request("settings.get", {
      keys: keys.slice(at, at + GET_CHUNK),
    });
    for (const setting of chunk.settings) found.set(setting.key, setting);
  }
  return found;
}

function describeDef(def: SettingDefWire): string {
  const parts: string[] = [];
  const type = def.type["type"];
  if (typeof type === "string") parts.push(type);
  const { range } = def;
  if (range?.enum !== undefined) parts.push(`선택: ${range.enum.join(" | ")}`);
  if (range?.min !== undefined || range?.max !== undefined) {
    parts.push(`범위: ${String(range.min ?? "")}..${String(range.max ?? "")}`);
  }
  parts.push(`적용: ${def.runtimeChange}`);
  parts.push(`쓸 수 있는 범위: ${def.allowedScopes.join(", ")}`);
  if (def.deprecated !== undefined) parts.push("deprecated");
  return `  ${parts.join(" · ")}`;
}

/** `config list`: 정의 목록과 유효 값(§3.1). 텍스트는 `config get`과 같은 줄에 정의 요약 한 줄을 더한다 */
async function runConfigList(
  ctx: CommandContext,
  command: Extract<ConfigCommand, { kind: "config.list" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const listed = await handle.connection.request("settings.list", {
      ...(command.prefix === null ? {} : { prefix: command.prefix }),
      ...(command.includeDeprecated ? { includeDeprecated: true } : {}),
    });
    const values = await effectiveValues(
      handle.connection,
      listed.defs.map((def) => def.key),
    );
    if (command.output === "json") {
      const rows = listed.defs.map((def) => ({ def, setting: values.get(def.key) ?? null }));
      await ctx.io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
      return EXIT.ok;
    }
    const lines: string[] = [];
    for (const def of listed.defs) {
      const setting = values.get(def.key);
      const head =
        setting === undefined
          ? [`${def.key} = (읽지 못함)`]
          : formatSettings([setting]).trimEnd().split("\n");
      lines.push(...head, describeDef(def));
    }
    if (lines.length > 0) await ctx.io.stdout(`${lines.join("\n")}\n`);
    return EXIT.ok;
  });
}

function bytesStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function textSink(write: (text: string) => Promise<void>): WritableStream<Uint8Array> {
  const decoder = new TextDecoder();
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await write(decoder.decode(chunk, { stream: true }));
    },
  });
}

/**
 * `config schema`: 엔진 연결 없이 runHostCommand를 부르고 반환값을 종료 코드로 쓴다(§3.3 표).
 * 호스트 쪽 시작 거부(1)와 사용 오류(2)는 그대로다.
 */
async function runConfigSchema(
  ctx: CommandContext,
  command: Extract<ConfigCommand, { kind: "config.schema" }>,
): Promise<ExitCode> {
  const hostCommand: HostCommand = {
    kind: "config-schema",
    scope: command.scope,
    coreOnly: command.coreOnly,
    // 엔진을 세울 때와 같은 그룹을 넘겨 파일 스키마의 키가 `config list`의 키와 같게 한다(X10)
    settingGroups: [cliSettings],
    ...(command.out === null ? {} : { out: command.out }),
  };
  const io: CommandIo = {
    stdin: bytesStream([]),
    stdout: textSink(ctx.io.stdout),
    stderr: textSink(ctx.io.stderr),
  };
  return ctx.deps.runHostCommand(hostCommand, io);
}

export async function runConfig(ctx: CommandContext, command: ConfigCommand): Promise<ExitCode> {
  switch (command.kind) {
    case "config.get":
      return runConfigGet(ctx, command);
    case "config.schema":
      return runConfigSchema(ctx, command);
    case "config.set":
      return runConfigSet(ctx, command);
    case "config.reset":
      return runConfigReset(ctx, command);
    case "config.list":
      return runConfigList(ctx, command);
    default:
      return assertNever(command, "ConfigCommand");
  }
}
