// L2.workspace.spec §4.4 같은 파일의 변경을 한 줄로 세운다(포크 원본 durable `tools/file-mutation-queue.ts`의 동작).
// 같은 프로세스 안에서 같은 파일 시스템 id와 정규 경로의 `write`·`edit`만 차례로 돈다. 다른 경로는 기다리지 않는다.
// 다른 프로세스나 `bash`에는 효과가 없다. 그쪽은 atomic.ts의 `expectedBefore` 감지가 맡는다.

/** 파일 시스템 id와 정규 경로별 변경 사슬의 꼬리 */
const queues = new Map<string, Promise<void>>();

export function mutationKey(envId: string, canonicalPath: string): string {
  return `${envId}\0${canonicalPath}`;
}

/** `key`의 앞선 변경이 모두 끝난 뒤 `run`을 실행한다. `run`이 던져도 다음 변경은 이어서 돈다 */
export async function withFileMutationQueue<T>(key: string, run: () => Promise<T>): Promise<T> {
  // await 없이 자리를 잡아 다른 호출이 그 사이에 끼지 못하게 한다
  const previous = queues.get(key) ?? Promise.resolve();
  const gate = Promise.withResolvers<void>();
  const release = gate.resolve;
  const done = gate.promise;
  const tail = previous.then(() => done);
  queues.set(key, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}
