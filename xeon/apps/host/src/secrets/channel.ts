import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { SecretValueSource, SecretValueView } from "@fresnel/contracts/services";

// F.wire-settings.spec §3.3.1 secret.beginEntry·beginReveal의 `channel`(로컬 일회용 채널, F spec 2026-11-12 결정).
// CLI가 mkdtemp로 0700 폴더를 만들고 그 안에 연 유닉스 소켓을 호스트가 연다. 값은 소켓으로만 오간다:
// 입력은 CLI가 쓰고 닫으면 호스트가 EOF까지 읽고, 열람은 호스트가 쓰고 닫으면 CLI가 읽는다. 경로는 wire에 있지만 값은 없다.

/** 입력 값 상한(바이트). 시크릿 값은 짧은 키나 토큰이다. 이보다 크면 입력을 취소한 것으로 본다 */
const CHANNEL_VALUE_MAX_BYTES = 8192;

export type ChannelRefusal = "not_absolute" | "no_user" | "folder_unsafe" | "socket_unsafe";

/**
 * 채널이 이 사용자의 것인지 본다: 절대 경로, 부모 폴더가 현재 uid 소유의 0700 디렉터리(심볼릭 링크가 아님),
 * 소켓이 현재 uid 소유의 소켓(심볼릭 링크가 아님). lstat으로 링크를 따라가지 않는다
 */
export async function checkChannel(channel: string): Promise<Result<string, ChannelRefusal>> {
  if (!isAbsolute(channel)) return err("not_absolute");
  const uid = process.getuid?.();
  if (uid === undefined) return err("no_user");
  const folder = await attemptAsync(() => lstat(dirname(channel)));
  if (
    !folder.ok ||
    !folder.value.isDirectory() ||
    folder.value.uid !== uid ||
    (folder.value.mode & 0o777) !== 0o700
  ) {
    return err("folder_unsafe");
  }
  const socket = await attemptAsync(() => lstat(channel));
  if (!socket.ok || !socket.value.isSocket() || socket.value.uid !== uid) {
    return err("socket_unsafe");
  }
  return ok(channel);
}

type ValueRead = Awaited<ReturnType<SecretValueSource["read"]>>;

function concatAndWipe(chunks: Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
    chunk.fill(0);
  }
  chunks.length = 0;
  return joined;
}

/**
 * 채널에서 값을 한 번 읽는 `SecretValueSource`. CLI가 닫을 때까지 읽는다. 0바이트면 `input_empty`(빈 값이거나 취소로 닫았다),
 * 상한을 넘거나 연결에 실패하거나 중간에 끊기거나 요청이 중단되면 `input_cancelled`다. 읽은 바이트는 넘긴 뒤 0으로 덮는다
 */
export function sourceOfChannel(path: string, signal: AbortSignal): SecretValueSource {
  return {
    read: () =>
      new Promise<ValueRead>((resolve) => {
        const chunks: Uint8Array[] = [];
        let total = 0;
        let settled = false;
        const socket = createConnection(path);
        const finish = (result: ValueRead): void => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const cancel = (): void => {
          for (const chunk of chunks) chunk.fill(0);
          chunks.length = 0;
          socket.destroy();
          finish(err({ kind: "input_cancelled" }));
        };
        const onAbort = (): void => {
          cancel();
        };
        if (signal.aborted) {
          cancel();
          return;
        }
        signal.addEventListener("abort", onAbort);
        socket.on("data", (chunk: Uint8Array) => {
          total += chunk.byteLength;
          if (total > CHANNEL_VALUE_MAX_BYTES) {
            cancel();
            return;
          }
          // 조각은 풀에서 온 버퍼일 수 있어 복사해 둔다
          chunks.push(new Uint8Array(chunk));
        });
        socket.on("end", () => {
          if (total === 0) {
            finish(err({ kind: "input_empty" }));
            return;
          }
          finish(ok(concatAndWipe(chunks, total)));
        });
        socket.on("error", cancel);
        socket.on("close", cancel);
      }),
  };
}

/**
 * 채널에 값을 쓰고 닫는 열람 통로. `show`는 던지지 않는다. 쓰지 못했으면 `delivered()`가 거짓이라 호출한 쪽이
 * 응답을 정한다(열람 기록은 `show` 전에 이미 남는다, L0.secrets `reveal`)
 */
export function revealChannel(path: string): {
  readonly show: (value: SecretValueView) => Promise<void>;
  readonly delivered: () => boolean;
} {
  const state = { delivered: false };
  return {
    async show(value) {
      state.delivered = await writeAndEnd(path, value.bytes);
    },
    delivered: () => state.delivered,
  };
}

function writeAndEnd(path: string, bytes: Uint8Array): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(path);
    // 읽는 쪽이 먼저 끊으면 오류가 난다. 결과는 false다. 오류 이벤트를 빠뜨리면 프로세스가 죽는다
    socket.on("error", () => {
      resolve(false);
    });
    socket.on("finish", () => {
      resolve(true);
    });
    socket.end(bytes);
  });
}
