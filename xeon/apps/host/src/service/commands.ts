import { basename } from "node:path";
import { assertNever } from "@fresnel/contracts";
import type { WireResult } from "@fresnel/contracts/wire";
import type { EnsureOutcome, ServiceRegistration } from "@fresnel/platform-process";
import type { CommandIo, HostCommand } from "../host-command.ts";
import { serviceStatus, serviceStatusView, stopHostService } from "./control.ts";
import { ensureHostService, type ServiceCommand } from "./ensure.ts";
import { resolveLaunchMode } from "./launch-mode.ts";
import { startService } from "./lifetime.ts";

// L4.host-service.spec §3.2 표. `fresnel service start|status|stop|ensure|launch-mode|run`의 본체. 종료코드: 0 성공, 1 실패(시작 거부, 서비스 없음 등).

type ServiceHostCommand = Extract<
  HostCommand,
  {
    kind:
      | "service-run"
      | "service-start"
      | "service-status"
      | "service-stop"
      | "service-ensure"
      | "service-launch-mode";
  }
>;

async function write(stream: WritableStream<Uint8Array>, text: string): Promise<void> {
  const writer = stream.getWriter();
  try {
    await writer.write(new TextEncoder().encode(text));
  } finally {
    writer.releaseLock();
  }
}

/** 이 실행 파일이 자기 자신을 `service run`으로 띄우는 명령. 소스 실행(bun 진입 파일)과 컴파일 바이너리를 가른다 */
export function defaultServiceCommand(
  extra: {
    readonly safeMode?: boolean;
    readonly tcp?: { readonly host: string; readonly port: number };
    readonly allowNonLoopback?: boolean;
  } = {},
): ServiceCommand {
  const entry = Bun.main;
  const isScript = /\.(ts|js|mjs)$/.test(entry) && !entry.startsWith("/$bunfs/");
  const flags = [
    ...(extra.safeMode === true ? ["--safe-mode"] : []),
    ...(extra.allowNonLoopback === true ? ["--allow-non-loopback"] : []),
    ...(extra.tcp === undefined
      ? []
      : ["--listen-tcp", `${extra.tcp.host}:${String(extra.tcp.port)}`]),
  ];
  return {
    command: process.execPath,
    args: [
      ...(isScript && basename(process.execPath) !== basename(entry) ? [entry] : []),
      "service",
      "run",
      ...flags,
    ],
  };
}

/** 등록 파일이 적은 TCP 주소(`host:port`). 없으면 undefined. 등록 스키마는 모르는 필드를 남기므로 `in`으로 좁혀 읽는다 */
function tcpAddressOf(registration: ServiceRegistration): string | undefined {
  if (!("tcp" in registration)) return undefined;
  const { tcp } = registration;
  return typeof tcp === "string" ? tcp : undefined;
}

/**
 * 이미 떠 있는 서비스에 `--listen-tcp`를 요청했을 때의 안내(stderr). 새로 띄운 서비스이거나 요청한 주소로 이미 열려 있으면 없다.
 * 이 옵션은 새 서비스를 띄울 때만 적용된다
 */
export function listenTcpNotAppliedNotice(
  requested: { readonly host: string; readonly port: number },
  outcome: EnsureOutcome,
): string | undefined {
  if (outcome.kind !== "connected" || outcome.started) return undefined;
  if (tcpAddressOf(outcome.registration) === `${requested.host}:${String(requested.port)}`) {
    return undefined;
  }
  return 'the service was already running, so --listen-tcp was not applied; run "fresnel service stop" and start it again to open TCP\n';
}

/** `service status`의 사람용 글(서비스가 떠 있을 때). 접속 토큰은 쓰지 않는다 */
export function serviceStatusText(
  registration: ServiceRegistration,
  host: WireResult<"host.status">,
): string {
  const tcp = tcpAddressOf(registration);
  const idle =
    host.idleShutdownAt === null ? "none (clients are connected)" : `at ${host.idleShutdownAt}`;
  return [
    `service running (pid ${String(registration.pid)}, version ${registration.version})`,
    `socket ${registration.socket}`,
    ...(tcp === undefined ? [] : [`tcp ${tcp}`]),
    `connections ${String(host.connections)}, live turns ${String(host.liveTurns)}`,
    `idle shutdown ${idle}${host.safeMode === true ? ", safe mode" : ""}`,
    "",
  ].join("\n");
}

export async function runServiceCommand(
  command: ServiceHostCommand,
  io: CommandIo,
): Promise<0 | 1 | 2 | 70 | 71 | 72 | 73> {
  switch (command.kind) {
    case "service-run": {
      const started = await startService({
        assemble: command.safeMode ? { safeMode: true } : {},
        ...(command.tcp === undefined
          ? {}
          : {
              tcp: {
                ...command.tcp,
                ...(command.allowNonLoopback === true ? { allowNonLoopback: true } : {}),
              },
            }),
      });
      if (!started.started) {
        if (started.reason === "in_use") return 0;
        await write(io.stderr, `${started.message}\n`);
        return 1;
      }
      const exit = await started.handle.exited;
      if (exit.message !== undefined) await write(io.stderr, `${exit.message}\n`);
      return exit.code;
    }
    case "service-start":
    case "service-ensure": {
      const json = command.kind === "service-ensure";
      const ensured = await ensureHostService({
        start:
          command.start ??
          defaultServiceCommand({
            ...(command.safeMode === true ? { safeMode: true } : {}),
            ...(command.kind === "service-start" && command.tcp !== undefined
              ? { tcp: command.tcp }
              : {}),
            ...(command.kind === "service-start" && command.allowNonLoopback === true
              ? { allowNonLoopback: true }
              : {}),
          }),
      });
      if (!ensured.ok) {
        const reason = ensured.error.kind;
        if (json) await write(io.stdout, `${JSON.stringify({ ok: false, reason })}\n`);
        else await write(io.stderr, `the service is not available: ${reason}\n`);
        return 1;
      }
      const { outcome } = ensured.value;
      const registration = outcome.registration;
      const action =
        outcome.kind === "version_mismatch_busy"
          ? "versionWarning"
          : outcome.started
            ? "spawned"
            : "connected";
      if (json) {
        await write(
          io.stdout,
          `${JSON.stringify({ ok: true, socket: registration.socket, version: registration.version, action })}\n`,
        );
      } else {
        await write(
          io.stdout,
          `service ${action} (pid ${String(registration.pid)}, socket ${registration.socket})\n`,
        );
        if (outcome.kind === "version_mismatch_busy") {
          await write(
            io.stderr,
            `the running service is version ${registration.version} and is busy; run "fresnel service stop" to replace it\n`,
          );
        }
        // `--listen-tcp`는 service start에만 있다. 이 분기는 json이 아니라서 command가 service-start로 좁혀진다
        if (command.tcp !== undefined) {
          const notice = listenTcpNotAppliedNotice(command.tcp, outcome);
          if (notice !== undefined) await write(io.stderr, notice);
        }
      }
      return 0;
    }
    case "service-status": {
      const status = await serviceStatus();
      if (!status.ok) {
        await write(io.stderr, `service files cannot be placed: ${status.error.kind}\n`);
        return 1;
      }
      if (command.json) {
        await write(io.stdout, `${JSON.stringify(serviceStatusView(status.value))}\n`);
        return status.value.running ? 0 : 1;
      }
      if (!status.value.running) {
        await write(io.stdout, `service not running (${status.value.reason})\n`);
        return 1;
      }
      const { registration, status: host } = status.value;
      await write(io.stdout, serviceStatusText(registration, host));
      return 0;
    }
    case "service-stop": {
      const stopped = await stopHostService();
      if (!stopped.ok) {
        await write(io.stderr, `service files cannot be placed: ${stopped.error.kind}\n`);
        return 1;
      }
      const result = stopped.value;
      if (result.kind === "failed") {
        await write(io.stderr, `${result.message}\n`);
        return 1;
      }
      await write(
        io.stdout,
        result.kind === "not_running" ? "service not running\n" : "service stopped\n",
      );
      return 0;
    }
    case "service-launch-mode": {
      await write(io.stdout, `${JSON.stringify({ mode: await resolveLaunchMode() })}\n`);
      return 0;
    }
    default:
      return assertNever(command, "ServiceHostCommand");
  }
}
