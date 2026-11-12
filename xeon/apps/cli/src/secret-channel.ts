import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// L4.cli.spec §4.7, F wire §3.3.1 secret.beginEntry·beginReveal. 같은 컴퓨터의 서비스 접속에서 값을 호스트와 주고받는 로컬 일회용 채널.
// CLI가 mkdtemp로 0700 폴더를 만들고 그 안에 유닉스 소켓을 연다. 호스트가 한 번 연결하면 더 받지 않는다.
// 폴더와 소켓은 끝나면(성공, 실패, 취소 모두) 지운다. 경로는 요청의 `channel`로 보내고, 값은 소켓으로만 간다.

/** 첫 연결을 처리한다. 신호는 연결이 끊기면 중단된다 */
export type ChannelHandler = (socket: Socket, signal: AbortSignal) => Promise<void>;

export interface OneShotChannel {
  /** 소켓의 절대 경로. `secret.beginEntry`·`secret.beginReveal`의 `channel`로 보낸다(값이 아니다) */
  readonly path: string;
  /** 채널을 닫는다. 연결이 들어와 처리 중이면 그 처리가 끝나기를 기다린 뒤 폴더를 지운다. 연결이 없었으면 바로 지운다 */
  close(): Promise<void>;
}

/**
 * 채널을 열고 소켓이 listen 상태가 된 뒤 돌아온다. 첫 연결만 `handler`에 넘기고 서버는 곧 닫는다.
 * `handler`는 던지지 않는다. 호스트가 읽다 끊으면 소켓 오류가 나지만 결과는 요청 응답으로 받는다
 */
export async function openOneShotChannel(handler: ChannelHandler): Promise<OneShotChannel> {
  const dir = await mkdtemp(join(tmpdir(), "fresnel-secret-"));
  const path = join(dir, "c.sock");
  const state: { handling: Promise<void> | undefined } = { handling: undefined };
  const server: Server = createServer((socket) => {
    // 한 번만 받는다. 두 번째 연결은 바로 끊는다
    if (state.handling !== undefined) {
      socket.destroy();
      return;
    }
    server.close();
    // 호스트가 연결을 끊으면 처리 중인 입력 요청(취소될 수 있는 프롬프트)도 취소한다
    const abort = new AbortController();
    socket.once("close", () => {
      abort.abort();
    });
    state.handling = handler(socket, abort.signal);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (caught) {
    await rm(dir, { recursive: true, force: true });
    throw caught;
  }
  return {
    path,
    async close() {
      server.close();
      // 호스트가 값을 다 쓰고 닫을 때까지 기다린다(열람은 그 뒤에야 끝까지 읽힌다). 연결이 끊기면 처리가 스스로 끝난다
      await state.handling;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** 소켓에 바이트를 쓰고 닫는다. 쓴 뒤 바이트를 0으로 덮는다. 쓰기가 끝나거나 실패하면 끝난다 */
export function sendAndWipe(socket: Socket, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve) => {
    // 읽는 쪽이 먼저 끊으면 오류가 난다. 결과는 요청 응답으로 받는다
    socket.on("error", () => {
      resolve();
    });
    socket.end(bytes, () => {
      bytes.fill(0);
      resolve();
    });
  });
}

/** 연결된 쪽이 EOF까지 쓴 바이트를 모은다. `limit`을 넘으면 `undefined`다(모은 것은 0으로 덮는다) */
export function readUntilEnd(socket: Socket, limit: number): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const finish = (result: Uint8Array | undefined): void => {
      if (settled) return;
      settled = true;
      if (result === undefined) for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      resolve(result);
    };
    socket.on("data", (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > limit) {
        socket.destroy();
        finish(undefined);
        return;
      }
      chunks.push(new Uint8Array(chunk));
    });
    socket.on("end", () => {
      const joined = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.byteLength;
        chunk.fill(0);
      }
      finish(joined);
    });
    socket.on("error", () => {
      finish(undefined);
    });
    socket.on("close", () => {
      finish(undefined);
    });
  });
}
