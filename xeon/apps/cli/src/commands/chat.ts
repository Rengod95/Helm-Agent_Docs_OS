import { assertNever, attemptAsync, detach } from "@xeon/contracts";
import type { ChatCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, renderFailure, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { createJsonTap, type JsonTap, type JsonTapMode } from "../render/json-tap.ts";
import { createTextSink, type RenderSink } from "../render/text-sink.ts";
import { CLI_SETTING_KEYS } from "../settings.ts";
import { wireSignals, type SignalWiring } from "../signals.ts";
import { createMinimalSink, runInteractive } from "../tui/minimal.ts";
import { resolvePrintInput } from "./chat-input.ts";
import {
  createPositionKeeper,
  loadInitialState,
  openChatSession,
  type ChatSession,
  type PositionKeeper,
  type TurnEnd,
} from "./chat-session.ts";
import {
  closeEngine,
  connectOrReport,
  printFailure,
  reportCaught,
  type CommandContext,
} from "./context.ts";

// L4.cli.spec §4.1~§4.6. `xeon chat`: print 모드(-p), JSON 모드(--json), 최소 대화형. 엔진은 in-process다(M1).

const IDLE_CTRL_C_HINT = "(한 번 더 누르면 끝낸다)\n";

/** turn 하나의 끝 상태를 종료 코드로 바꾼다(§3.6) */
export function exitCodeOfTurn(end: TurnEnd): ExitCode {
  switch (end.status) {
    case "completed":
      return EXIT.ok;
    case "interrupted":
      return EXIT.interrupted;
    case "failed":
      return EXIT.error;
    default:
      return assertNever(end.status, "TurnEnd.status");
  }
}

interface Holder {
  handle: EngineHandle | undefined;
  session: ChatSession | undefined;
  keeper: PositionKeeper | undefined;
}

/** `l4.cli.outputMode`를 읽어 JSON 탭을 켜거나 끈다. --json 플래그가 이 값보다 앞선다(§6) */
async function decideJsonTap(handle: EngineHandle, tap: JsonTap): Promise<void> {
  if (tap.mode !== "undecided") return;
  const read = await attemptAsync(() =>
    handle.connection.request("settings.get", { keys: [CLI_SETTING_KEYS.outputMode] }),
  );
  // 설정을 읽지 못하면 기본 출력(text)이다. 연결 문제는 다음 요청이 같은 오류로 드러낸다
  tap.decide(read.ok && read.value.settings[0]?.value === "json");
}

async function runPrint(
  ctx: CommandContext,
  session: ChatSession,
  input: string,
  jsonMode: boolean,
): Promise<ExitCode> {
  const sent = await session.sendTurn(input);
  const end = await sent.done;
  await session.idle();
  if (jsonMode && end.status !== "completed") {
    // JSON 모드는 사람용 출력이 없다. 실패 이유는 stderr에 한 줄 남긴다
    await ctx.io.stderr(
      renderFailure({
        message:
          end.status === "failed"
            ? `turn이 실패했다${end.error === null ? "" : `: ${end.error}`}`
            : "turn이 중단되었다",
        fix: "--json 없이 실행하면 사람이 읽는 출력으로 이유를 볼 수 있다",
      }),
    );
  }
  return exitCodeOfTurn(end);
}

async function chatWork(
  ctx: CommandContext,
  command: ChatCommand,
  input: string,
  tap: JsonTap,
  wiring: SignalWiring,
  holder: Holder,
): Promise<ExitCode> {
  const { io, global } = ctx;
  const interactive = command.mode === "interactive";
  const connected = await connectOrReport(ctx, (message) => {
    // 위치를 먼저 남기고(동기) 그 다음에 JSON 줄로 내보낸다: 강제 종료 뒤 재개가 본 이벤트를 다시 받지 않게 한다(AC2)
    holder.keeper?.observe(message);
    tap.observe(message);
  });
  if (!connected.ok) return connected.error;
  const handle = connected.value;
  holder.handle = handle;
  try {
    const stateRead = await loadInitialState(handle.paths.cliStateFile);
    if (stateRead.kind === "discarded" && command.target.kind !== "continue") {
      // 깨진 상태 파일은 버린다. --continue는 이어 열 세션이 없다는 오류로 같은 이유를 알린다
      await io.stderr(`CLI 상태 파일을 읽지 못해 버렸다 (${stateRead.reason})\n`);
    }
    holder.keeper = createPositionKeeper({
      path: handle.paths.cliStateFile,
      workspace: ctx.workspace,
      initial: stateRead.state,
      now: () => handle.clock.now(),
    });
    if (!interactive) await decideJsonTap(handle, tap);
    const jsonMode = tap.mode === "on";

    const colorOn = global.color && io.terminal.stdoutIsTty;
    let sink: RenderSink | null;
    if (jsonMode) {
      sink = null;
    } else if (interactive) {
      sink = createMinimalSink({
        stdout: io.stdout,
        stderr: io.stderr,
        color: colorOn,
        progress: colorOn,
        columns: io.terminal.columns,
        hideUser: () => holder.session?.turnActive ?? false,
      });
    } else {
      sink = createTextSink({
        stdout: io.stdout,
        stderr: io.stderr,
        layout: "print",
        color: colorOn,
      });
    }

    const opened = await openChatSession(
      {
        handle,
        workspace: ctx.workspace,
        sink,
        width: io.terminal.columns ?? 80,
        collapseHistory: interactive,
        keeper: holder.keeper,
        // print 모드는 승인 프롬프트를 열 수 없다: 거부로 답하고 알린다(§4.11 4번). M1 host에는 approval.respond가 없어
        // 거부 응답이 실패할 수 있다: 그때는 알림만 남기고 계속한다
        onApproval: interactive
          ? null
          : async (view) => {
              const responded = await attemptAsync(() =>
                handle.connection.request("approval.respond", {
                  approvalId: view.approvalId,
                  decision: "deny",
                }),
              );
              // 응답 수단이 없는 host면 거부 응답이 가지 않았음을 알림에 밝힌다
              const outcome = responded.ok
                ? "거부로 답했다"
                : "거부로 답하려 했으나 host가 응답을 받지 못했다";
              await io.stderr(`승인 요청 "${view.title}"에 비대화 모드라 ${outcome}\n`);
            },
        onOutputError: () => {
          wiring.exit.request(EXIT.ok);
        },
      },
      command.target,
    );
    if (!opened.ok) {
      await printFailure(io, opened.error);
      await handle.shutdown("user");
      return opened.error.code;
    }
    holder.session = opened.value;
    const code = interactive
      ? await runInteractive({ io, session: opened.value, exit: wiring.exit })
      : await runPrint(ctx, opened.value, input, jsonMode);
    if (holder.keeper.writeFailed) {
      // 상태 파일은 캐시라 대화는 계속했다. 다음 --continue가 이 세션을 못 찾을 수 있음을 알린다
      await io.stderr("CLI 상태 파일을 쓰지 못했다. --continue가 이 세션을 찾지 못할 수 있다\n");
    }
    return await closeEngine(handle, code);
  } catch (caught) {
    await handle.shutdown("user");
    return reportCaught(io, caught);
  }
}

/** `xeon chat`을 실행하고 종료 코드를 돌려준다 */
export async function runChat(ctx: CommandContext, command: ChatCommand): Promise<ExitCode> {
  const { io, deps } = ctx;
  if (command.overrides.length > 0) {
    await printFailure(io, {
      message: "--set은 아직 제공하지 않는다",
      fix: "M2에서 제공한다. 지금은 설정 파일을 직접 고친다",
    } satisfies Pick<Failure, "message" | "fix">);
    return EXIT.error;
  }
  const interactive = command.mode === "interactive";
  let input = "";
  if (!interactive) {
    const resolved = await resolvePrintInput(command, io);
    if (!resolved.ok) {
      await printFailure(io, resolved.error);
      return resolved.error.code;
    }
    input = resolved.value;
  }

  const holder: Holder = { handle: undefined, session: undefined, keeper: undefined };
  const wiring = wireSignals(io, {
    clock: deps.clock,
    interactive,
    // turn.interrupt는 host M2 처리기다. M1에서는 Ctrl+C 1회가 종료 요청이다(§4.6)
    interruptSupported: false,
    turnActive: () => holder.session?.turnActive ?? false,
    interruptTurn: () => undefined,
    hint: () => {
      // stdout이 닫혔으면(EPIPE) 출력을 멈추고 종료 요청, 0 [제안]. tap의 쓰기 실패와 같은 처리다
      detach(io.stdout(IDLE_CTRL_C_HINT), () => {
        wiring.exit.request(EXIT.ok);
      });
    },
  });
  const initialTap: JsonTapMode =
    command.output === "json" ? "on" : interactive ? "off" : "undecided";
  const tap = createJsonTap(async (line) => {
    try {
      await io.stdout(line);
    } catch (caught) {
      // stdout이 닫혔다(EPIPE): 출력을 멈추고 종료 요청, 0 [제안]
      wiring.exit.request(EXIT.ok);
      throw caught;
    }
  }, initialTap);

  // 작업의 실패를 값으로 받는다. 종료 요청으로 버려진 작업의 거부가 처리되지 않은 채 남지 않는다
  const work = attemptAsync(() => chatWork(ctx, command, input, tap, wiring, holder));
  try {
    const first = await Promise.race([
      work.then((outcome) => ({ exited: false as const, outcome })),
      wiring.exit.requested.then((request) => ({ exited: true as const, request })),
    ]);
    if (!first.exited) {
      if (!first.outcome.ok) throw first.outcome.error.cause;
      // tap의 쓰기 실패는 write 안에서 종료 요청(EXIT.ok)으로 이미 처리했다. flush 결과는 쓰지 않는다
      await attemptAsync(() => tap.flush());
      return first.outcome.value;
    }
    // 종료 요청: 하던 일을 버리고 엔진을 닫는다. 시한을 넘기거나 강제 요청이 오면 기다리지 않는다
    const { handle } = holder;
    if (handle !== undefined && !first.request.forced) {
      await Promise.race([handle.shutdown("signal"), wiring.exit.forced.then(() => undefined)]);
    }
    await attemptAsync(() => tap.flush());
    return first.request.code;
  } catch (caught) {
    const failure = failureOfCaught(caught);
    if (failure === undefined) throw caught;
    await printFailure(io, failure);
    return failure.code;
  } finally {
    wiring.dispose();
  }
}
