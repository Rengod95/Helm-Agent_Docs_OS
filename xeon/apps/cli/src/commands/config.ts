import { assertNever } from "@xeon/contracts";
import type { EffectiveSetting, SettingSource } from "@xeon/contracts/settings";
import type { CommandIo, HostCommand } from "@xeon/host";
import type { ConfigCommand } from "../cli/command.ts";
import { renderFailure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { closeEngine, connectOrReport, reportCaught, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 config, §4.8. M1은 `config get`과 로컬 명령 `config schema`만 있다.
// set·reset·list는 settings.set/reset/list가 host M2 처리기라 M2에서 제공한다.

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
  const connected = await connectOrReport(ctx);
  if (!connected.ok) return connected.error;
  const handle = connected.value;
  try {
    const result = await handle.connection.request(
      "settings.get",
      command.keys.length === 0 ? {} : { keys: [...command.keys] },
    );
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify(result.settings, null, 2)}\n`);
    } else {
      await ctx.io.stdout(formatSettings(result.settings));
    }
    return await closeEngine(handle, EXIT.ok);
  } catch (caught) {
    await handle.shutdown("user");
    return reportCaught(ctx.io, caught);
  }
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
    case "config.reset":
    case "config.list":
      await ctx.io.stderr(
        renderFailure({
          message: `${command.kind.replace(".", " ")}은 아직 제공하지 않는다`,
          fix: "M2에서 제공한다. 지금은 설정 파일을 직접 고친다",
        }),
      );
      return EXIT.error;
    default:
      return assertNever(command, "ConfigCommand");
  }
}
