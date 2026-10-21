// XEON-PATCH: P1
import type {
  BinaryReader,
  CancelScope as Context,
  ExecutionEnv,
  FileInfo,
} from "@xeon/contracts/services";
// XEON-PATCH: P2
import { getOrThrow } from "../../upstream/get-or-throw.ts";
// XEON-PATCH: P2
import { characterEnd } from "../../upstream/output.ts";
import { WorkspaceFailure } from "../../errors.ts";
// XEON-PATCH: P2
import { truncateHeadOf, utf8ByteLength } from "../../truncate/upstream/truncate.ts";
import { rangeDecoder, startsWithBom } from "./decode.ts";

// XEON-PATCH: P5
/** 한도. 원본은 상수 DEFAULT_MAX_LINES·DEFAULT_MAX_BYTES를 썼고 여기서는 설정 l2.workspace.read.*를 호출마다 받는다. */
export interface ReadLimits {
  readonly maxLines: number;
  readonly maxBytes: number;
}

// XEON-PATCH: P5
/** 읽은 구간. 도구 결과(`ReadOutput`)로 바꾸는 일은 `truncate/paging.ts`가 한다. */
export interface ReadSlice {
  /** 보여 줄 텍스트. 첫 줄이 바이트 한도를 넘으면 그 줄의 앞부분 */
  readonly text: string;
  /** 보이는 첫 줄 번호(1부터) */
  readonly startLine: number;
  /** 텍스트에 담은 줄 수. 잘린 첫 줄은 1로 센다 */
  readonly shownLines: number;
  /** 파일 전체 줄 수. 빈 파일은 0이고 끝의 줄바꿈은 줄을 더하지 않는다 */
  readonly fileLines: number;
  /** 한도에 걸린 쪽. 걸리지 않았으면 null */
  readonly cutBy: "lines" | "bytes" | null;
  /** 첫 줄 하나가 바이트 한도를 넘어 앞부분만 남겼는가 */
  readonly firstLineCut: boolean;
}

// XEON-PATCH: P5
export type ReadFileOutcome =
  | { readonly kind: "text"; readonly slice: ReadSlice }
  | { readonly kind: "binary" }
  | { readonly kind: "beyond_end"; readonly fileLines: number };

const READ_CHUNK = 64 * 1024;
// XEON-PATCH: P5
/** 파일 앞 8KB에 NUL 바이트가 있으면 바이너리로 본다(L2.workspace.spec §5 2번) */
const BINARY_PROBE_BYTES = 8 * 1024;
const NEWLINE = 0x0a;

/**
 * The decoded start of bytes `[start, end)` of the file, decoded as part of the whole file: all of it, or enough for
 * `truncateHeadOf` (more than `maxBytes + 1` bytes, or `maxLines` newlines).
 */
async function readHead(
  reader: BinaryReader,
  start: number,
  end: number,
  skipBom: boolean,
  limits: ReadLimits,
  context: Context,
): Promise<string> {
  const decoder = rangeDecoder();
  let text = "";
  let newlines = 0;
  for (let position = skipBom && start === 0 ? 3 : start; position < end;) {
    const length = Math.min(READ_CHUNK, end - position);
    // oxlint-disable-next-line no-await-in-loop -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)
    const chunk = await reader.read(position, length, context);
    const bytes = getOrThrow(chunk);
    if (bytes.length === 0) break;
    position += bytes.length;
    const decoded = decoder.decode(bytes, { stream: true });
    text += decoded;
    for (let index = decoded.indexOf("\n"); index !== -1; index = decoded.indexOf("\n", index + 1))
      newlines++;
    if (newlines >= limits.maxLines || utf8ByteLength(text) > limits.maxBytes + 1) return text;
  }
  return text + decoder.decode();
}

// XEON-PATCH: P5
/**
 * 파일을 열어 텍스트 구간을 읽는다. 원본 `createReadTool`의 `execute`에서 도구 껍데기(`defineTool`, `requireEnv`,
 * 이미지 분기)를 걷어 낸 본문이다. 이미지는 M2(`workspace.images`)에서 더한다. `offset`·`limit`은 1 이상의 정수다.
 */
export async function readFileText(
  env: Pick<ExecutionEnv, "openBinaryReader">,
  absolutePath: string,
  offset: number | undefined,
  limit: number | undefined,
  limits: ReadLimits,
  context: Context,
): Promise<ReadFileOutcome> {
  const reader = getOrThrow(await env.openBinaryReader(absolutePath, undefined, context));
  try {
    // A concurrent writer can change the file between the scan and the reads. Appending (a growing log) leaves
    // the scanned text as it was. Otherwise the file is read again once.
    for (let attempt = 0; ; attempt++) {
      // oxlint-disable-next-line no-await-in-loop -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)
      const before = getOrThrow(await reader.info(context));
      // oxlint-disable-next-line no-await-in-loop -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)
      const result = await readText(reader, before, offset, limit, limits, context);
      // oxlint-disable-next-line no-await-in-loop -- 원본 포크 코드의 모양을 유지한다 (eng.typescript.guide §1 포크 코드)
      const after = getOrThrow(await reader.info(context));
      const unchanged = after.size === before.size && after.mtimeMs === before.mtimeMs;
      if (unchanged || after.size > before.size) return result;
      if (attempt === 1) {
        throw new WorkspaceFailure("unavailable", `${absolutePath} changed while it was read`, {
          retryable: true,
        });
      }
    }
  } finally {
    await reader.close(context);
  }
}

/**
 * The read result for the opened file. It equals decoding the whole file with `TextDecoder`, splitting it on `\n`,
 * and bounding the selected lines with `truncateHead`, while reading only one scan's worth of the file plus the head.
 */
async function readText(
  reader: BinaryReader,
  info: FileInfo,
  offset: number | undefined,
  limit: number | undefined,
  limits: ReadLimits,
  context: Context,
): Promise<ReadFileOutcome> {
  // XEON-PATCH: P5
  const probe = getOrThrow(await reader.read(0, Math.min(info.size, BINARY_PROBE_BYTES), context));
  if (probe.includes(0)) return { kind: "binary" };

  const startLine = offset === undefined ? 0 : Math.max(0, offset - 1);
  const startLineDisplay = startLine + 1;
  // A start beyond any file is scanned from 0 only to count lines; the offset check below then fails as before.
  const scanStart = Number.isSafeInteger(startLine) ? startLine : 0;
  const requestedEnd = limit === undefined ? undefined : Math.max(scanStart + 1, startLine + limit);
  const scanEnd =
    requestedEnd !== undefined && Number.isSafeInteger(requestedEnd) ? requestedEnd : undefined;
  const scan = getOrThrow(
    await reader.scanLines(
      { startLine: scanStart, ...(scanEnd === undefined ? {} : { endLine: scanEnd }) },
      context,
    ),
  );
  const totalFileLines = scan.newlines + 1;
  // XEON-PATCH: P5
  const lastByte =
    info.size === 0 ? undefined : getOrThrow(await reader.read(info.size - 1, 1, context))[0];
  const fileLines = info.size === 0 ? 0 : totalFileLines - (lastByte === NEWLINE ? 1 : 0);
  // XEON-PATCH: P5
  if (startLine >= Math.max(fileLines, 1)) return { kind: "beyond_end", fileLines };

  const selectedLineCount =
    limit === undefined
      ? totalFileLines - startLine
      : Math.min(startLine + limit, totalFileLines) - startLine;
  // Counted like `truncateHead`: a trailing newline adds no line, and empty text has none.
  const endsWithNewline = scan.lastLineStart === scan.end && scan.lastLineStart > scan.start;
  const totals = {
    lines: scan.selectedBytes === 0 ? 0 : selectedLineCount - (endsWithNewline ? 1 : 0),
    bytes: scan.selectedBytes,
  };
  const head = await readHead(reader, scan.start, scan.end, startsWithBom(probe), limits, context);

  const { content: headText, ...truncation } = truncateHeadOf(head, totals, limits);
  if (truncation.firstLineExceedsLimit) {
    // Show the start of the line, cut at the byte limit on a character boundary.
    const lineBytes = new TextEncoder().encode(head.split("\n")[0] ?? "");
    const end = characterEnd(lineBytes, limits.maxBytes);
    return {
      kind: "text",
      slice: {
        text: new TextDecoder().decode(lineBytes.subarray(0, end)),
        startLine: startLineDisplay,
        shownLines: 1,
        fileLines,
        cutBy: "bytes",
        firstLineCut: true,
      },
    };
  }
  return {
    kind: "text",
    slice: {
      text: headText,
      startLine: startLineDisplay,
      shownLines: truncation.outputLines,
      fileLines,
      cutBy: truncation.truncatedBy,
      firstLineCut: false,
    },
  };
}
