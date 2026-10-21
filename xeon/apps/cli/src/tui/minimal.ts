import { HostClientError } from "../host-client.ts";
import type { ChatSession } from "../commands/chat-session.ts";
import { failureOfCaught, renderFailure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CliIo } from "../io.ts";
import type { RenderOp } from "../render/model.ts";
import { createTextSink, type RenderSink } from "../render/text-sink.ts";
import type { ExitCoordinator } from "../signals.ts";
import { sequentially } from "../util.ts";

// L4.cli.spec §4.9.2 후퇴 경로, L4.cli.plan C6. 최소 renderer: 줄 입력 + 줄 출력 + 진행 줄 한 줄 덮어쓰기.
// pi-tui 채택(C8)은 M2다. 화면 코드는 RenderSink 뒤에 있어 나중에 갈아 끼울 수 있다.

const ESC = String.fromCodePoint(27);
const ERASE_LINE = `\r${ESC}[2K`;

export interface MinimalSinkOptions {
  readonly stdout: (text: string) => Promise<void>;
  readonly stderr: (text: string) => Promise<void>;
  readonly color: boolean;
  /** 진행 줄을 그린다(커서 제어를 쓴다). stdout이 TTY이고 색을 쓸 수 있을 때만 참이다 */
  readonly progress: boolean;
  readonly columns: number | null;
  /**
   * 참이면 user 줄을 그리지 않는다. 방금 친 줄은 터미널이 이미 보여 주므로, 이 프로세스의 turn이 도는 동안 오는 user 줄은
   * 같은 내용의 되풀이다. 이전 기록(접힌 것)은 turn이 돌지 않을 때 오므로 그대로 그려진다
   */
  readonly hideUser?: () => boolean;
}

/** 진행 줄에 보일 텍스트: 마지막 줄을 터미널 폭에 맞춰 자른다. 순수 함수 */
export function progressLine(text: string, columns: number | null): string {
  const last = text.split("\n").findLast((line) => line.trim().length > 0) ?? "";
  const width = columns === null ? 80 : columns;
  if (width < 4 || last.length < width) return last;
  return `${last.slice(0, width - 2)}…`;
}

export function createMinimalSink(options: MinimalSinkOptions): RenderSink {
  const inner = createTextSink({
    stdout: options.stdout,
    stderr: options.stderr,
    layout: "full",
    color: options.color,
  });
  const state = { shown: false };
  const erase = async (): Promise<void> => {
    if (!state.shown) return;
    state.shown = false;
    await options.stdout(ERASE_LINE);
  };
  const apply = async (op: RenderOp): Promise<void> => {
    if (op.kind === "progress") {
      if (!options.progress) return;
      state.shown = true;
      await options.stdout(`${ERASE_LINE}${progressLine(op.text, options.columns)}`);
      return;
    }
    if (op.kind === "clearProgress") {
      await erase();
      return;
    }
    if (op.kind === "user" && options.hideUser?.() === true) return;
    await erase();
    await inner.write([op]);
  };
  return {
    write: (ops) => sequentially(ops, apply),
    async close() {
      await erase();
      await inner.close();
    },
  };
}

export interface InteractiveArgs {
  readonly io: CliIo;
  readonly session: ChatSession;
  readonly exit: ExitCoordinator;
}

const SLASH_HELP = [
  "슬래시 명령",
  "  /help   이 도움말",
  "  /quit   끝낸다 (Ctrl+D도 같다)",
  "  (/set, /model, /resume은 M2에서 제공한다)",
  "",
].join("\n");

/**
 * 대화형 루프: 한 줄 입력 → turn 하나 → 끝날 때까지 진행 줄. 종료 요청(Ctrl+C 등)이 오면 입력 대기를 풀고 그 코드로 끝낸다.
 * 입력은 CliIo.readLine이 받는다(실제 구현은 node:readline).
 */
export async function runInteractive(args: InteractiveArgs): Promise<ExitCode> {
  const { io, session, exit } = args;
  const abort = new AbortController();
  exit.requested
    .then((request) => {
      abort.abort();
      return request;
    })
    .catch(() => undefined);
  await io.stdout(`xeon chat — 세션 ${session.threadId} (종료: /quit 또는 Ctrl+D)\n`);
  // 이전 기록을 다 그린 뒤에 입력을 받는다: 재전송과 새 turn의 그리기가 섞이지 않게 한다
  await Promise.race([session.caughtUp(), exit.requested]);

  const exitCode = async (): Promise<ExitCode> => (await exit.requested).code;

  const step = async (): Promise<ExitCode> => {
    const line = await io.readLine("> ", abort.signal);
    if (exit.isRequested) return exitCode();
    if (line === null) {
      await io.stdout("\n");
      return EXIT.ok;
    }
    const text = line.trim();
    if (text.length === 0) return step();
    if (text === "/quit" || text === "/exit") return EXIT.ok;
    if (text.startsWith("/")) {
      await io.stdout(
        text === "/help"
          ? SLASH_HELP
          : `모르는 슬래시 명령: ${text.split(" ")[0] ?? ""}\n${SLASH_HELP}`,
      );
      return step();
    }
    try {
      const sent = await session.sendTurn(text);
      const outcome = await Promise.race([sent.done, exit.requested]);
      if ("code" in outcome) return outcome.code;
    } catch (caught) {
      const failure = failureOfCaught(caught);
      if (failure === undefined) throw caught;
      await io.stderr(renderFailure(failure));
      if (caught instanceof HostClientError || failure.code === EXIT.lockDenied) {
        return failure.code;
      }
    }
    return step();
  };
  return step();
}
