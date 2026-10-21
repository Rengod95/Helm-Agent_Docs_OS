import { Bug } from "@xeon/contracts";
import { isId, type IdByPrefix, type IdFactory, type IdPrefix } from "@xeon/contracts/conversation";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(counter: number): string {
  let rest = counter;
  let digits = "";
  do {
    digits = `${CROCKFORD.charAt(rest % 32)}${digits}`;
    rest = Math.floor(rest / 32);
  } while (rest > 0);
  // ULID 26자: 첫 글자는 0-7이므로 0으로 채운다
  return digits.padStart(26, "0");
}

/** 호출 순서대로 유효한 ID를 내는 테스트용 IdFactory */
export function sequentialIds(start: number = 1): IdFactory {
  let counter = start;
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      const candidate = `${prefix}_${encode(counter)}`;
      counter += 1;
      if (!isId(prefix, candidate)) throw new Bug(`sequentialIds: ${candidate} is not a valid id`);
      return candidate;
    },
  };
}
