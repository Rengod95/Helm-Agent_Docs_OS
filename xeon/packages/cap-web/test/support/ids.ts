import { parse } from "@xeon/contracts";
import { ThreadIdSchema, type LocalIdFactory, type ThreadId } from "@xeon/contracts/conversation";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(n: number): string {
  const digits: string[] = [];
  let rest = n;
  for (let i = 0; i < 6; i += 1) {
    digits.unshift(ALPHABET[rest % 32] ?? "0");
    rest = Math.floor(rest / 32);
  }
  return `01ARZ3NDEKTSV4RRFFQ5${digits.join("")}`;
}

/** 호출 순서대로 `<접두>_<ULID>`를 낸다. 시험용 대역이다 */
export function fixedLocalIds(): LocalIdFactory {
  let n = 0;
  return {
    next(prefix) {
      n += 1;
      return `${prefix}_${ulid(n)}`;
    },
  };
}

/** 시험용 ThreadId. n이 다르면 다른 ID */
export function threadIdOf(n: number = 1): ThreadId {
  const parsed = parse(ThreadIdSchema, `thr_${ulid(n)}`);
  if (!parsed.ok) throw new Error("invalid test thread id");
  return parsed.value;
}
