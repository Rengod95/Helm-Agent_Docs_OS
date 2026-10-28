import { basename } from "node:path";
import { assertNever } from "@xeon/contracts";
import type { CommandIo, HostCommand } from "../host-command.ts";
import { serviceStatus, stopHostService } from "./control.ts";
import { ensureHostService, type ServiceCommand } from "./ensure.ts";
import { resolveLaunchMode } from "./launch-mode.ts";
import { startService } from "./lifetime.ts";

// L4.host-service.spec §3.2 표. `xeon service start|status|stop|ensure|launch-mode|run`의 본체. 종료코드: 0 성공, 1 실패(시작 거부, 서비스 없음 등).

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

export async function runServiceCommand(
  command: ServiceHostCommand,
  io: CommandIo,
): Promise<0 | 1 | 2> {
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
            `the running service is version ${registration.version} and is busy; run "xeon service stop" to replace it\n`,
          );
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
        await write(io.stdout, `${JSON.stringify(status.value)}\n`);
        return status.value.running ? 0 : 1;
      }
      if (!status.value.running) {
        await write(io.stdout, `service not running (${status.value.reason})\n`);
        return 1;
      }
      const { registration, status: host } = status.value;
      await write(
        io.stdout,
        [
          `service running (pid ${String(registration.pid)}, version ${registration.version})`,
          `socket ${registration.socket}`,
          `connections ${String(host.connections)}, live turns ${String(host.liveTurns)}`,
          `idle shutdown ${host.idleShutdownAt ?? "none"}${host.safeMode === true ? ", safe mode" : ""}`,
          "",
        ].join("\n"),
      );
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
