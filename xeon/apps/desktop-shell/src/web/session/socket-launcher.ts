// 게이트웨이의 `Launcher`. 서비스 Unix 소켓에 직접 붙고 자식 프로세스를 띄우지 않는다(L4.remote.spec §5.1, §7).
// 서비스가 연 소켓과 서비스 쪽 자세(2026-11-09 확인):
// - 여는 곳: `apps/host/src/service/lifetime.ts`가 `listenSocket({kind: "unix"})`로 연다(`packages/platform-process/src/transport/socket.ts`).
//   토큰도 접속 전 메시지도 없다. 소켓 파일은 0600이고 디렉터리는 0700이다.
// - 전송: JSON Lines다. 메시지 하나가 `\n`으로 끝나는 한 줄이고 한 줄의 한도는 `maxFrameBytes`(기본 1 MiB)다
//   (`packages/contracts/src/wire-settings/wire/framing.ts`).
// - 연결 뒤: 서버는 먼저 보내지 않는다(연결은 `awaitingHello` 상태로 시작한다, `apps/host/src/connection.ts`).
//   첫 메시지는 클라이언트(엔진 UI)가 보내는 `host.hello`다. 이 파일은 바이트를 해석하지 않고 옮긴다.
//   서비스 쪽 브리지(`apps/host/src/service/bridge.ts`)도 줄 단위 envelope 검사만 하고 옮긴다.
// 그래서 stdout 조각은 서비스가 보낸 바이트 그대로이고 stdin 쓰기는 받은 바이트 그대로 나간다.
//
// 이 launcher가 하지 않는 것:
// - 서비스 기동(`service ensure`). 게이트웨이는 소켓 경로를 받아 붙기만 한다.
// - 안전 모드 플래그. 안전 모드는 서비스 기동 때 정해지므로 붙은 서비스에는 적용되지 않는다(`safeMode`는 무시한다).
// - 기기 이름 전달(`client.name`). 바이트를 옮기므로 이름을 넣을 자리가 없다. 이름은 UI의 `host.hello`가 정한다.
// - 원격 대상. 웹 탭은 origin 하나에만 붙는다(`engine_retarget`은 웹에서 숨긴다).
// - 한 번 돌리기(`runOnce`). 명령줄 호출은 사이드카로 가고 `web-context.ts`가 그 결합을 맡는다.
import { createConnection, type Socket } from "node:net";
import { attempt, err, ok, repeatAsync, type Result } from "@fresnel/contracts";
import { errnoCode } from "../../main/lib/narrow.ts";
import type { EngineEvent, Launched, LaunchFailure, Launcher } from "../../main/engine/launcher.ts";

export interface SocketLauncherOptions {
  /** 서비스 Unix 소켓의 절대 경로 */
  readonly socketPath: string;
}

/** 서비스 소켓에 붙는 launcher. `launch`는 연결이 될 때까지 기다린다 */
export function createSocketLauncher(options: SocketLauncherOptions): Launcher {
  return {
    launch(target) {
      if (target.kind === "remote") {
        return Promise.resolve(err({ message: "the gateway serves only the local service" }));
      }
      return connectUnix(options.socketPath);
    },
    runOnce() {
      return Promise.resolve(
        err({ message: "one-shot commands are not run over the service socket" }),
      );
    },
  };
}

/** 서비스 소켓에 연결한다. 연결이 되면 `Launched`, 안 되면 오류 한 줄(코드만, 경로는 싣지 않는다)이다 */
function connectUnix(socketPath: string): Promise<Result<Launched, LaunchFailure>> {
  return new Promise((resolve) => {
    // 경로 글자가 잘못되면 노드가 바로 던진다. 그것도 띄우지 못한 이유 하나로 답한다
    const made = attempt(() => createConnection({ path: socketPath }));
    if (!made.ok) {
      resolve(
        err({ message: `the service socket is not reachable (${codeOf(made.error.cause)})` }),
      );
      return;
    }
    const socket = made.value;
    const onError = (cause: Error): void => {
      socket.destroy();
      resolve(err({ message: `the service socket is not reachable (${codeOf(cause)})` }));
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(ok(launchedOf(socket)));
    });
  });
}

function codeOf(cause: unknown): string {
  return errnoCode(cause) ?? "error";
}

/**
 * 연결된 소켓을 `Launched`로 바꾼다. 이벤트는 한 번에 하나만 쥔다. 소비자가 받을 때까지 소켓을 멈춰
 * 역압이 서비스까지 간다(`engine/launcher.ts`의 `eventsOf`와 같은 방식).
 */
function launchedOf(socket: Socket): Launched {
  const queue: EngineEvent[] = [];
  let finished = false;
  let wake: (() => void) | null = null;
  const push = (event: EngineEvent): void => {
    queue.push(event);
    const awake = wake;
    wake = null;
    awake?.();
  };
  socket.on("data", (chunk: Buffer) => {
    // 복사해 둔다. 소켓 버퍼를 소비자가 읽을 때까지 쥐지 않는다
    push({ kind: "stdout", bytes: new Uint8Array(chunk) });
    socket.pause();
  });
  socket.on("error", (cause: Error) => {
    push({ kind: "error", message: codeOf(cause) });
  });
  socket.on("close", () => {
    finished = true;
    // 소켓에는 종료 코드가 없다. 연결이 끝났다는 사실만 본다(감독자는 재기동 정책을 따른다)
    push({ kind: "terminated", code: null, signal: null });
  });
  return {
    // 자식 프로세스가 없다. 0은 "이 엔진은 프로세스가 아니다"라는 뜻이다
    pid: 0,
    viaService: true,
    events: {
      next: () =>
        repeatAsync<EngineEvent | null>(async () => {
          const head = queue.shift();
          if (head !== undefined) return { value: head };
          if (finished) return { value: null };
          socket.resume();
          await new Promise<void>((resolve) => {
            wake = () => {
              resolve();
            };
          });
          return undefined;
        }),
    },
    stdin: {
      write: (bytes) =>
        new Promise<void>((resolve, reject) => {
          socket.write(bytes, (cause) => {
            if (cause) {
              reject(cause);
              return;
            }
            resolve();
          });
        }),
      // stdin을 닫는 것은 EOF다. 서비스가 연결을 닫으면 `close` 이벤트로 끝난다
      close: () => {
        socket.end();
      },
    },
    killGroup: () => {
      socket.destroy();
    },
  };
}
