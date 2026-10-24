// 메모리 바이트 파이프. stdio 전송의 양 끝을 프로세스 없이 잇는다.

export interface BytePipe {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

export function bytePipe(): BytePipe {
  const pipe = new TransformStream<Uint8Array, Uint8Array>();
  return { readable: pipe.readable, writable: pipe.writable };
}

const encoder = new TextEncoder();

export function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** 읽는 쪽에서 쓰는 쪽이 보낸 바이트를 문자열로 모은다 */
export async function readText(
  readable: ReadableStream<Uint8Array>,
  until: (text: string) => boolean,
): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  async function more(text: string): Promise<string> {
    if (until(text)) return text;
    const chunk = await reader.read();
    if (chunk.done) return text;
    return more(text + decoder.decode(chunk.value, { stream: true }));
  }
  try {
    return await more("");
  } finally {
    reader.releaseLock();
  }
}
