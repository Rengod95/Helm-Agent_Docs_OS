import { err, ok, type Result } from "@xeon/contracts";
import { WIRE_LIMITS } from "@xeon/contracts/wire";
import type { ChatCommand } from "../cli/command.ts";
import type { Failure } from "../errors.ts";
import { EXIT } from "../exit-codes.ts";
import type { CliIo } from "../io.ts";

// L4.cli.spec §4.2. print 모드 입력: `-p <입력>`, `-p -`/`-p`(stdin 전체), TTY가 아닌 stdin과 `-p` 입력이 함께 있으면
// `-p` 입력 뒤에 빈 줄과 stdin 내용을 붙인다. 입력은 UTF-8이고 1 MiB 프레임 한도(WIRE_LIMITS.maxFrameBytes)를 넘으면 2다.

type ReadOutcome = { readonly kind: "ok"; readonly text: string } | { readonly kind: "tooLarge" };

/** 스트림을 EOF까지 읽는다. maxBytes를 넘으면 읽기를 멈춘다 */
export async function readAllText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<ReadOutcome> {
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
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
    message: "입력이 1 MiB를 넘는다",
    fix: "큰 내용은 파일에 두고 도구로 읽게 한다",
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
    const stdin = await readAllText(io.stdin, limit);
    if (stdin.kind === "tooLarge") return err(tooLarge());
    text =
      given === "-" ? stdin.text : stdin.text.length === 0 ? given : `${given}\n\n${stdin.text}`;
  }
  if (new TextEncoder().encode(text).byteLength > limit) return err(tooLarge());
  if (text.trim().length === 0) {
    return err({
      message: "입력이 비어 있다",
      fix: "-p <입력>으로 입력을 주거나 stdin으로 넘긴다",
      code: EXIT.usage,
    });
  }
  return ok(text);
}
