import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertNever,
  attempt,
  err,
  ok,
  type Clock,
  type Result,
  type Scheduler,
} from "@xeon/contracts";
import type { TunnelFailure, TunnelPort, TunnelRequest } from "@xeon/client/socket";
import { resolveOsDirs } from "@xeon/platform-os";
import { openTunnel, sshTunnelCommand } from "@xeon/platform-process";
import { hostResourceDir } from "../state-paths.ts";
import { systemTime } from "./time.ts";

// L4.host-service.spec §3.3.4, L0.process.spec §4.4.8. `@xeon/client`의 `TunnelPort`를 L0 `openTunnel`로 채운다. 프로세스를 띄우는 일은 L0만 하므로
// (DR-07) 클라이언트 패키지는 포트만 알고 이 조립이 실제 `ssh -L`을 잇는다. 로컬 소켓은 이 프로세스만 쓸 수 있는 새 임시 디렉터리(0700) 안에 만든다.

export interface TunnelCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface SshTunnelPortOptions {
  /** 시험이 `ssh` 대신 다른 명령(socat 중계)을 쓴다. 기본은 `sshTunnelCommand` */
  readonly buildCommand?: (
    request: TunnelRequest,
    localSocket: string,
  ) => Result<TunnelCommand, TunnelFailure>;
  readonly time?: { readonly clock: Clock; readonly scheduler: Scheduler };
  readonly readyTimeoutMs?: number;
}

function defaultCommand(
  request: TunnelRequest,
  localSocket: string,
): Result<TunnelCommand, TunnelFailure> {
  const built = sshTunnelCommand({
    target: request.target,
    remoteSocket: request.remoteSocket,
    localSocket,
    ...(request.port === undefined ? {} : { port: request.port }),
  });
  return built.ok
    ? ok(built.value)
    : err({ kind: "invalid_request", detail: `invalid ${built.error.kind}` });
}

export function createSshTunnelPort(options: SshTunnelPortOptions = {}): TunnelPort {
  const time = options.time ?? systemTime();
  const build = options.buildCommand ?? defaultCommand;
  return {
    async open(request) {
      const dirs = resolveOsDirs({ resourceDir: hostResourceDir() });
      if (!dirs.ok) return err({ kind: "spawn_failed", detail: "the temp directory is unknown" });
      const made = attempt(() => mkdtempSync(join(dirs.value.tmp, "xtun-")));
      if (!made.ok)
        return err({ kind: "spawn_failed", detail: "the temp directory cannot be made" });
      const dir = made.value;
      const cleanup = (): void => {
        attempt(() => {
          rmSync(dir, { recursive: true, force: true });
        });
      };
      const localSocket = join(dir, "s");
      const command = build(request, localSocket);
      if (!command.ok) {
        cleanup();
        return command;
      }
      const opened = await openTunnel(
        {
          command: command.value.command,
          args: command.value.args,
          localSocket,
          ...(options.readyTimeoutMs === undefined
            ? {}
            : { readyTimeoutMs: options.readyTimeoutMs }),
        },
        time,
      );
      if (!opened.ok) {
        cleanup();
        const failure = opened.error;
        switch (failure.kind) {
          case "exited":
            return err({
              kind: "exited",
              detail: failure.stderr.trim() || `exit ${String(failure.code)}`,
            });
          case "timeout":
            return err({ kind: "timeout", detail: failure.stderr.trim() });
          case "spawn_failed":
            return err({ kind: "spawn_failed", detail: failure.code });
          case "path_too_long":
            return err({ kind: "path_too_long", detail: failure.path });
          default:
            return assertNever(failure, "TunnelError");
        }
      }
      const tunnel = opened.value;
      return ok({
        localSocket,
        async close() {
          await tunnel.close();
          cleanup();
        },
      });
    },
  };
}
