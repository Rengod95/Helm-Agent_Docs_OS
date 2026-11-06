import { t } from "@fresnel/client/i18n";
import { attemptAsync, detach, err, ok, rethrow, type Result } from "@fresnel/contracts";
import { WIRE_LIMITS } from "@fresnel/contracts/wire";
import type { ChatCommand } from "../cli/command.ts";
import type { Failure } from "../errors.ts";
import { EXIT } from "../exit-codes.ts";
import type { CliIo } from "../io.ts";

// L4.cli.spec §4.2. print 모드 입력: `-p <입력>`, `-p -`/`-p`(stdin 전체), TTY가 아닌 stdin과 `-p` 입력이 함께 있으면
// `-p` 입력 뒤에 빈 줄과 stdin 내용을 붙인다. 입력은 UTF-8이고 1 MiB 프레임 한도(WIRE_LIMITS.maxFrameBytes)를 넘으면 2다.

type ReadOutcome = { readonly kind: "ok"; readonly text: string } | { readonly kind: "tooLarge" };

/** `-p <입력>`과 함께 온 stdin이 이 시간 안에 첫 바이트를 주지 않으면 비어 있다고 본다(ms). 열려 있기만 한 파이프에서 EOF를 기다리며 멈추지 않는다 */
export const STDIN_IDLE_MS = 1000;

type FirstChunk =
  | { readonly kind: "idle" }
  | { readonly kind: "end" }
  | { readonly kind: "chunk"; readonly value: Uint8Array };

/** 첫 조각을 `ms` 안에 받는다. 못 받으면 idle이고 읽기 잠금은 놓는다(대기 중이던 읽기의 거절은 값으로 받아 둔다) */
async function firstChunk(stream: ReadableStream<Uint8Array>, ms: number): Promise<FirstChunk> {
  const reader = stream.getReader();
  const read = reader
    .read()
    .then((r): FirstChunk => (r.done ? { kind: "end" } : { kind: "chunk", value: r.value }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<FirstChunk>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: "idle" });
    }, ms);
  });
  const got = await Promise.race([read, idle]);
  clearTimeout(timer);
  if (got.kind === "idle") {
    detach(
      attemptAsync(() => read),
      rethrow,
    );
  }
  reader.releaseLock();
  return got;
}

/**
 * 스트림을 EOF까지 읽는다. maxBytes를 넘으면 읽기를 멈춘다.
 * `firstChunkMs`를 주면 그 안에 첫 조각이 없을 때 읽기를 접고 빈 글로 돌려준다(닫지 않고 잠금만 놓는다). 첫 조각이 온 뒤에는 EOF까지 기다린다.
 */
export async function readAllText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  firstChunkMs?: number,
): Promise<ReadOutcome> {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  if (firstChunkMs !== undefined) {
    const first = await firstChunk(stream, firstChunkMs);
    if (first.kind !== "chunk") return { kind: "ok", text: "" };
    total = first.value.byteLength;
    if (total > maxBytes) return { kind: "tooLarge" };
    parts.push(decoder.decode(first.value, { stream: true }));
  }
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > maxBytes) return { kind: "tooLarge" };
    parts.push(decoder.decode(chunk, { stream: true }));
  }
  parts.push(decoder.decode());
  return { kind: "ok", text: parts.join("") };
}

function tooLarge(): Failure {
  return {
    message: t("cli.errors.chatInput.tooLarge.message"),
    fix: t("cli.errors.chatInput.tooLarge.fix"),
    code: EXIT.usage,
  };
}

/** print 모드의 입력 문자열을 정한다 */
export async function resolvePrintInput(
  command: ChatCommand,
  io: Pick<CliIo, "stdin" | "terminal">,
): Promise<Result<string, Failure>> {
  const limit = WIRE_LIMITS.maxFrameBytes;
  const given = command.input ?? "-";
  let text = given;
  if (given === "-" || !io.terminal.stdinIsTty) {
    // `-p <입력>`이 있으면 stdin은 덧붙임일 뿐이라 열려 있기만 한 파이프를 끝없이 기다리지 않는다
    const stdin = await readAllText(io.stdin, limit, given === "-" ? undefined : STDIN_IDLE_MS);
    if (stdin.kind === "tooLarge") return err(tooLarge());
    text =
      given === "-" ? stdin.text : stdin.text.length === 0 ? given : `${given}\n\n${stdin.text}`;
  }
  if (new TextEncoder().encode(text).byteLength > limit) return err(tooLarge());
  if (text.trim().length === 0) {
    return err({
      message: t("cli.errors.chatInput.empty.message"),
      fix: t("cli.usage.chat.inputRequired.fix"),
      code: EXIT.usage,
    });
  }
  return ok(text);
}
