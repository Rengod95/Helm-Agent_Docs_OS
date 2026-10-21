import { err, ok, type Result } from "@xeon/contracts";
import { forwardFileSystem, type FileMethods } from "../forward.ts";
import {
  ExecutionError,
  FileError,
  type BackgroundExecHandle,
  type CancelScope,
  type ExecService,
  type ExecutionErrorCode,
  type ExecutionEnv,
  type FileSystem,
  type ShellExecOptions,
  type ShellExecResult,
} from "@xeon/contracts/services";

// L0.exec.plan §2 fakeExec. 명령별 응답 표로 ExecService를 대신하는 테스트 대역(eng.testing.guide TS-05).

export type FakeExecReply =
  | { readonly exitCode: number; readonly stdout?: string; readonly stderr?: string }
  | { readonly error: ExecutionErrorCode };

/** 키: 문자열 명령은 그대로, argv는 공백으로 이은 문자열. 함수 키는 지원하지 않는다 */
export type FakeExecTable = Readonly<Record<string, FakeExecReply>>;

export interface FakeExecCall {
  readonly command: string | readonly string[];
  readonly options: Omit<ShellExecOptions, "onOutput"> | undefined;
}

export interface FakeExec extends ExecService {
  readonly calls: readonly FakeExecCall[];
}

export interface FakeExecOptions {
  /** 파일 메서드를 맡길 FileSystem. 없으면 파일 메서드는 `not_supported`를 돌려준다 */
  readonly fs?: FileSystem;
  /** 표에 없는 명령의 응답. 기본 `spawn_error` */
  readonly unknown?: "spawn_error" | "exit127";
}

function notSupported(what: string): Promise<Result<never, FileError>> {
  return Promise.resolve(
    err(new FileError("not_supported", `fakeExec has no file system: ${what}`)),
  );
}

/** fs가 없을 때 파일 메서드가 돌려주는 값 */
function missingFileSystem(): FileMethods {
  return {
    id: "fake:exec",
    absolutePath: () => notSupported("absolutePath"),
    joinPath: () => notSupported("joinPath"),
    readTextFile: () => notSupported("readTextFile"),
    openTextLineReader: () => notSupported("openTextLineReader"),
    readTextLines: () => notSupported("readTextLines"),
    readBinaryFile: () => notSupported("readBinaryFile"),
    openBinaryReader: () => notSupported("openBinaryReader"),
    writeFile: () => notSupported("writeFile"),
    appendFile: () => notSupported("appendFile"),
    truncateFile: () => notSupported("truncateFile"),
    flushFile: () => notSupported("flushFile"),
    renameFile: () => notSupported("renameFile"),
    fileInfo: () => notSupported("fileInfo"),
    listDir: () => notSupported("listDir"),
    openDirReader: () => notSupported("openDirReader"),
    watch: () => notSupported("watch"),
    canonicalPath: () => notSupported("canonicalPath"),
    exists: () => notSupported("exists"),
    createDir: () => notSupported("createDir"),
    remove: () => notSupported("remove"),
    createTempDir: () => notSupported("createTempDir"),
    createTempFile: () => notSupported("createTempFile"),
  };
}

function tableKey(command: string | readonly string[]): string {
  return typeof command === "string" ? command : command.join(" ");
}

const startBackground = (): Promise<Result<BackgroundExecHandle, ExecutionError>> =>
  Promise.resolve(err(new ExecutionError("unknown", "fakeExec does not run background commands")));

export function fakeExec(table: FakeExecTable, options: FakeExecOptions = {}): FakeExec {
  const calls: FakeExecCall[] = [];
  const files = options.fs === undefined ? missingFileSystem() : forwardFileSystem(options.fs);
  const defaultCwd = options.fs?.cwd ?? "/";

  function createEnv(initialCwd: string): ExecutionEnv {
    let envCwd = initialCwd;
    return {
      ...files,
      get cwd(): string {
        return envCwd;
      },
      set cwd(value: string) {
        envCwd = value;
      },
      cleanup: () => Promise.resolve(),
      exec(
        command: string | readonly string[],
        execOptions: ShellExecOptions | undefined,
        context: CancelScope,
      ): Promise<Result<ShellExecResult, ExecutionError>> {
        // secretEnv는 해석하지 않는다. 참조 이름만 calls에 남는다.
        const { onOutput, ...recorded } = execOptions ?? {};
        calls.push({ command, options: execOptions === undefined ? undefined : recorded });
        if (context.abortSignal?.aborted === true) {
          return Promise.resolve(err(new ExecutionError("aborted", "aborted")));
        }
        const reply = table[tableKey(command)];
        if (reply === undefined) {
          if (options.unknown === "exit127") return Promise.resolve(ok({ exitCode: 127 }));
          return Promise.resolve(
            err(new ExecutionError("spawn_error", `fakeExec: no reply for ${tableKey(command)}`)),
          );
        }
        if ("error" in reply) {
          return Promise.resolve(err(new ExecutionError(reply.error, `fakeExec: ${reply.error}`)));
        }
        const emit = (text: string | undefined, stream: "stdout" | "stderr"): void => {
          if (text !== undefined && text !== "") onOutput?.(text, context, { stream });
        };
        emit(reply.stdout, "stdout");
        emit(reply.stderr, "stderr");
        return Promise.resolve(ok({ exitCode: reply.exitCode }));
      },
    };
  }

  const base = createEnv(defaultCwd);
  return {
    ...files,
    get cwd(): string {
      return base.cwd;
    },
    set cwd(value: string) {
      base.cwd = value;
    },
    get calls(): readonly FakeExecCall[] {
      return calls;
    },
    exec: (command, execOptions, context) => base.exec(command, execOptions, context),
    cleanup: (context) => base.cleanup(context),
    withCwd: (derivedCwd) => createEnv(derivedCwd),
    startBackground,
  };
}
