import type { IdByPrefix, IdFactory, IdPrefix } from "@xeon/contracts/conversation";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_BODY_LENGTH = 26;

function encode(counter: number): string {
  let rest = counter;
  let out = "";
  while (rest > 0) {
    out = `${ALPHABET[rest % 32] ?? "0"}${out}`;
    rest = Math.floor(rest / 32);
  }
  return out.padStart(ULID_BODY_LENGTH, "0");
}

/**
 * 테스트용 ID 발급기(eng.testing.guide TS-03 fixedIdFactory). 호출 순서대로 `<접두>_<26자>`를 만든다.
 * 첫 글자가 0이라 F의 ID 패턴을 지킨다. 같은 seed는 같은 열을 낸다
 */
export function fixedIdFactory(seed = 0): IdFactory {
  let counter = seed;
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      counter += 1;
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성: 테스트 대역 fixedIdFactory (eng.typescript.guide TY-06)
      return `${prefix}_${encode(counter)}` as IdByPrefix[P];
    },
  };
}
