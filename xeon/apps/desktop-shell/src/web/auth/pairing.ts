// 페어링 코드(spec §8.3 1~2): 10자, 5분 유효, 한 번 쓰면 폐기, 동시에 하나만 유효.
// 실패 5번이면 코드를 폐기하고 15분 잠근다. IP(주소)별과 전체를 둘 다 센다. 상태는 메모리에만 있다(게이트웨이를 다시 띄우면 코드도 사라진다).
import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import { err, ok, type Clock, type Result } from "@fresnel/contracts";
import { encodeCode, formatCode, normalizeCode } from "./crockford.ts";

export const PAIRING_TTL_MS: number = 5 * 60_000;
const PAIRING_MAX_FAILURES = 5;
export const PAIRING_LOCK_MS: number = 15 * 60_000;

export interface PairingOptions {
  readonly clock: Clock;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly ttlMs?: number;
  /** 주소 하나가 실패할 수 있는 횟수 */
  readonly maxFailuresPerAddress?: number;
  /** 전체(모든 주소 합)가 실패할 수 있는 횟수 */
  readonly maxFailuresTotal?: number;
  readonly lockMs?: number;
}

export interface IssuedCode {
  /** 정규형 10자 */
  readonly code: string;
  /** 사람이 보는 모양(`ABCDE-12345`) */
  readonly display: string;
  readonly expiresAt: number;
}

export type PairingError =
  /** 틀림, 만료, 이미 씀, 발급된 코드 없음을 구분하지 않는다(코드 존재 여부를 흘리지 않는다) */
  | { readonly kind: "invalid_code" }
  | { readonly kind: "locked"; readonly scope: "address" | "all"; readonly retryAfterMs: number };

export type PairingEvent =
  | { readonly kind: "failed"; readonly address: string }
  | {
      readonly kind: "locked";
      readonly address: string;
      readonly scope: "address" | "all";
      readonly until: number;
    }
  | { readonly kind: "redeemed"; readonly address: string };

export interface PairingStatus {
  readonly active: boolean;
  readonly expiresAt: number | null;
  /** 전체 잠금이 풀리는 시각. 잠겨 있지 않으면 null */
  readonly lockedUntil: number | null;
}

export interface PairingCodes {
  /** 새 코드를 만든다. 쓰지 않은 이전 코드는 이 순간 폐기된다 */
  issue(): IssuedCode;
  /** 코드를 쓴다. 성공하면 코드는 폐기된다 */
  redeem(input: string, address: string): Result<null, PairingError>;
  status(): PairingStatus;
  /** 실패·잠금·성공 알림(로그용). 코드 값은 싣지 않는다 */
  onEvent(listener: (event: PairingEvent) => void): () => void;
}

interface Failures {
  count: number;
  /** 첫 실패 시각. 잠금 시간만큼 지나면 센 것을 잊는다 */
  since: number;
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

export function createPairingCodes(options: PairingOptions): PairingCodes {
  const random = options.randomBytes ?? ((size: number): Uint8Array => nodeRandomBytes(size));
  const ttlMs = options.ttlMs ?? PAIRING_TTL_MS;
  const maxPerAddress = options.maxFailuresPerAddress ?? PAIRING_MAX_FAILURES;
  const maxTotal = options.maxFailuresTotal ?? PAIRING_MAX_FAILURES;
  const lockMs = options.lockMs ?? PAIRING_LOCK_MS;
  const listeners = new Set<(event: PairingEvent) => void>();

  let active: { readonly code: string; readonly expiresAt: number } | null = null;
  let total: Failures = { count: 0, since: 0 };
  let lockedAll = 0;
  const perAddress = new Map<string, Failures>();
  const lockedAddress = new Map<string, number>();

  function emit(event: PairingEvent): void {
    for (const listener of listeners) listener(event);
  }

  function forget(now: number): void {
    if (lockedAll <= now) lockedAll = 0;
    if (total.count > 0 && lockedAll === 0 && now - total.since >= lockMs) {
      total = { count: 0, since: 0 };
    }
    for (const [address, until] of lockedAddress) {
      if (until <= now) lockedAddress.delete(address);
    }
    for (const [address, failures] of perAddress) {
      if (!lockedAddress.has(address) && now - failures.since >= lockMs) perAddress.delete(address);
    }
  }

  function lockOf(address: string, now: number): PairingError | null {
    if (lockedAll > now) return { kind: "locked", scope: "all", retryAfterMs: lockedAll - now };
    const until = lockedAddress.get(address);
    if (until !== undefined && until > now) {
      return { kind: "locked", scope: "address", retryAfterMs: until - now };
    }
    return null;
  }

  function fail(address: string, now: number): PairingError {
    emit({ kind: "failed", address });
    if (total.count === 0) total = { count: 0, since: now };
    total.count += 1;
    const mine = perAddress.get(address) ?? { count: 0, since: now };
    mine.count += 1;
    perAddress.set(address, mine);

    if (total.count >= maxTotal) {
      active = null;
      lockedAll = now + lockMs;
      emit({ kind: "locked", address, scope: "all", until: lockedAll });
      return { kind: "locked", scope: "all", retryAfterMs: lockMs };
    }
    if (mine.count >= maxPerAddress) {
      active = null;
      lockedAddress.set(address, now + lockMs);
      emit({ kind: "locked", address, scope: "address", until: now + lockMs });
      return { kind: "locked", scope: "address", retryAfterMs: lockMs };
    }
    return { kind: "invalid_code" };
  }

  return {
    issue() {
      const now = options.clock.now();
      const code = encodeCode(random(10));
      active = { code, expiresAt: now + ttlMs };
      return { code, display: formatCode(code), expiresAt: active.expiresAt };
    },

    redeem(input, address) {
      const now = options.clock.now();
      forget(now);
      const locked = lockOf(address, now);
      if (locked !== null) return err(locked);

      const normalized = normalizeCode(input);
      const candidate = active;
      const live = candidate !== null && candidate.expiresAt > now ? candidate : null;
      // 모양이 틀려도, 코드가 없어도 같은 비용으로 비교한다
      const same = timingSafeEqual(digest(normalized ?? ""), digest(live?.code ?? ""));
      if (normalized === null || live === null || !same) return err(fail(address, now));

      active = null;
      total = { count: 0, since: 0 };
      perAddress.delete(address);
      emit({ kind: "redeemed", address });
      return ok(null);
    },

    status() {
      const now = options.clock.now();
      forget(now);
      const live = active !== null && active.expiresAt > now ? active : null;
      return {
        active: live !== null,
        expiresAt: live?.expiresAt ?? null,
        lockedUntil: lockedAll > now ? lockedAll : null,
      };
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
