import { t } from "@xeon/client/i18n";
import { attemptAsync } from "@xeon/contracts";
import type { HostConnection } from "@xeon/contracts/wire";
import { HostClientError } from "../host-client.ts";
import type { ChatSession } from "../commands/chat-session.ts";
import { failureOfCaught, renderFailure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { CliIo } from "../io.ts";
import type { RenderOp } from "../render/model.ts";
import { createTextSink, type RenderSink } from "../render/text-sink.ts";
import type { ExitCoordinator } from "../signals.ts";
import type { ApprovalSink } from "../render/approval.ts";
import {
  completionsOf,
  loadEngineCommands,
  parseSlash,
  runSlash,
  type EngineCommand,
  type SlashContext,
} from "../slash.ts";
import { displayWidth, truncateToWidth } from "../render/width.ts";
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

/** 진행 줄에 보일 텍스트: 마지막 줄을 터미널 칸 수(한글·한자는 2칸)에 맞춰 자른다. 마지막 칸은 비워 자동 줄바꿈을 막는다. 순수 함수 */
export function progressLine(text: string, columns: number | null): string {
  const last = text.split("\n").findLast((line) => line.trim().length > 0) ?? "";
  const width = columns === null ? 80 : columns;
  if (width < 4 || displayWidth(last) < width) return last;
  return truncateToWidth(last, width - 1);
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

/** await 너머로 바뀌는 값을 다시 읽는다(readonly 프로퍼티의 좁힘이 이어지지 않게 한다) */
function wasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export interface InteractiveArgs {
  readonly io: CliIo;
  /** 지금 세션. /resume이 바꾸면 다음 입력부터 새 세션을 가리킨다 */
  readonly current: () => ChatSession;
  readonly exit: ExitCoordinator;
  /** 지금 세션의 승인 sink. 승인이 입력 줄보다 먼저 사람에게 가야 해서 입력 대기가 이것을 본다 */
  readonly approvals: () => ApprovalSink | undefined;
  readonly slash: Omit<SlashContext, "io" | "signal" | "engineCommands">;
  /**
   * 세션을 열고 이전 기록을 다 그린 뒤, 입력을 받기 전에 부른다(끊긴 turn 이어 실행 확인). 종료 요청이 와서 기다림을 멈췄으면 true다
   */
  readonly onOpened?: (session: ChatSession, signal: AbortSignal) => Promise<boolean>;
}

/** session 범위를 허용하는 설정 키. /set 자동 완성에 쓴다. 읽지 못하면 완성 없이 동작한다 */
async function sessionKeysOf(connection: HostConnection): Promise<readonly string[]> {
  const listed = await attemptAsync(() => connection.request("settings.list", {}));
  if (!listed.ok) return [];
  return listed.value.defs
    .filter((def) => def.allowedScopes.includes("session"))
    .map((def) => def.key);
}

/**
 * 대화형 루프: 한 줄 입력 → turn 하나 → 끝날 때까지 진행 줄. 종료 요청(Ctrl+C 등)이 오면 입력 대기를 풀고 그 코드로 끝낸다.
 * 입력은 CliIo.readLine이 받는다(실제 구현은 node:readline). 슬래시 명령은 slash.ts가 실행한다(§4.12).
 */
export async function runInteractive(args: InteractiveArgs): Promise<ExitCode> {
  const { io, current, exit } = args;
  const abort = new AbortController();
  // 종료 요청이 오면 입력 대기를 푼다. 요청 약속이 거부돼도 입력 대기는 풀어야 한다
  exit.requested.then(
    () => {
      abort.abort();
      return undefined;
    },
    () => {
      abort.abort();
    },
  );
  await io.stdout(t("cli.tui.minimal.banner", { threadId: current().threadId }));
  // 이전 기록을 다 그린 뒤에 입력을 받는다: 재전송과 새 turn의 그리기가 섞이지 않게 한다
  await Promise.race([current().caughtUp(), exit.requested]);
  if (current().readOnly) {
    await io.stdout(t("cli.tui.minimal.readOnly"));
  }
  if (args.onOpened !== undefined && (await args.onOpened(current(), abort.signal))) {
    return (await exit.requested).code;
  }
  // 엔진에 등록한 명령(command.list)은 도움말과 Tab 완성에 쓴다. 읽지 못하면 내장 명령만 동작한다
  // 프로젝트 명령은 세션의 작업 폴더 기준이라 세션을 바꾸면(/resume) 다시 읽는다
  let commandsThreadId = current().threadId;
  const engineCommands: EngineCommand[] = [
    ...(await loadEngineCommands(args.slash.connection, args.slash.supports, commandsThreadId)),
  ];
  const reloadEngineCommands = async (): Promise<void> => {
    const threadId = current().threadId;
    if (threadId === commandsThreadId) return;
    commandsThreadId = threadId;
    engineCommands.splice(
      0,
      engineCommands.length,
      ...(await loadEngineCommands(args.slash.connection, args.slash.supports, threadId)),
    );
  };
  if (io.setCompleter !== undefined) {
    const keys = await sessionKeysOf(args.slash.connection);
    io.setCompleter((line) => completionsOf(line, keys, engineCommands));
  }

  const exitCode = async (): Promise<ExitCode> => (await exit.requested).code;
  /** 입력을 기다리는 사이 바뀌는 값이다. 함수로 다시 읽어 앞선 검사의 좁힘이 이어지지 않게 한다 */
  const exitRequested = (): boolean => exit.isRequested;

  /** 입력 하나를 turn으로 보내 끝날 때까지 기다린다. 입력을 이어 받을 수 없으면 종료 코드, 이어 받으면 undefined다 */
  const sendInput = async (text: string): Promise<ExitCode | undefined> => {
    const session = current();
    if (session.readOnly) {
      await io.stderr(t("cli.tui.minimal.readOnlyInput"));
      return undefined;
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
    return undefined;
  };

  const step = async (): Promise<ExitCode> => {
    // 열려 있거나 줄 선 승인 프롬프트가 입력을 먼저 쓴다(재시작 뒤 되살린 승인, turn 밖에서 온 승인)
    await args.approvals()?.idle();
    if (exitRequested()) return exitCode();
    const readAbort = new AbortController();
    const forward = (): void => {
      readAbort.abort();
    };
    abort.signal.addEventListener("abort", forward, { once: true });
    const offApproval = args.approvals()?.onOffer(forward);
    let line: string | null;
    try {
      line = await io.readLine("> ", readAbort.signal);
    } finally {
      offApproval?.();
      abort.signal.removeEventListener("abort", forward);
    }
    if (exitRequested()) return exitCode();
    // 새 승인이 입력을 가져갔다: 승인 답이 끝난 뒤 다시 입력을 받는다
    if (wasAborted(readAbort.signal)) return step();
    if (line === null) {
      await io.stdout("\n");
      return EXIT.ok;
    }
    const text = line.trim();
    if (text.length === 0) return step();
    if (text.startsWith("/")) {
      const outcome = await runSlash(parseSlash(text), {
        ...args.slash,
        io,
        signal: abort.signal,
        engineCommands: () => engineCommands,
      });
      if (outcome === "quit") return EXIT.ok;
      if (outcome === "continue") {
        await reloadEngineCommands();
        return step();
      }
      // 명령이 펼친 텍스트는 사용자가 친 입력처럼 turn으로 보낸다
      return (await sendInput(outcome.send)) ?? step();
    }
    return (await sendInput(text)) ?? step();
  };
  return step();
}
