import { resolve } from "node:path";
import { assertNever } from "@xeon/contracts";
import { parseArgv } from "./cli/command.ts";
import type { CommandContext } from "./commands/context.ts";
import { runHelp } from "./commands/help.ts";
import { CLI_VERSION, runVersion } from "./commands/version.ts";
import { failureOfUsage, renderFailure } from "./errors.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import type { CliDeps, CliIo } from "./io.ts";

// L4.cli.spec §3.4. CLI 진입. 프로세스 밖 효과는 io와 deps로만 한다: 테스트는 둘을 가짜로 넣는다.
// 실제 io와 deps를 만드는 최상위 코드는 runtime.ts에 있다(이 파일은 import만 해도 아무것도 실행하지 않는다).

export type { CliDeps, CliIo, CliSignal } from "./io.ts";
export type { ExitCode } from "./exit-codes.ts";

/** M1 밖 명령. 파서는 전체 문법을 받지만 실행은 마일스톤이 온 뒤에 붙는다(L4.cli.plan C1) */
async function notYet(io: CliIo, name: string, milestone: "M2" | "M3"): Promise<ExitCode> {
  await io.stderr(
    renderFailure({
      message: `${name}은 아직 제공하지 않는다`,
      fix: `${milestone}에서 제공한다. xeon --help로 지금 쓸 수 있는 명령을 확인한다`,
    }),
  );
  return EXIT.error;
}

/** 프로세스 밖 효과는 io와 deps로만 한다. 종료 코드를 돌려주고, process.exit는 호출자가 한다 */
export async function runCli(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<ExitCode> {
  const parsed = parseArgv(argv, io.terminal, io.env);
  if (!parsed.ok) {
    await io.stderr(renderFailure(failureOfUsage(parsed.error)));
    return EXIT.usage;
  }
  const { global, command } = parsed.value;
  const ctx: CommandContext = { io, deps, global, workspace: resolve(io.cwd, global.cwd) };

  switch (command.kind) {
    case "chat": {
      // 엔진을 끌어오는 모듈은 필요할 때만 읽는다: version·help는 엔진 없이 끝나야 빠르다(L4.cli.plan §4.3 측정 항목)
      const { runChat } = await import("./commands/chat.ts");
      return runChat(ctx, command);
    }
    case "config.get":
    case "config.set":
    case "config.reset":
    case "config.list":
    case "config.schema": {
      const { runConfig } = await import("./commands/config.ts");
      return runConfig(ctx, command);
    }
    case "version":
      return runVersion(command.output, { cli: CLI_VERSION, bun: deps.bunVersion }, io.stdout);
    case "help":
      return runHelp(command.topic, io.stdout);
    case "sessions.ls":
    case "sessions.show":
    case "sessions.fork":
    case "sessions.rm":
      return notYet(io, "sessions", "M2");
    case "secret.ls":
    case "secret.add":
    case "secret.set":
    case "secret.meta":
    case "secret.rotate":
    case "secret.rm":
    case "secret.test":
    case "secret.reveal":
      return notYet(io, "secret", "M2");
    case "doctor":
      return notYet(io, "doctor", "M2");
    case "host":
      return notYet(io, "host --stdio", "M2");
    case "service":
      return notYet(io, "service", "M3");
    default:
      return assertNever(command, "CliCommand");
  }
}

/** 최상위 await를 쓰지 않는다: `bun build --compile --bytecode`가 받지 못한다(L4.cli.plan §4.3) */
async function runFromProcess(): Promise<never> {
  const { createRealDeps, createRealIo } = await import("./runtime.ts");
  const code = await runCli(process.argv.slice(2), createRealIo(), createRealDeps(process.env));
  return process.exit(code);
}

if (import.meta.main) {
  runFromProcess().catch((caught: unknown) => {
    const text = caught instanceof Error ? (caught.stack ?? caught.message) : String(caught);
    process.stderr.write(`xeon: 내부 오류\n${text}\n`);
    process.exit(EXIT.error);
  });
}
