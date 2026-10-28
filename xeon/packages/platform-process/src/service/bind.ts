import { unlinkSync } from "node:fs";
import { attempt, err, type Logger, type Result } from "@xeon/contracts";
import {
  connectSocket,
  listenSocket,
  type SocketError,
  type SocketListener,
} from "../transport/socket.ts";

// L0.process.spec §4.4.3 이중 기동 방지. 고정 소켓 경로를 먼저 바인드한 쪽이 이긴다.
// 1. listenSocket(path). 성공하면 이긴 것이다.
// 2. address_in_use면 connect(path)로 상대를 확인한다. 접속되면 진 쪽이다(`in_use`).
// 3. 접속이 거부되면(refused, not_found) 낡은 소켓 파일이다. 활성화 잠금을 쥔 동안에만 지우고 다시 바인드한다.
//    잠금을 못 얻으면 다른 경합자가 처리 중이므로 진 쪽이다.

export type BindError = { readonly kind: "in_use" } | SocketError;

/** 활성화 잠금. fn을 돌리는 동안 쥐고, 이미 다른 경합자가 쥐었으면 `busy`를 값으로 돌려준다 */
export type ActivationLock = <T>(
  fn: () => Promise<T>,
) => Promise<Result<T, { readonly kind: "busy" }>>;

export interface BindServiceSocketOptions {
  readonly path: string;
  readonly maxFrameBytes?: number;
  readonly activationLock: ActivationLock;
  readonly logger?: Logger;
}

export async function bindServiceSocket(
  options: BindServiceSocketOptions,
): Promise<Result<SocketListener, BindError>> {
  const { path } = options;
  const listenOptions = {
    kind: "unix" as const,
    path,
    ...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
  };
  const first = await listenSocket(listenOptions, options.logger);
  if (first.ok) return first;
  if (first.error.kind !== "address_in_use") return first;

  const probe = await connectSocket({ kind: "unix", path }, options.logger);
  if (probe.ok) {
    await probe.value.close("probe");
    return err({ kind: "in_use" });
  }
  if (probe.error.kind !== "refused" && probe.error.kind !== "not_found") return err(probe.error);

  const rebound = await options.activationLock(
    async (): Promise<Result<SocketListener, BindError>> => {
      // 잠금을 얻은 사이에 다른 경합자가 이미 바인드했을 수 있다. 그때는 지우지 않는다
      const again = await connectSocket({ kind: "unix", path }, options.logger);
      if (again.ok) {
        await again.value.close("probe");
        return err({ kind: "in_use" });
      }
      const removed = attempt(() => {
        unlinkSync(path);
      });
      if (!removed.ok && !isMissing(removed.error.cause)) {
        return err({ kind: "io", code: codeOf(removed.error.cause) });
      }
      return listenSocket(listenOptions, options.logger);
    },
  );
  if (!rebound.ok) return err({ kind: "in_use" });
  return rebound.value;
}

function codeOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function isMissing(caught: unknown): boolean {
  return codeOf(caught) === "ENOENT";
}
