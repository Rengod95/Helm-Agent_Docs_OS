// 런타임 중립 ID 발급기(eng.testing.guide TS-03). 같은 호출 순서면 같은 ID를 낸다.
import { Bug } from "@xeon/contracts";
import { isId, type IdFactory, type IdPrefix } from "@xeon/contracts/conversation";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: number, length: number): string {
  let rest = value;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

export function fixedIdFactory(seed: number = 1): IdFactory {
  let counter = 0;
  return {
    next<P extends IdPrefix>(prefix: P) {
      counter += 1;
      const value = `${prefix}_0${encode(seed, 5)}${encode(counter, 20)}`;
      if (!isId(prefix, value)) throw new Bug(`fixedIdFactory made a bad id: ${value}`);
      return value;
    },
  };
}
