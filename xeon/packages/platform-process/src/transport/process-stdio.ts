// L0.process.spec §4.1 stdio. 프로세스 자신의 stdin/stdout, 또는 자식 프로세스 파이프를 전송이 읽고 쓰는 스트림으로 바꾼다.
// `Bun.stdout.writer()`와 `Bun.spawn`의 stdin은 FileSink라서 WritableStream으로 감싼다. 쓰기마다 flush해 줄이 바로 나간다.

/** FileSink 중 이 감싸기가 쓰는 부분 */
export interface ByteSink {
  write(chunk: Uint8Array): number | Promise<number>;
  flush(): number | Promise<number>;
  end(): number | Promise<number>;
}

export interface ByteStreams {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

export function writableFromSink(sink: ByteSink): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      await sink.write(chunk);
      await sink.flush();
    },
    async close() {
      await sink.end();
    },
  });
}

/** 이 프로세스의 stdin(읽기)과 stdout(쓰기). 로그는 stderr로 보낸다(엔진 stdout은 전송 전용) */
export function openProcessStdio(): ByteStreams {
  return {
    readable: Bun.stdin.stream(),
    writable: writableFromSink(Bun.stdout.writer()),
  };
}
