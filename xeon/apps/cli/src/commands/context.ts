import { err, ok, type Result } from "@xeon/contracts";
import type { JsonRpcMessage } from "@xeon/contracts/wire";
import type { GlobalOptions } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, failureOfStart, renderFailure, type Failure } from "../errors.ts";
import type { ExitCode } from "../exit-codes.ts";
import type { CliDeps, CliIo } from "../io.ts";
import { cliSettings } from "../settings.ts";
import { CLI_VERSION } from "./version.ts";

// 명령들이 함께 쓰는 실행 문맥과 엔진 연결 도우미.

export interface CommandContext {
  readonly io: CliIo;
  readonly deps: CliDeps;
  readonly global: GlobalOptions;
  /** 작업 폴더 절대 경로 */
  readonly workspace: string;
}

export async function printFailure(
  io: CliIo,
  failure: Pick<Failure, "message" | "fix">,
): Promise<void> {
  await io.stderr(renderFailure(failure));
}

/** 엔진을 시작할 때 명령줄이 더하는 옵션 */
export interface EngineStartFlags {
  /** `--safe-mode`(chat) */
  readonly safeMode?: boolean;
}

/**
 * 엔진에 연결한다(host.hello까지). 실패하면 두 줄 오류를 stderr에 쓰고 종료 코드를 돌려준다(§4.1 4번).
 * observe는 JSON 모드의 메시지 탭이다.
 */
export async function connectOrReport(
  ctx: CommandContext,
  observe?: (message: JsonRpcMessage) => void,
  options: EngineStartFlags = {},
): Promise<Result<EngineHandle, ExitCode>> {
  const connected = await connectOrReportQuiet(ctx, observe, options);
  if (connected.ok) return ok(connected.value);
  await printFailure(ctx.io, connected.error);
  return err(connected.error.code);
}

/** 엔진에 연결한다. 실패는 출력하지 않고 값으로 돌려준다(doctor가 실패도 진단 항목으로 보인다) */
export async function connectOrReportQuiet(
  ctx: CommandContext,
  observe?: (message: JsonRpcMessage) => void,
  options: EngineStartFlags = {},
): Promise<Result<EngineHandle, Failure>> {
  const connected = await ctx.deps.connect({
    workspace: ctx.workspace,
    ...(options.safeMode === true ? { safeMode: true } : {}),
    preference: "auto",
    client: { name: "xeon-cli", version: CLI_VERSION },
    settingGroups: [cliSettings],
    devWireRoundTrip: ctx.deps.devWireRoundTrip,
    ...(observe === undefined ? {} : { observe }),
    ...(ctx.deps.assemble === undefined ? {} : { assemble: ctx.deps.assemble }),
    ...(ctx.deps.stateFile === undefined ? {} : { stateFile: ctx.deps.stateFile }),
  });
  if (connected.ok) return ok(connected.value);
  return err(failureOfStart(connected.error));
}

/**
 * 명령 실행 중 잡은 값을 두 줄 오류로 알리고 종료 코드를 돌려준다. wire 오류와 연결 끊김이 아닌 값(버그)은 그대로 다시 던진다.
 */
export async function reportCaught(io: CliIo, caught: unknown): Promise<ExitCode> {
  const failure = failureOfCaught(caught);
  if (failure === undefined) throw caught;
  await printFailure(io, failure);
  return failure.code;
}

/** 엔진을 정상 종료하고 종료 코드를 그대로 돌려준다(§4.1 5번) */
export async function closeEngine(handle: EngineHandle, code: ExitCode): Promise<ExitCode> {
  await handle.shutdown("user");
  return code;
}

/**
 * 엔진에 연결해 작업을 하고 끝나면 닫는다. 연결 실패는 두 줄 오류로 알리고, 작업 중 wire 오류와 연결 끊김도 같다.
 * 작업이 종료 코드를 돌려주면 그대로 쓴다(§4.1 5번). 버그(그 밖의 예외)는 엔진을 닫은 뒤 다시 던진다.
 */
export async function withEngine(
  ctx: CommandContext,
  work: (handle: EngineHandle) => Promise<ExitCode>,
): Promise<ExitCode> {
  const connected = await connectOrReport(ctx);
  if (!connected.ok) return connected.error;
  const handle = connected.value;
  try {
    const code = await work(handle);
    return await closeEngine(handle, code);
  } catch (caught) {
    await handle.shutdown("user");
    return reportCaught(ctx.io, caught);
  }
}
