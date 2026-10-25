import { assertNever, attemptAsync } from "@xeon/contracts";
import type { TrustStatus } from "@xeon/contracts/wire";
import type { TrustCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, renderFailure, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import type { PromptIo } from "../render/approval.ts";
import { askTrust, describeTrust, optionText } from "../render/trust.ts";
import { printFailure, withEngine, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 trust, §4.11 "프로젝트 신뢰". `xeon trust`는 이 작업 폴더의 신뢰 상태를 보이고(trust.get),
// `xeon trust allow|deny`는 선택지 하나를 host에 보낸다(trust.decide). 저장 파일(trust.json)의 잠금은 host가 맡는다.
// 신뢰는 `.mcp.json`, 프로젝트 스킬, 프로젝트 슬래시 명령, 프로젝트 설정을 읽을지 정한다. 대화형 chat도 시작할 때 같은 카드를 묻는다.

const UNSUPPORTED: Failure = {
  message: "연결한 host가 프로젝트 신뢰 결정을 아직 지원하지 않는다",
  fix: "host를 갱신하거나 신뢰 파일(trust.json)을 직접 고친다",
  code: EXIT.environment,
};

function supportsTrust(handle: EngineHandle): boolean {
  return handle.supports("trust.get") && handle.supports("trust.decide");
}

async function runStatus(
  ctx: CommandContext,
  handle: EngineHandle,
  output: "text" | "json",
): Promise<ExitCode> {
  if (!supportsTrust(handle)) {
    await printFailure(ctx.io, UNSUPPORTED);
    return UNSUPPORTED.code;
  }
  const status = await handle.connection.request("trust.get", { workspace: ctx.workspace });
  if (output === "json") {
    await ctx.io.stdout(`${JSON.stringify(status, null, 2)}\n`);
  } else if (!status.required) {
    await ctx.io.stderr(`${status.projectRoot}: 신뢰가 필요한 프로젝트 자원이 없다\n`);
  } else {
    await ctx.io.stdout(describeTrust(status));
  }
  return EXIT.ok;
}

async function runSet(
  ctx: CommandContext,
  handle: EngineHandle,
  command: Extract<TrustCommand, { kind: "trust.set" }>,
): Promise<ExitCode> {
  if (!supportsTrust(handle)) {
    await printFailure(ctx.io, UNSUPPORTED);
    return UNSUPPORTED.code;
  }
  const status = await handle.connection.request("trust.get", { workspace: ctx.workspace });
  const option = status.options.find(
    (candidate) =>
      candidate.choice.kind === command.scope && candidate.choice.verdict === command.verdict,
  );
  if (option === undefined) {
    const offered = status.options.map((candidate) => optionText(candidate)).join(" / ");
    await ctx.io.stderr(
      renderFailure({
        message: `이 폴더에는 ${command.scope} 범위의 ${command.verdict} 선택지가 없다`,
        fix: `xeon trust로 선택지를 확인한다 (${offered})`,
      }),
    );
    return EXIT.usage;
  }
  const decided = await handle.connection.request("trust.decide", {
    workspace: ctx.workspace,
    choice: option.choice,
  });
  await ctx.io.stdout(`${optionText(option)}: ${decided.projectRoot}\n`);
  return EXIT.ok;
}

/** `xeon trust`를 실행하고 종료 코드를 돌려준다 */
export async function runTrust(ctx: CommandContext, command: TrustCommand): Promise<ExitCode> {
  return withEngine(ctx, (handle) => {
    switch (command.kind) {
      case "trust.status":
        return runStatus(ctx, handle, command.output);
      case "trust.set":
        return runSet(ctx, handle, command);
      default:
        return assertNever(command, "TrustCommand");
    }
  });
}

/** 신뢰가 필요한 자원이 있는데 결정이 없는 폴더인가 */
function needsDecision(status: TrustStatus): boolean {
  return status.required && status.verdict === "undecided";
}

/**
 * 대화형 chat이 시작할 때 이 작업 폴더의 신뢰 카드를 묻는다. 세션을 만들거나 열기 전에 부른다.
 * 지원하지 않는 host는 조용히 지나가고, 읽기·저장 실패는 한 줄로 알린 뒤 신뢰하지 않은 채로 연다(fail-closed).
 * 나중에(엔터)를 고르면 저장하지 않는다
 */
export async function offerTrust(
  ctx: CommandContext,
  handle: EngineHandle,
  io: PromptIo,
  signal: AbortSignal,
): Promise<void> {
  if (!supportsTrust(handle)) return;
  const loaded = await attemptAsync(() =>
    handle.connection.request("trust.get", { workspace: ctx.workspace }),
  );
  if (!loaded.ok) {
    await ctx.io.stderr(
      "프로젝트 신뢰 상태를 읽지 못해 확인을 건너뛴다. 프로젝트 자원은 읽지 않는다\n",
    );
    return;
  }
  if (!needsDecision(loaded.value)) return;
  const choice = await askTrust(loaded.value, io, signal);
  if (choice === undefined || signal.aborted) {
    await ctx.io.stderr(
      "정하지 않았다. 이 프로젝트의 자원은 읽지 않는다 (xeon trust로 나중에 정한다)\n",
    );
    return;
  }
  const decided = await attemptAsync(() =>
    handle.connection.request("trust.decide", { workspace: ctx.workspace, choice }),
  );
  if (decided.ok) return;
  const failure = failureOfCaught(decided.error.cause);
  if (failure === undefined) throw decided.error.cause;
  await ctx.io.stderr(renderFailure(failure));
  await ctx.io.stderr(
    "프로젝트 신뢰 결정을 저장하지 못했다. 이 프로젝트는 신뢰하지 않은 채로 연다\n",
  );
}

/**
 * print 모드는 물을 수 없다. 결정이 없으면 자원을 읽지 않는다는 한 줄을 stderr에 남긴다.
 * JSON 모드는 연결의 메시지 열이 출력 전부라서 부르지 않는다(AC4)
 */
export async function noteUndecidedTrust(ctx: CommandContext, handle: EngineHandle): Promise<void> {
  if (!supportsTrust(handle)) return;
  const loaded = await attemptAsync(() =>
    handle.connection.request("trust.get", { workspace: ctx.workspace }),
  );
  if (!loaded.ok || !needsDecision(loaded.value)) return;
  await ctx.io.stderr(
    `프로젝트 신뢰가 정해지지 않아 ${loaded.value.resources.join(", ")}을(를) 읽지 않는다 (xeon trust로 정한다)\n`,
  );
}
