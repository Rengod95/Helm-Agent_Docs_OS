import type { LocalIdFactory } from "@xeon/contracts/conversation";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(n: number): string {
  const digits: string[] = [];
  let rest = n;
  for (let i = 0; i < 6; i += 1) {
    digits.unshift(ALPHABET[rest % 32] ?? "0");
    rest = Math.floor(rest / 32);
  }
  return `01ARZ3NDEKTSV4RRFFQ${digits.join("")}`.slice(0, 26);
}

/** 호출 순서대로 `<접두>_<ULID>`를 낸다. 테스트 대역이다 */
export function fixedLocalIds(): LocalIdFactory {
  let n = 0;
  return {
    next(prefix) {
      n += 1;
      return `${prefix}_${ulid(n)}`;
    },
  };
}
