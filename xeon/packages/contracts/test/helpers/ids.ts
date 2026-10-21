import { Bug, parse } from "../../src/index.ts";
import type { Static, TSchema } from "typebox";
import type { IdByPrefix, IdFactory, IdPrefix } from "../../src/conversation/index.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 검증을 통과한 값을 돌려준다. 실패하면 Bug. 테스트에서 브랜드 값을 단언 없이 만드는 길이다. */
export function must<S extends TSchema>(schema: S, input: unknown): Static<S> {
  const result = parse(schema, input);
  if (!result.ok) {
    throw new Bug(`test fixture failed schema: ${JSON.stringify(result.error.issues)}`);
  }
  return result.value;
}

/** n번째 ULID(26자). 같은 n에 같은 값이고 n이 다르면 값이 다르다. */
function ulid(n: number): string {
  const hi = ALPHABET[Math.floor(n / 1024) % 32] ?? "0";
  const mid = ALPHABET[Math.floor(n / 32) % 32] ?? "0";
  const lo = ALPHABET[n % 32] ?? "0";
  return `01ARZ3NDEKTSV4RRFFQ${hi}${mid}${lo}ABCD`.slice(0, 26);
}

export function rawId(prefix: IdPrefix, n: number): string {
  return `${prefix}_${ulid(n)}`;
}

/**
 * 호출 수를 세는 순번 발급기. 테스트 대역이다(TY-06 허용 위치 2, fixedIdFactory).
 * 브랜드를 붙이는 단언이 이 함수 하나에 모여 있다.
 */
export function fixedIdFactory(start = 0): {
  readonly ids: IdFactory;
  readonly calls: () => number;
} {
  let n = start;
  const ids: IdFactory = {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      const raw = rawId(prefix, n);
      n += 1;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 테스트 대역의 브랜드 생성 함수 (eng.typescript.guide TY-06)
      return raw as IdByPrefix[P];
    },
  };
  return { ids, calls: () => n - start };
}
