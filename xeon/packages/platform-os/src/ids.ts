import { Bug, type Clock, type RandomSource } from "@xeon/contracts";
import type {
  IdByPrefix,
  IdFactory,
  IdPrefix,
  LocalId,
  LocalIdFactory,
  LocalIdPrefix,
} from "@xeon/contracts/conversation";

// ULID: 시각 48비트(문자 10자) + 난수 80비트(문자 16자), Crockford base32 대문자.
// F.conversation.spec §3.2의 ULID_PATTERN(첫 글자 0-7)을 지킨다. 시각은 주입한 Clock, 난수는 주입한 RandomSource만 쓴다.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const BASE = 32;
/** 2^48 - 1. 이 값을 넘는 시각은 첫 글자가 0-7을 벗어난다 */
const MAX_TIME = 281_474_976_710_655;

interface UlidState {
  time: number;
  /** 난수 부분. 문자 하나당 0~31 */
  digits: number[];
}

function drawDigits(random: RandomSource): number[] {
  const digits: number[] = [];
  for (let i = 0; i < RANDOM_CHARS; i += 1) {
    const r = random();
    if (!Number.isFinite(r) || r < 0 || r >= 1) {
      throw new Bug("RandomSource returned a value outside [0, 1)", { cause: r });
    }
    digits.push(Math.floor(r * BASE));
  }
  return digits;
}

/** 난수 부분을 1 올린다. 80비트가 모두 차서 넘치면 false */
function increment(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const current = digits[i] ?? 0;
    if (current < BASE - 1) {
      digits[i] = current + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

function encodeTime(time: number): string {
  let rest = time;
  let out = "";
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = (ALPHABET[rest % BASE] ?? "0") + out;
    rest = Math.floor(rest / BASE);
  }
  return out;
}

function encodeDigits(digits: readonly number[]): string {
  let out = "";
  for (const digit of digits) out += ALPHABET[digit] ?? "0";
  return out;
}

/**
 * 같은 밀리초 안에서 단조 증가하는 ULID 문자열 발급기(F.readme §8 미결 8의 L0 쪽 선택).
 * 같은 ms이거나 시계가 뒤로 가면 직전 시각을 유지하고 난수 부분을 1 올린다. 80비트가 넘치면 시각을 1ms 올린다.
 */
function createUlidGenerator(clock: Clock, random: RandomSource): () => string {
  let state: UlidState | undefined;
  return (): string => {
    const now = clock.now();
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIME) {
      throw new Bug("Clock.now() is not an epoch ms integer below 2^48", { cause: now });
    }
    if (state === undefined || now > state.time) {
      state = { time: now, digits: drawDigits(random) };
    } else if (!increment(state.digits)) {
      if (state.time >= MAX_TIME) throw new Bug("ULID time part overflow");
      state = { time: state.time + 1, digits: drawDigits(random) };
    }
    return encodeTime(state.time) + encodeDigits(state.digits);
  };
}

/** 브랜드 ID 8종(thr, trn, stp, itm, prt, evt, efx, ckp) 발급. ULID 시각 부분은 clock, 난수 부분은 random */
export function createIdFactory(clock: Clock, random: RandomSource): IdFactory {
  const nextUlid = createUlidGenerator(clock, random);
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성: createIdFactory가 만든 새 문자열 (eng.typescript.guide TY-06)
      return `${prefix}_${nextUlid()}` as IdByPrefix[P];
    },
  };
}

/** 도메인 지역 ID(LocalIdPrefix 표의 sls, bgp 등) 발급. 같은 ULID 규칙 */
export function createLocalIdFactory(clock: Clock, random: RandomSource): LocalIdFactory {
  const nextUlid = createUlidGenerator(clock, random);
  return {
    next<P extends LocalIdPrefix>(prefix: P): LocalId<P> {
      const id: LocalId<P> = `${prefix}_${nextUlid()}`;
      return id;
    },
  };
}
