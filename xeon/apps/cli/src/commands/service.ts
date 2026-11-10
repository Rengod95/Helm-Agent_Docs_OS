import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { CommandIo, HostCommand } from "@fresnel/host";
import type { ServiceCommand } from "../cli/command.ts";
import { EXIT, exitCodeOfHost, type ExitCode } from "../exit-codes.ts";
import { confirmed, printFailure, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 service. `fresnel service start|status|stop|ensure|pair|install|uninstall`와 숨은 `launch-mode`·`run`. 엔진을 이 프로세스에서 열지 않는다:
// @fresnel/host의 runHostCommand가 등록 파일과 소켓으로 서비스를 찾고 띄우고 내린다(L4.host-service.spec §3.3.5, §4.9).
// `run`은 서비스 본체를 전경에서 돌린다. `start`와 `ensure`가 자기 바이너리를 `service run`으로 detached 실행한다(SV-06).
// `install`은 `--yes`가 있거나 터미널에서 y로 답했을 때만 호스트를 부른다. 터미널이 아니면 `--yes` 없이 사용법 오류(2)다(L4.cli.spec §3.6).

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function textSink(write: (text: string) => Promise<void>): WritableStream<Uint8Array> {
  const decoder = new TextDecoder();
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await write(decoder.decode(chunk, { stream: true }));
    },
  });
}

const discard = (): Promise<void> => Promise.resolve();

/** CLI 명령을 호스트 명령으로 옮긴다. 순수 함수 */
function hostCommandOf(command: ServiceCommand): HostCommand {
  switch (command.action) {
    case "start":
      return {
        kind: "service-start",
        ...(command.safeMode ? { safeMode: true } : {}),
        ...(command.listenTcp === null ? {} : { tcp: command.listenTcp }),
        ...(command.allowNonLoopback ? { allowNonLoopback: true } : {}),
      };
    case "ensure":
      return { kind: "service-ensure", ...(command.safeMode ? { safeMode: true } : {}) };
    case "status":
      return { kind: "service-status", json: command.output === "json" };
    case "stop":
      return { kind: "service-stop" };
    case "launch-mode":
      return { kind: "service-launch-mode" };
    case "pair":
      return { kind: "service-pair", json: command.output === "json" };
    case "install":
      return { kind: "service-install" };
    case "uninstall":
      return { kind: "service-uninstall" };
    case "run":
      return {
        kind: "service-run",
        safeMode: command.safeMode,
        ...(command.listenTcp === null ? {} : { tcp: command.listenTcp }),
        ...(command.allowNonLoopback ? { allowNonLoopback: true } : {}),
      };
    default:
      return assertNever(command.action, "ServiceAction");
  }
}

export async function runService(ctx: CommandContext, command: ServiceCommand): Promise<ExitCode> {
  // 로그인 자동 시작은 사용자 홈에 파일을 쓰고 불러온다. `--yes`가 없으면 확인을 받는다(db previous-rm과 같은 규칙)
  if (command.action === "install" && !command.yes) {
    if (!ctx.io.terminal.stdinIsTty) {
      await printFailure(ctx.io, {
        message: t("cli.service.install.consent.message"),
        fix: t("cli.service.install.consent.fix"),
      });
      return EXIT.usage;
    }
    if (!(await confirmed(ctx, t("cli.service.install.confirm")))) {
      await ctx.io.stderr(`${t("cli.service.install.kept")}\n`);
      return EXIT.error;
    }
  }
  // `--json`의 설치·해제는 호스트의 사람용 문장을 버리고 성공했을 때 JSON 한 줄만 쓴다
  const jsonLine =
    command.output === "json" && (command.action === "install" || command.action === "uninstall");
  const io: CommandIo = {
    stdin: emptyStream(),
    stdout: textSink(jsonLine ? discard : ctx.io.stdout),
    stderr: textSink(ctx.io.stderr),
  };
  const code = await ctx.deps.runHostCommand(hostCommandOf(command), io);
  // `service pair`의 호스트 종료코드 2는 사용법이 아니라 환경 문제(게이트웨이 실행 파일·인증서·포트)다
  if (command.action === "pair" && code === 2) return EXIT.environment;
  // 등록과 해제가 실패하면 호스트는 1을 돌려준다. 이유는 쓰기 실패, launchctl·systemctl 없음 또는 실패, 지원하지 않는 플랫폼뿐이라 환경 문제(3)다
  if ((command.action === "install" || command.action === "uninstall") && code === 1) {
    return EXIT.environment;
  }
  if (jsonLine && code === 0) {
    await ctx.io.stdout(`${JSON.stringify({ ok: true, action: command.action })}\n`);
  }
  return exitCodeOfHost(code);
}
