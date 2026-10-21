import type { RandomSource } from "@xeon/contracts";

/** mulberry32. 같은 seed는 같은 열을 낸다. [0, 1) 균등 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAIN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** 인코딩 변형이 원문과 달라지게 하는 글자를 섞는다: URL 예약 문자, JSON 이스케이프 대상, 공백 */
const AWKWARD = `${PLAIN}+/=&"\\ %`;

/** 테스트 전용 가짜 비밀 값. 실제 비밀이 아니다 */
export function fakeValue(random: RandomSource, length = 24, awkward = false): string {
  const alphabet = awkward ? AWKWARD : PLAIN;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)] ?? "x";
  }
  return out;
}
