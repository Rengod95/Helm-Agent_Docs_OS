import type { RandomSource } from "@xeon/contracts";

const TWO_POW_26 = 67_108_864;
const TWO_POW_53 = 9_007_199_254_740_992;

/**
 * crypto.getRandomValues 기반 [0, 1) 난수. Uint32 두 개에서 상위 27비트와 26비트를 모아 53비트 정수를 만들고
 * 2^53으로 나눈다. Math.random보다 예측이 어렵다(L0.os.spec §3.4).
 */
export function systemRandom(): RandomSource {
  const words = new Uint32Array(2);
  return (): number => {
    crypto.getRandomValues(words);
    const high = (words[0] ?? 0) >>> 5;
    const low = (words[1] ?? 0) >>> 6;
    return (high * TWO_POW_26 + low) / TWO_POW_53;
  };
}
