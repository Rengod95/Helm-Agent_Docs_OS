/** 인메모리 전송의 메시지와 약속 연쇄가 끝나도록 이벤트 루프를 몇 번 돈다 */
export async function flush(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 순차 대기가 목적이다 (eng.testing.guide TS-05)
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
