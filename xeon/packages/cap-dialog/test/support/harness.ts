import { err, ok, type LogFields, type Logger } from "@xeon/contracts";
import type { CallOptions, StatusItem } from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { FileError, type FileInfo } from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { DialogDeps } from "../../src/deps.ts";
import type { BlobSink } from "../../src/ports/blobs.ts";
import type { AttachmentFiles } from "../../src/ports/files.ts";
import type { ShellFailure, ShellPort } from "../../src/ports/shell.ts";
import type { StatusPublisher } from "../../src/ports/session.ts";
import { readDialogSettings } from "../../src/settings.ts";
import type { RealApprovals } from "./real-approvals.ts";
import { memoryCommandFiles, type MemoryCommandFiles } from "./memory-command-files.ts";
import { manualTimers, type ManualTimers } from "./timers.ts";

export interface LogLine {
  readonly event: string;
  readonly fields: LogFields | undefined;
}

export function recordingLogger(lines: LogLine[]): Logger {
  const logger: Logger = {
    debug: (event, fields) => void lines.push({ event, fields }),
    info: (event, fields) => void lines.push({ event, fields }),
    warn: (event, fields) => void lines.push({ event, fields }),
    error: (event, fields) => void lines.push({ event, fields }),
    child: () => logger,
  };
  return logger;
}

const ids = fixedIdFactory(5000);

/** 시험마다 새 스레드 id */
export function newThread(): ThreadId {
  return ids.next("thr");
}

/** 대화 문맥과 requestId를 실은 호출 옵션 */
export function callOptions(
  threadId: ThreadId,
  extra: { readonly requestId?: string; readonly signal?: AbortSignal } = {},
): CallOptions {
  return {
    context: { threadId, caller: { kind: "model", agent: "main" } },
    ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
    ...(extra.signal === undefined ? {} : { signal: extra.signal }),
  };
}

export interface FakeShell extends ShellPort {
  readonly calls: { readonly command: string; readonly requestId: string }[];
  /** 다음 명령들이 차례로 쓸 응답. 비면 빈 출력 성공 */
  reply(...replies: ({ output: string } | ShellFailure)[]): void;
}

export function fakeShell(): FakeShell {
  const calls: FakeShell["calls"][number][] = [];
  const replies: ({ output: string } | ShellFailure)[] = [];
  return {
    calls,
    reply: (...next) => {
      replies.push(...next);
    },
    run: (command, context) => {
      calls.push({ command, requestId: context.requestId });
      const next = replies.shift() ?? { output: "" };
      if ("output" in next) return Promise.resolve(ok({ output: next.output }));
      return Promise.resolve(err(next));
    },
  };
}

interface FakeStatus extends StatusPublisher {
  readonly published: { readonly threadId: ThreadId; readonly items: readonly StatusItem[] }[];
}

function fakeStatus(): FakeStatus {
  const published: FakeStatus["published"][number][] = [];
  return {
    published,
    publish: (threadId, items) => {
      published.push({ threadId, items });
    },
  };
}

export interface MemoryFiles extends AttachmentFiles {
  put(path: string, content: Uint8Array | string): void;
  mkdir(path: string): void;
}

/** 첨부 원천 파일 대역 */
export function memoryFiles(): MemoryFiles {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const encoder = new TextEncoder();
  return {
    put: (path, content) => {
      files.set(path, typeof content === "string" ? encoder.encode(content) : content);
    },
    mkdir: (path) => {
      dirs.add(path);
    },
    fileInfo: (path) => {
      const name = path.split("/").at(-1) ?? "";
      const bytes = files.get(path);
      if (bytes !== undefined) {
        const info: FileInfo = { name, path, kind: "file", size: bytes.length, mtimeMs: 1 };
        return Promise.resolve(ok(info));
      }
      if (dirs.has(path)) {
        return Promise.resolve(ok({ name, path, kind: "directory", size: 0, mtimeMs: 1 }));
      }
      return Promise.resolve(err(new FileError("not_found", `not found: ${path}`, path)));
    },
    readBinaryFile: (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) {
        return Promise.resolve(err(new FileError("not_found", `not found: ${path}`, path)));
      }
      if (path.includes("/denied/")) {
        return Promise.resolve(err(new FileError("permission_denied", `denied: ${path}`, path)));
      }
      return Promise.resolve(ok(bytes));
    },
  };
}

export interface Harness {
  readonly deps: DialogDeps;
  /** `harness({ approvals })`로 실제 승인 서비스를 붙였을 때만 있다 */
  readonly approvals: RealApprovals | undefined;
  readonly timers: ManualTimers;
  readonly shell: FakeShell;
  readonly status: FakeStatus;
  readonly commandFiles: MemoryCommandFiles;
  readonly files: MemoryFiles;
  readonly lines: LogLine[];
}

export interface HarnessOptions {
  readonly layers?: ScopeStack;
  readonly approvals?: RealApprovals | null;
  readonly shell?: FakeShell | null;
  readonly commandFiles?: MemoryCommandFiles;
  readonly blobs?: BlobSink | null;
  readonly images?: DialogDeps["images"];
  readonly interactive?: DialogDeps["interactive"];
  readonly projectRoot?: (threadId: ThreadId | undefined) => string | null;
  readonly timers?: ManualTimers;
}

/** 실제 승인 서비스를 붙인 조립 */
export interface ApprovingHarness extends Harness {
  readonly approvals: RealApprovals;
}

/** 대역으로 서비스 의존을 만든다. 승인은 `realApprovals()`를 넘길 때만 붙는다(생략하거나 null이면 없다) */
export function harness(
  options: HarnessOptions & { readonly approvals: RealApprovals },
): ApprovingHarness;
export function harness(options?: HarnessOptions): Harness;
export function harness(options: HarnessOptions = {}): Harness {
  const approvals = options.approvals ?? undefined;
  const shell = options.shell === null ? undefined : (options.shell ?? fakeShell());
  const timers = options.timers ?? manualTimers();
  const status = fakeStatus();
  const commandFiles = options.commandFiles ?? memoryCommandFiles();
  const files = memoryFiles();
  const lines: LogLine[] = [];
  const layers = options.layers ?? [];
  const deps: DialogDeps = {
    logger: recordingLogger(lines),
    timers,
    settings: () => readDialogSettings(layers),
    approvals: approvals?.factory,
    interactive: options.interactive ?? (() => true),
    shell,
    commandFiles,
    commandRoots: {
      userDir: "/home/user/.xeon/commands",
      home: "/home/user",
      projectRoot: options.projectRoot ?? (() => "/work"),
    },
    files,
    images: options.images,
    blobs: options.blobs === null ? undefined : options.blobs,
    status,
    feed: undefined,
  };
  return {
    deps,
    approvals,
    timers,
    shell: shell ?? fakeShell(),
    status,
    commandFiles,
    files,
    lines,
  };
}

/** 진행 중인 비동기 호출이 다음 대기점에 이를 때까지 기다린다(실제 승인 서비스는 요청 하나에 대기점이 여럿이다). 가짜 타이머와 무관한 실제 한 틱이다 */
export async function flushTicks(): Promise<void> {
  await Bun.sleep(0);
}
